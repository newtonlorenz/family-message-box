import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { nanoid } from "nanoid";
import twilio from "twilio";
import type {
  FirmwareUpdateManifest,
  FirmwareUpdateState,
  FirmwareUpdateSummary,
  ServerToDeviceEvent,
} from "@family-box/contracts";
import {
  openDatabase,
  migrate,
  seedDevice,
  verifyDevice,
  verifySecret,
  audit,
  type Db,
} from "./db.js";
import { getConfig, type AppConfig } from "./config.js";
import {
  convertToOpus,
  createDevicePlaybackPcm,
  createWhatsAppVoiceNote,
  AudioValidationError,
} from "./audio.js";
import { MockMessagingAdapter } from "./adapters/mock.js";
import {
  createTwilioMediaToken,
  TwilioWhatsAppAdapter,
  verifyTwilioMediaToken,
  type TwilioWebhookPayload,
} from "./adapters/twilio-whatsapp.js";
import type { MessagingAdapter } from "./adapters/types.js";
import {
  WhatsAppWebAdapter,
  normalizeWhatsAppChatId,
} from "./adapters/whatsapp-web.js";
import QRCode from "qrcode";
import { MessageService } from "./service.js";
import { RequestError } from "./errors.js";
import {
  FirmwareValidationError,
  firmwarePath,
  stageFirmwareImage,
  validateFirmwarePackage,
  type FirmwareManifest,
} from "./firmware.js";

const idSchema = { type: "string", minLength: 1, maxLength: 128 } as const;
const recipientKeySchema = {
  type: "string",
  minLength: 2,
  maxLength: 48,
  pattern: "^[A-Za-z0-9][A-Za-z0-9_-]+$",
} as const;
const idempotencyKeySchema = {
  type: "string",
  minLength: 8,
  maxLength: 128,
} as const;
const timeSchema = {
  anyOf: [
    { type: "string", pattern: "^(?:[01][0-9]|2[0-3]):[0-5][0-9]$" },
    { type: "null" },
  ],
} as const;

function deviceHeaders(request: any): { deviceId: string; credential: string } {
  return {
    deviceId: String(request.headers["x-device-id"] ?? ""),
    credential: String(request.headers["x-device-credential"] ?? ""),
  };
}

interface FirmwareUpdateRow {
  id: string;
  device_id: string;
  target: FirmwareUpdateManifest["target"];
  version: string;
  build: number;
  size_bytes: number;
  sha256: string;
  signature: string;
  expires_at: number;
  state: FirmwareUpdateState;
  error: string | null;
  created_at: string;
  updated_at: string;
}

function firmwareManifest(row: FirmwareUpdateRow): FirmwareUpdateManifest {
  return {
    updateId: row.id,
    deviceId: row.device_id,
    target: row.target,
    version: row.version,
    build: row.build,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    expiresAt: row.expires_at,
    signature: row.signature,
  };
}

function firmwareSummary(row: FirmwareUpdateRow): FirmwareUpdateSummary {
  return {
    ...firmwareManifest(row),
    state: row.state,
    error: row.error,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createSimulatorWav(durationMs: number): Buffer {
  const sampleRate = 8_000;
  const sampleCount = Math.round((sampleRate * durationMs) / 1_000);
  const dataSize = sampleCount * 2;
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVEfmt ", 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  for (let index = 0; index < sampleCount; index++) {
    const time = index / sampleRate;
    const syllable = 0.28 + 0.72 * Math.max(0, Math.sin(time * Math.PI * 4));
    const sample =
      Math.sin(time * Math.PI * 2 * (180 + 28 * Math.sin(time * 5))) * syllable;
    wav.writeInt16LE(Math.round(sample * 5_000), 44 + index * 2);
  }
  return wav;
}

export interface AppContext {
  app: ReturnType<typeof Fastify>;
  db: Db;
  service: MessageService;
  adapter: MessagingAdapter;
  config: AppConfig;
}

export async function buildApp(
  overrides: Partial<AppConfig> = {},
): Promise<AppContext> {
  const config = getConfig(overrides);
  const db = openDatabase(config.databasePath);
  migrate(db);
  if (config.seedDevelopmentDevice) {
    seedDevice(db, "family-box-01", config.developmentDeviceCredential);
  }
  const app = Fastify({
    logger:
      process.env.NODE_ENV !== "test"
        ? {
            redact: [
              "req.headers.authorization",
              "req.headers.x-device-credential",
              "req.headers.x-firmware-manifest",
              "req.headers.x-ota-csrf",
            ],
          }
        : false,
    bodyLimit: Math.max(config.maxUploadBytes, config.maxFirmwareBytes) + 100_000,
    ...(config.tlsCertPath && config.tlsKeyPath
      ? {
          https: {
            cert: fs.readFileSync(config.tlsCertPath),
            key: fs.readFileSync(config.tlsKeyPath),
          },
        }
      : {}),
  });
  const sockets = new Map<string, Set<any>>();
  const firmwareSigningPublicKey = config.firmwareSigningPublicKeyPath
    ? await fsp.readFile(config.firmwareSigningPublicKeyPath, "utf8")
    : "";
  const publicBaseUrl = config.twilioPublicBaseUrl?.replace(/\/+$/, "");
  const isTwilioConversationOpen = (chatId: string): boolean => {
    const session = db
      .prepare("SELECT last_inbound_at FROM whatsapp_sessions WHERE chat_id=?")
      .get(chatId) as { last_inbound_at: string } | undefined;
    return Boolean(
      session &&
      Date.now() - Date.parse(session.last_inbound_at) < 24 * 60 * 60 * 1_000,
    );
  };
  const normalizeIncomingAudio = async (audio: Buffer, mime: string) => {
    const converted = await convertToOpus({
      input: audio,
      mime,
      audioDir: config.audioDir,
      ffmpegPath: config.ffmpegPath,
      maxBytes: config.maxUploadBytes,
      minDurationSeconds: 0,
      maxDurationSeconds: 120,
    });
    try {
      return {
        audio: await fsp.readFile(converted.audioPath),
        mime: converted.mime,
        durationMs: converted.durationMs,
      };
    } finally {
      await fsp.rm(converted.audioPath, { force: true });
    }
  };
  const adapter: MessagingAdapter =
    config.messagingAdapter === "mock"
      ? new MockMessagingAdapter()
      : config.messagingAdapter === "whatsapp-web"
        ? new WhatsAppWebAdapter({
            dataPath: config.whatsappWebDataPath,
            ...(config.whatsappWebChromePath
              ? { chromePath: config.whatsappWebChromePath }
              : {}),
            maxMediaBytes: config.maxUploadBytes,
            isAllowedChat: (chatId) =>
              Boolean(
                db
                  .prepare(
                    "SELECT 1 FROM chat_mappings WHERE adapter='whatsapp-web' AND chat_id=?",
                  )
                  .get(chatId),
              ),
            normalizeAudio: normalizeIncomingAudio,
            prepareOutboundAudio: (audioPath, messageId) =>
              createWhatsAppVoiceNote(
                audioPath,
                messageId,
                config.maxUploadBytes,
                config.ffmpegPath,
              ),
          })
        : new TwilioWhatsAppAdapter({
            accountSid: config.twilioAccountSid!,
            authToken: config.twilioAuthToken!,
            from: config.twilioWhatsAppFrom,
            ...(config.twilioContentSid
              ? { contentSid: config.twilioContentSid }
              : {}),
            isConversationOpen: isTwilioConversationOpen,
            onInboundActivity: (chatId) => {
              db.prepare(
                `
          INSERT INTO whatsapp_sessions(chat_id,last_inbound_at) VALUES (?,?)
          ON CONFLICT(chat_id) DO UPDATE SET last_inbound_at=excluded.last_inbound_at
        `,
              ).run(chatId, new Date().toISOString());
            },
            maxMediaBytes: config.maxUploadBytes,
            mediaUrlFor: (messageId) => {
              const token = createTwilioMediaToken(
                config.twilioAuthToken!,
                messageId,
              );
              return `${publicBaseUrl}/api/twilio/media/${encodeURIComponent(messageId)}?token=${token}`;
            },
            normalizeAudio: normalizeIncomingAudio,
          });
  const broadcast = (
    deviceId: string,
    event: ServerToDeviceEvent | unknown,
  ) => {
    const payload = JSON.stringify(event);
    const clients = sockets.get(deviceId);
    if (!clients) return;
    for (const client of clients)
      if (client.readyState === 1) client.send(payload);
  };
  const service = new MessageService(db, adapter, config.audioDir, broadcast);

  const latestFirmwareUpdate = (
    deviceId: string,
    activeOnly = false,
  ): FirmwareUpdateRow | undefined =>
    db
      .prepare(
        `SELECT * FROM firmware_updates
         WHERE device_id=? ${
           activeOnly
             ? "AND state IN ('staged','downloading','installing','rebooting')"
             : ""
         }
         ORDER BY created_at DESC,id DESC LIMIT 1`,
      )
      .get(deviceId) as FirmwareUpdateRow | undefined;

  const sendPendingFirmwareUpdate = (deviceId: string, socket: any) => {
    const update = latestFirmwareUpdate(deviceId, true);
    if (!update || update.expires_at <= Math.floor(Date.now() / 1000)) return;
    socket.send(
      JSON.stringify({
        type: "firmware.update.available",
        update: firmwareManifest(update),
      } satisfies ServerToDeviceEvent),
    );
  };

  await app.register(cors, {
    origin: [config.adminOrigin],
    methods: ["GET", "POST", "PUT"],
    allowedHeaders: [
      "content-type",
      "authorization",
      "x-ota-csrf",
      "x-firmware-manifest",
      "x-device-id",
      "x-device-credential",
    ],
  });
  await app.register(formbody);
  await app.register(multipart, {
    limits: { fileSize: config.maxUploadBytes, files: 1, fields: 3 },
    attachFieldsToBody: false,
  });
  await app.register(websocket, { options: { maxPayload: 4_096 } });
  app.addContentTypeParser(
    "application/octet-stream",
    { parseAs: "buffer", bodyLimit: config.maxFirmwareBytes },
    (_request, body, done) => done(null, body),
  );

  app.setErrorHandler((error, request, reply) => {
    if ((error as any).validation) {
      return reply
        .code(400)
        .send({ error: "The request did not match the API contract." });
    }
    if (
      error instanceof AudioValidationError ||
      error instanceof FirmwareValidationError ||
      error instanceof RequestError
    ) {
      return reply
        .code(error instanceof FirmwareValidationError ? 400 : error.statusCode)
        .send({ error: error.message });
    }
    request.log.error(error, "Unhandled request error");
    return reply
      .code(500)
      .send({ error: "The server could not complete the request." });
  });

  app.get("/api/health", async () => ({
    ok: true,
    database: "ready",
    adapter: adapter.name,
    mode: "lan-first",
    time: new Date().toISOString(),
  }));

  app.post<{ Body: TwilioWebhookPayload }>(
    "/api/twilio/webhook",
    async (request, reply) => {
      if (!(adapter instanceof TwilioWhatsAppAdapter)) {
        throw new RequestError("The Twilio adapter is not active.", 404);
      }
      const signature = String(request.headers["x-twilio-signature"] ?? "");
      const webhookUrl =
        config.twilioWebhookUrl ?? `${publicBaseUrl}/api/twilio/webhook`;
      if (
        !signature ||
        !twilio.validateRequest(
          config.twilioAuthToken!,
          signature,
          webhookUrl,
          request.body,
        )
      ) {
        throw new RequestError("Invalid Twilio webhook signature.", 403);
      }
      await adapter.receiveWebhook(request.body);
      return reply
        .type("text/xml")
        .send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    },
  );

  app.get<{ Params: { id: string }; Querystring: { token: string } }>(
    "/api/twilio/media/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["token"],
          properties: { token: { type: "string", pattern: "^[a-f0-9]{64}$" } },
        },
      },
    },
    async (request, reply) => {
      if (
        !config.twilioAuthToken ||
        !verifyTwilioMediaToken(
          config.twilioAuthToken,
          request.params.id,
          request.query.token,
        )
      ) {
        throw new RequestError("Invalid media token.", 403);
      }
      const row = db
        .prepare(
          "SELECT audio_path FROM messages WHERE id=? AND direction='outgoing'",
        )
        .get(request.params.id) as { audio_path: string } | undefined;
      if (!row) throw new RequestError("Message audio was not found.", 404);
      const relativeAudioPath = path.relative(
        config.audioDir,
        path.resolve(row.audio_path),
      );
      if (
        relativeAudioPath.startsWith("..") ||
        path.isAbsolute(relativeAudioPath)
      ) {
        throw new RequestError("Stored audio path is invalid.", 500);
      }
      try {
        const stat = await fsp.stat(row.audio_path);
        if (!stat.isFile()) throw new Error("not a regular file");
      } catch {
        throw new RequestError("Message audio is unavailable.", 404);
      }
      reply.header("cache-control", "private, no-store");
      reply.type("audio/ogg");
      return reply.send(fs.createReadStream(row.audio_path));
    },
  );

  app.post<{
    Body: { deviceId: string; name?: string; bootstrapToken: string };
  }>(
    "/api/devices/register",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["deviceId", "bootstrapToken"],
          properties: {
            deviceId: {
              type: "string",
              minLength: 3,
              maxLength: 64,
              pattern: "^[A-Za-z0-9][A-Za-z0-9_-]+$",
            },
            name: { type: "string", minLength: 1, maxLength: 80 },
            bootstrapToken: { type: "string", minLength: 16, maxLength: 256 },
          },
        },
      },
    },
    async (request, reply) => {
      const { createHash } = await import("node:crypto");
      const suppliedHash = createHash("sha256")
        .update(request.body.bootstrapToken)
        .digest("hex");
      const expectedHash = createHash("sha256")
        .update(config.deviceBootstrapToken)
        .digest("hex");
      if (!verifySecret(expectedHash, suppliedHash))
        return reply.code(403).send({ error: "Invalid bootstrap token." });
      const credential = `device-${nanoid(32)}`;
      db.prepare(
        `
      INSERT INTO devices(id,name,credential_hash,created_at) VALUES (?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET name=excluded.name,credential_hash=excluded.credential_hash
    `,
      ).run(
        request.body.deviceId,
        request.body.name ?? "Family Message Box",
        createHash("sha256").update(credential).digest("hex"),
        new Date().toISOString(),
      );
      seedDevice(db, request.body.deviceId, credential);
      audit(
        db,
        "device.registered",
        "device",
        request.body.deviceId,
        request.body.deviceId,
      );
      return { deviceId: request.body.deviceId, credential };
    },
  );

  app.post<{ Body: { firmwareVersion?: string; batteryPercent?: number } }>(
    "/api/devices/heartbeat",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            firmwareVersion: { type: "string", minLength: 1, maxLength: 64 },
            batteryPercent: { type: "integer", minimum: 0, maximum: 100 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = deviceHeaders(request);
      if (!verifyDevice(db, auth.deviceId, auth.credential))
        return reply.code(401).send({ error: "Invalid device credentials." });
      db.prepare(
        "UPDATE devices SET firmware_version=?,battery_percent=?,last_seen_at=? WHERE id=?",
      ).run(
        request.body.firmwareVersion ?? null,
        request.body.batteryPercent ?? null,
        new Date().toISOString(),
        auth.deviceId,
      );
      return { ok: true, config: service.getConfig(auth.deviceId) };
    },
  );

  app.get("/api/device/config", async (request, reply) => {
    const auth = deviceHeaders(request);
    if (!verifyDevice(db, auth.deviceId, auth.credential))
      return reply.code(401).send({ error: "Invalid device credentials." });
    return service.getConfig(auth.deviceId);
  });

  app.post<{
    Body: {
      messageId: string;
      phase: "fused_stream" | "fallback_stream";
      reason:
        | "invalid_response"
        | "audio_start_failed"
        | "sink_write_failed"
        | "stream_disconnected"
        | "stream_stalled"
        | "invalid_pcm"
        | "audio_finish_failed";
      bytesReceived: number;
      contentLength: number;
      httpStatus: number;
    };
  }>(
    "/api/device/playback/failures",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "messageId",
            "phase",
            "reason",
            "bytesReceived",
            "contentLength",
            "httpStatus",
          ],
          properties: {
            messageId: idSchema,
            phase: { enum: ["fused_stream", "fallback_stream"] },
            reason: {
              enum: [
                "invalid_response",
                "audio_start_failed",
                "sink_write_failed",
                "stream_disconnected",
                "stream_stalled",
                "invalid_pcm",
                "audio_finish_failed",
              ],
            },
            bytesReceived: {
              type: "integer",
              minimum: 0,
              maximum: 4_000_000,
            },
            contentLength: {
              type: "integer",
              minimum: 0,
              maximum: 4_000_000,
            },
            httpStatus: { type: "integer", minimum: -1_000, maximum: 599 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = deviceHeaders(request);
      if (!verifyDevice(db, auth.deviceId, auth.credential)) {
        return reply.code(401).send({ error: "Invalid device credentials." });
      }
      const message = db
        .prepare(
          "SELECT id FROM messages WHERE id=? AND device_id=? AND direction='incoming'",
        )
        .get(request.body.messageId, auth.deviceId) as
        | { id: string }
        | undefined;
      if (!message) {
        return reply.code(404).send({ error: "Message not found." });
      }
      const matchingEvent = (
        db
          .prepare(
            `SELECT id,detail_json FROM audit_events
             WHERE device_id=? AND entity_type='message' AND entity_id=?
               AND action='playback.failed'`,
          )
          .all(auth.deviceId, message.id) as Array<{
          id: string;
          detail_json: string;
        }>
      ).find((event) => {
        try {
          const detail = JSON.parse(event.detail_json) as {
            phase?: string;
            reason?: string;
          };
          return (
            detail.phase === request.body.phase &&
            detail.reason === request.body.reason
          );
        } catch {
          return false;
        }
      });
      const observation = {
        bytesReceived: request.body.bytesReceived,
        contentLength: request.body.contentLength,
        httpStatus: request.body.httpStatus,
      };
      const detail = {
        phase: request.body.phase,
        reason: request.body.reason,
        occurrences: 1,
        first: observation,
        latest: observation,
      };
      if (matchingEvent) {
        const previousDetail = JSON.parse(matchingEvent.detail_json) as {
          occurrences?: number;
          first?: typeof observation;
          bytesReceived?: number;
          contentLength?: number;
          httpStatus?: number;
        };
        const previousOccurrences = Number.isSafeInteger(
          previousDetail.occurrences,
        )
          ? Math.max(1, previousDetail.occurrences ?? 1)
          : 1;
        db.prepare("UPDATE audit_events SET detail_json=? WHERE id=?").run(
          JSON.stringify({
            phase: request.body.phase,
            reason: request.body.reason,
            occurrences: Math.min(
              previousOccurrences + 1,
              Number.MAX_SAFE_INTEGER,
            ),
            first: previousDetail.first ?? {
              bytesReceived: previousDetail.bytesReceived ?? 0,
              contentLength: previousDetail.contentLength ?? 0,
              httpStatus: previousDetail.httpStatus ?? 0,
            },
            latest: observation,
          }),
          matchingEvent.id,
        );
        return reply.code(200).send({ ok: true, duplicate: true });
      }
      audit(
        db,
        "playback.failed",
        "message",
        message.id,
        auth.deviceId,
        detail,
      );
      request.log.warn(
        {
          deviceId: auth.deviceId,
          messageId: message.id,
          ...detail,
        },
        "Device playback failed",
      );
      return reply.code(201).send({ ok: true, duplicate: false });
    },
  );

  app.get("/api/device/events", { websocket: true }, (socket, request) => {
    const { deviceId, credential } = deviceHeaders(request);
    if (!verifyDevice(db, deviceId, credential))
      return socket.close(1008, "Invalid device credentials");
    const clients = sockets.get(deviceId) ?? new Set();
    clients.add(socket);
    sockets.set(deviceId, clients);
    socket.send(
      JSON.stringify({
        type: "config.updated",
        config: service.getConfig(deviceId),
      }),
    );
    sendPendingFirmwareUpdate(deviceId, socket);
    socket.on("close", () => clients.delete(socket));
    socket.on("message", (data: Buffer) => {
      try {
        const event = JSON.parse(data.toString());
        if (
          event?.type === "device.hello" &&
          event.deviceId === deviceId &&
          typeof event.firmwareVersion === "string" &&
          event.firmwareVersion.length >= 1 &&
          event.firmwareVersion.length <= 64
        ) {
          db.prepare(
            "UPDATE devices SET firmware_version=?,last_seen_at=? WHERE id=?",
          ).run(event.firmwareVersion, new Date().toISOString(), deviceId);
        } else if (
          event?.type === "device.heartbeat" &&
          event.deviceId === deviceId &&
          (event.batteryPercent === undefined ||
            (Number.isInteger(event.batteryPercent) &&
              event.batteryPercent >= 0 &&
              event.batteryPercent <= 100))
        ) {
          db.prepare(
            "UPDATE devices SET battery_percent=COALESCE(?,battery_percent),last_seen_at=? WHERE id=?",
          ).run(
            event.batteryPercent ?? null,
            new Date().toISOString(),
            deviceId,
          );
        } else {
          socket.send(
            JSON.stringify({
              type: "server.error",
              code: "invalid_event",
              message: "Unsupported or invalid device event.",
            }),
          );
        }
      } catch {
        socket.send(
          JSON.stringify({
            type: "server.error",
            code: "invalid_event",
            message: "Event must be valid JSON.",
          }),
        );
      }
    });
  });

  app.post(
    "/api/device/messages/upload",
    {
      schema: {
        headers: {
          type: "object",
          required: [
            "x-device-id",
            "x-device-credential",
            "x-recipient-key",
            "idempotency-key",
          ],
          properties: {
            "x-device-id": idSchema,
            "x-device-credential": idSchema,
            "x-recipient-key": recipientKeySchema,
            "idempotency-key": idempotencyKeySchema,
            "x-audio-sample-rate": { type: "string", pattern: "^[0-9]{4,5}$" },
            "x-audio-channels": { type: "string", pattern: "^[12]$" },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = deviceHeaders(request);
      if (!verifyDevice(db, auth.deviceId, auth.credential))
        return reply.code(401).send({ error: "Invalid device credentials." });
      const recipientKey = String(request.headers["x-recipient-key"] ?? "");
      const idempotencyKey = String(request.headers["idempotency-key"] ?? "");
      if (!recipientKey || !idempotencyKey)
        return reply
          .code(400)
          .send({ error: "Recipient and idempotency headers are required." });
      const duplicate = db
        .prepare(
          `
      SELECT m.id,m.delivery_state,r.recipient_key
      FROM messages m JOIN recipients r ON r.id=m.recipient_id
      WHERE m.device_id=? AND m.idempotency_key=?
    `,
        )
        .get(auth.deviceId, idempotencyKey) as any;
      if (duplicate) {
        if (duplicate.recipient_key !== recipientKey) {
          throw new RequestError(
            "This idempotency key was already used for another recipient.",
            409,
          );
        }
        return {
          messageId: duplicate.id,
          deliveryState: duplicate.delivery_state,
          duplicate: true,
        };
      }
      const part = await request.file();
      if (!part)
        return reply.code(400).send({ error: "One audio file is required." });
      const input = await part.toBuffer();
      const settings = db
        .prepare("SELECT * FROM settings WHERE device_id=?")
        .get(auth.deviceId) as any;
      const pcmSampleRate =
        Number(request.headers["x-audio-sample-rate"] || 0) || undefined;
      const pcmChannels =
        Number(request.headers["x-audio-channels"] || 0) || undefined;
      const converted = await convertToOpus({
        input,
        mime: part.mimetype,
        audioDir: config.audioDir,
        ffmpegPath: config.ffmpegPath,
        maxBytes: config.maxUploadBytes,
        minDurationSeconds: settings.min_duration_seconds,
        maxDurationSeconds: settings.max_duration_seconds,
        ...(pcmSampleRate === undefined ? {} : { pcmSampleRate }),
        ...(pcmChannels === undefined ? {} : { pcmChannels }),
      });
      const messageId = nanoid();
      let created;
      try {
        created = service.createOutgoing({
          messageId,
          deviceId: auth.deviceId,
          recipientKey,
          audioPath: converted.audioPath,
          originalMime: part.mimetype,
          durationMs: converted.durationMs,
          idempotencyKey,
        });
      } catch (error) {
        await fs.promises.rm(converted.audioPath, { force: true });
        throw error;
      }
      if (created.duplicate)
        await fs.promises.rm(converted.audioPath, { force: true });
      try {
        await service.deliver(created.id);
      } catch {
        // The persisted failed state and audit event are returned to the device.
      }
      const row = db
        .prepare("SELECT delivery_state,error FROM messages WHERE id=?")
        .get(created.id) as any;
      return reply.code(created.duplicate ? 200 : 201).send({
        messageId: created.id,
        deliveryState: row.delivery_state,
        error: row.error,
        duplicate: created.duplicate,
      });
    },
  );

  app.get<{ Querystring: { recipientKey: string } }>(
    "/api/device/messages/next",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["recipientKey"],
          properties: { recipientKey: recipientKeySchema },
        },
      },
    },
    async (request, reply) => {
      const auth = deviceHeaders(request);
      if (!verifyDevice(db, auth.deviceId, auth.credential))
        return reply.code(401).send({ error: "Invalid device credentials." });
      const message = service.oldestWaiting(
        auth.deviceId,
        request.query.recipientKey,
      );
      if (!message) return reply.code(204).send();
      return {
        id: message.id,
        duration_ms: message.duration_ms,
        created_at: message.created_at,
        audioUrl: `/api/device/messages/${message.id}/audio`,
      };
    },
  );

  app.get<{
    Querystring: { recipientKey: string; format?: "pcm_s16le" };
  }>(
    "/api/device/messages/next/audio",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["recipientKey"],
          properties: {
            recipientKey: recipientKeySchema,
            format: { type: "string", enum: ["pcm_s16le"] },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = deviceHeaders(request);
      if (!verifyDevice(db, auth.deviceId, auth.credential)) {
        return reply.code(401).send({ error: "Invalid device credentials." });
      }
      const message = service.oldestWaiting(
        auth.deviceId,
        request.query.recipientKey,
      ) as
        | { id: string; audio_path: string; duration_ms: number }
        | undefined;
      if (!message) return reply.code(204).send();
      const relativeAudioPath = path.relative(
        config.audioDir,
        path.resolve(message.audio_path),
      );
      if (
        relativeAudioPath.startsWith("..") ||
        path.isAbsolute(relativeAudioPath)
      ) {
        throw new RequestError("Stored audio path is invalid.", 500);
      }
      try {
        const stat = await fsp.stat(message.audio_path);
        if (!stat.isFile()) throw new Error("not a regular file");
      } catch {
        throw new RequestError("Message audio is unavailable.", 404);
      }
      const settings = db
        .prepare(
          "SELECT max_duration_seconds FROM settings WHERE device_id=?",
        )
        .get(auth.deviceId) as { max_duration_seconds: number };
      const pcm = await createDevicePlaybackPcm(
        message.audio_path,
        config.ffmpegPath,
        settings.max_duration_seconds,
      );
      reply.header("cache-control", "private, no-store");
      reply.header("content-length", String(pcm.data.length));
      reply.header("x-message-id", message.id);
      reply.header("x-message-duration-ms", String(message.duration_ms));
      reply.header("x-audio-sample-rate", String(pcm.sampleRate));
      reply.header("x-audio-channels", String(pcm.channels));
      reply.header("x-audio-bits-per-sample", String(pcm.bitsPerSample));
      reply.type("application/octet-stream");
      return reply.send(pcm.data);
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: { format?: "ogg" | "pcm_s16le" };
  }>(
    "/api/device/messages/:id/audio",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            format: { type: "string", enum: ["ogg", "pcm_s16le"] },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = deviceHeaders(request);
      if (!verifyDevice(db, auth.deviceId, auth.credential)) {
        return reply.code(401).send({ error: "Invalid device credentials." });
      }
      const row = db
        .prepare("SELECT audio_path FROM messages WHERE id=? AND device_id=?")
        .get(request.params.id, auth.deviceId) as
        { audio_path: string } | undefined;
      if (!row) return reply.code(404).send({ error: "Message not found." });
      const relativeAudioPath = path.relative(
        config.audioDir,
        path.resolve(row.audio_path),
      );
      if (
        relativeAudioPath.startsWith("..") ||
        path.isAbsolute(relativeAudioPath)
      ) {
        throw new RequestError("Stored audio path is invalid.", 500);
      }
      try {
        const stat = await fsp.stat(row.audio_path);
        if (!stat.isFile()) throw new Error("not a regular file");
      } catch {
        throw new RequestError("Message audio is unavailable.", 404);
      }
      if (request.query.format === "pcm_s16le") {
        const settings = db
          .prepare(
            "SELECT max_duration_seconds FROM settings WHERE device_id=?",
          )
          .get(auth.deviceId) as { max_duration_seconds: number };
        const pcm = await createDevicePlaybackPcm(
          row.audio_path,
          config.ffmpegPath,
          settings.max_duration_seconds,
        );
        reply.header("cache-control", "private, no-store");
        reply.header("content-length", String(pcm.data.length));
        reply.header("x-audio-sample-rate", String(pcm.sampleRate));
        reply.header("x-audio-channels", String(pcm.channels));
        reply.header("x-audio-bits-per-sample", String(pcm.bitsPerSample));
        reply.type("application/octet-stream");
        return reply.send(pcm.data);
      }
      reply.type("audio/ogg");
      return reply.send(fs.createReadStream(row.audio_path));
    },
  );

  app.post<{ Params: { id: string }; Body: { idempotencyKey: string } }>(
    "/api/device/messages/:id/played",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["idempotencyKey"],
          properties: { idempotencyKey: idempotencyKeySchema },
        },
      },
    },
    async (request, reply) => {
      const auth = deviceHeaders(request);
      if (!verifyDevice(db, auth.deviceId, auth.credential))
        return reply.code(401).send({ error: "Invalid device credentials." });
      return service.acknowledgePlayback(
        auth.deviceId,
        request.params.id,
        request.body.idempotencyKey,
      );
    },
  );

  const adminDeviceId = (requestedDeviceId?: string): string => {
    const device = requestedDeviceId
      ? (db
          .prepare("SELECT id FROM devices WHERE id=?")
          .get(requestedDeviceId) as { id: string } | undefined)
      : (db
          .prepare("SELECT id FROM devices ORDER BY created_at,id LIMIT 1")
          .get() as { id: string } | undefined);
    if (requestedDeviceId && !device)
      throw new RequestError("Device not found.", 404);
    if (!device)
      throw new RequestError(
        "Register the message box before using the admin controls.",
        503,
      );
    return device.id;
  };

  const deviceStatus = (device: any) => ({
    id: device.id,
    name: device.name,
    online: device.last_seen_at
      ? Date.now() - Date.parse(device.last_seen_at) < 90_000
      : false,
    lastSeenAt: device.last_seen_at,
    firmwareVersion: device.firmware_version,
    batteryPercent: device.battery_percent,
  });

  const requireFirmwareAdmin = (request: any): void => {
    if (!config.firmwareAdminToken || !firmwareSigningPublicKey)
      throw new RequestError("Firmware updates are not configured.", 503);
    const authorization = String(request.headers.authorization ?? "");
    const suppliedToken = authorization.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : "";
    if (!verifySecret(config.firmwareAdminToken, suppliedToken))
      throw new RequestError("Invalid firmware update credentials.", 401);
    if (request.headers["x-ota-csrf"] !== "1")
      throw new RequestError("The firmware update confirmation header is required.", 403);
    const origin = request.headers.origin;
    if (origin && origin !== config.adminOrigin)
      throw new RequestError("Firmware updates are not allowed from this origin.", 403);
  };

  const parseFirmwareManifestHeader = (request: any): FirmwareManifest => {
    const encoded = String(request.headers["x-firmware-manifest"] ?? "");
    if (!encoded || encoded.length > 2_048)
      throw new FirmwareValidationError("The signed firmware manifest is missing.");
    try {
      return JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    } catch {
      throw new FirmwareValidationError("The signed firmware manifest is invalid.");
    }
  };

  app.post<{
    Querystring: { deviceId?: string };
    Body: Buffer;
  }>(
    "/api/admin/firmware",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { deviceId: idSchema },
        },
      },
    },
    async (request, reply) => {
      requireFirmwareAdmin(request);
      const deviceId = adminDeviceId(request.query.deviceId);
      const manifest = parseFirmwareManifestHeader(request);
      if (manifest.deviceId !== deviceId)
        throw new FirmwareValidationError(
          "The signed firmware package belongs to a different device.",
        );
      if (!Buffer.isBuffer(request.body))
        throw new FirmwareValidationError("The firmware binary is missing.");
      validateFirmwarePackage(
        request.body,
        manifest,
        firmwareSigningPublicKey,
      );
      if (latestFirmwareUpdate(deviceId, true))
        throw new RequestError(
          "This device already has an active firmware update.",
          409,
        );
      const highestBuild = db
        .prepare(
          "SELECT MAX(build) AS build FROM firmware_updates WHERE device_id=? AND state!='failed' AND state!='rolled_back' AND state!='superseded'",
        )
        .get(deviceId) as { build: number | null };
      if (highestBuild.build !== null && manifest.build <= highestBuild.build)
        throw new RequestError(
          "The firmware build must be newer than the last accepted build.",
          409,
        );
      const timestamp = new Date().toISOString();
      db.prepare(
        `INSERT INTO firmware_updates(
          id,device_id,target,version,build,size_bytes,sha256,signature,
          expires_at,state,error,created_at,updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?,'staged',NULL,?,?)`,
      ).run(
        manifest.updateId,
        manifest.deviceId,
        manifest.target,
        manifest.version,
        manifest.build,
        manifest.sizeBytes,
        manifest.sha256,
        manifest.signature,
        manifest.expiresAt,
        timestamp,
        timestamp,
      );
      try {
        await stageFirmwareImage(
          config.firmwareDir,
          manifest.updateId,
          request.body,
        );
      } catch (error) {
        db.prepare(
          "UPDATE firmware_updates SET state='failed',error=?,updated_at=? WHERE id=?",
        ).run("The firmware could not be stored.", new Date().toISOString(), manifest.updateId);
        throw error;
      }
      audit(db, "firmware.staged", "firmware_update", manifest.updateId, deviceId, {
        version: manifest.version,
        build: manifest.build,
        sizeBytes: manifest.sizeBytes,
        sha256: manifest.sha256,
      });
      broadcast(deviceId, {
        type: "firmware.update.available",
        update: manifest,
      } satisfies ServerToDeviceEvent);
      return reply.code(201).send(
        firmwareSummary(
          latestFirmwareUpdate(deviceId, true) as FirmwareUpdateRow,
        ),
      );
    },
  );

  app.get("/api/device/firmware/pending", async (request, reply) => {
    const auth = deviceHeaders(request);
    if (!verifyDevice(db, auth.deviceId, auth.credential))
      return reply.code(401).send({ error: "Invalid device credentials." });
    const update = latestFirmwareUpdate(auth.deviceId, true);
    if (!update || update.expires_at <= Math.floor(Date.now() / 1000))
      return reply.code(204).send();
    return firmwareManifest(update);
  });

  app.get<{ Params: { id: string } }>(
    "/api/device/firmware/:id",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema },
        },
      },
    },
    async (request, reply) => {
      const auth = deviceHeaders(request);
      if (!verifyDevice(db, auth.deviceId, auth.credential))
        return reply.code(401).send({ error: "Invalid device credentials." });
      const update = db
        .prepare("SELECT * FROM firmware_updates WHERE id=? AND device_id=?")
        .get(request.params.id, auth.deviceId) as FirmwareUpdateRow | undefined;
      if (!update || !["staged", "downloading", "installing"].includes(update.state))
        throw new RequestError("Firmware update not found.", 404);
      if (update.expires_at <= Math.floor(Date.now() / 1000))
        throw new RequestError("The firmware update has expired.", 410);
      const storedPath = firmwarePath(config.firmwareDir, update.id);
      const stat = await fsp.stat(storedPath).catch(() => undefined);
      if (!stat?.isFile() || stat.size !== update.size_bytes)
        throw new RequestError("Firmware update not found.", 404);
      reply
        .header("content-type", "application/octet-stream")
        .header("content-length", String(update.size_bytes))
        .header("x-firmware-sha256", update.sha256)
        .header("cache-control", "private, no-store");
      return reply.send(fs.createReadStream(storedPath));
    },
  );

  app.post<{
    Params: { id: string };
    Body: {
      state:
        | "downloading"
        | "installing"
        | "rebooting"
        | "succeeded"
        | "rolled_back"
        | "failed";
      error?: string;
    };
  }>(
    "/api/device/firmware/:id/status",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["state"],
          properties: {
            state: {
              type: "string",
              enum: [
                "downloading",
                "installing",
                "rebooting",
                "succeeded",
                "rolled_back",
                "failed",
              ],
            },
            error: { type: "string", minLength: 1, maxLength: 240 },
          },
        },
      },
    },
    async (request, reply) => {
      const auth = deviceHeaders(request);
      if (!verifyDevice(db, auth.deviceId, auth.credential))
        return reply.code(401).send({ error: "Invalid device credentials." });
      const update = db
        .prepare("SELECT * FROM firmware_updates WHERE id=? AND device_id=?")
        .get(request.params.id, auth.deviceId) as FirmwareUpdateRow | undefined;
      if (!update) throw new RequestError("Firmware update not found.", 404);
      const requestedState = request.body.state;
      const allowedNext: Partial<Record<FirmwareUpdateState, FirmwareUpdateState>> = {
        staged: "downloading",
        downloading: "installing",
        installing: "rebooting",
      };
      const valid =
        requestedState === update.state ||
        (requestedState === "failed" &&
          ["staged", "downloading", "installing"].includes(update.state)) ||
        (["succeeded", "rolled_back"].includes(requestedState) &&
          ["installing", "rebooting"].includes(update.state)) ||
        allowedNext[update.state] === requestedState;
      if (!valid)
        throw new RequestError("Invalid firmware update state transition.", 409);
      const timestamp = new Date().toISOString();
      db.prepare(
        "UPDATE firmware_updates SET state=?,error=?,updated_at=? WHERE id=?",
      ).run(
        requestedState,
        requestedState === "failed" ? request.body.error ?? "Device update failed." : null,
        timestamp,
        update.id,
      );
      audit(db, `firmware.${requestedState}`, "firmware_update", update.id, auth.deviceId, {
        error: requestedState === "failed" ? request.body.error ?? null : null,
      });
      return firmwareSummary(
        db.prepare("SELECT * FROM firmware_updates WHERE id=?").get(update.id) as FirmwareUpdateRow,
      );
    },
  );

  app.get<{ Querystring: { deviceId?: string } }>(
    "/api/admin/dashboard",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { deviceId: idSchema },
        },
      },
    },
    async (request) => {
      const selectedDeviceId = adminDeviceId(request.query.deviceId);
      const device = db
        .prepare("SELECT * FROM devices WHERE id=?")
        .get(selectedDeviceId) as any;
      const devices = db
        .prepare("SELECT * FROM devices ORDER BY created_at,id")
        .all() as any[];
      return {
        device: deviceStatus(device),
        devices: devices.map(deviceStatus),
        config: service.getConfig(device.id),
        messages: service.listMessages(device.id),
        audit: db
          .prepare(
            "SELECT * FROM audit_events WHERE device_id=? ORDER BY created_at DESC LIMIT 30",
          )
          .all(device.id),
        adapter: adapter.name,
        deliveryMode:
          adapter instanceof WhatsAppWebAdapter
            ? "whatsapp-web"
            : config.twilioContentSid
              ? "sandbox-adaptive"
              : "voice-media",
        latestFirmwareUpdate: latestFirmwareUpdate(device.id)
          ? firmwareSummary(latestFirmwareUpdate(device.id) as FirmwareUpdateRow)
          : null,
      };
    },
  );

  app.get("/api/admin/whatsapp/status", async () => {
    if (!(adapter instanceof WhatsAppWebAdapter)) {
      throw new RequestError("The WhatsApp Web adapter is not active.", 404);
    }
    const status = adapter.getStatus();
    return {
      ...status,
      qrDataUrl: status.qr
        ? await QRCode.toDataURL(status.qr, {
            width: 320,
            margin: 2,
            color: { dark: "#1d2e29", light: "#ffffff" },
          })
        : null,
    };
  });

  app.get("/api/box/dashboard", async () => {
    const safeConfig = service.getConfig(adminDeviceId());
    return {
      config: {
        ...safeConfig,
        buttons: safeConfig.buttons.map((button) => ({
          ...button,
          chatId: null,
        })),
      },
      adapter: adapter.name,
      deliveryMode:
        adapter instanceof WhatsAppWebAdapter
          ? "whatsapp-web"
          : config.twilioContentSid
            ? "sandbox-adaptive"
            : "voice-media",
    };
  });

  app.get("/api/box/status", async () => {
    return {
      state:
        adapter instanceof WhatsAppWebAdapter
          ? adapter.getStatus().state
          : "ready",
    };
  });

  app.put<{
    Params: { slot: string };
    Querystring: { deviceId?: string };
    Body: { recipientKey: string; displayName: string; chatId: string };
  }>(
    "/api/admin/buttons/:slot",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["slot"],
          properties: { slot: { type: "string", pattern: "^[1-8]$" } },
        },
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { deviceId: idSchema },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["recipientKey", "displayName", "chatId"],
          properties: {
            recipientKey: recipientKeySchema,
            displayName: { type: "string", minLength: 1, maxLength: 80 },
            chatId: { type: "string", minLength: 1, maxLength: 256 },
          },
        },
      },
    },
    async (request) => {
      const body =
        adapter instanceof WhatsAppWebAdapter
          ? {
              ...request.body,
              chatId: normalizeWhatsAppChatId(request.body.chatId),
            }
          : request.body;
      return service.assignSlot(
        adminDeviceId(request.query.deviceId),
        Number(request.params.slot),
        body,
      );
    },
  );
  app.put<{ Querystring: { deviceId?: string }; Body: Record<string, any> }>(
    "/api/admin/settings",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: { deviceId: idSchema },
        },
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            volume: { type: "integer", minimum: 0, maximum: 100 },
            chimeVolume: { type: "integer", minimum: 0, maximum: 100 },
            microphoneGainPercent: {
              type: "integer",
              minimum: 25,
              maximum: 400,
            },
            microphoneNoiseGatePercent: {
              type: "integer",
              minimum: 0,
              maximum: 20,
            },
            minDurationSeconds: { type: "integer", minimum: 1, maximum: 120 },
            maxDurationSeconds: { type: "integer", minimum: 1, maximum: 120 },
            quietHoursStart: timeSchema,
            quietHoursEnd: timeSchema,
            timezone: { type: "string", minLength: 1, maxLength: 64 },
          },
        },
      },
    },
    async (request) =>
      service.updateSettings(
        adminDeviceId(request.query.deviceId),
        request.body,
      ),
  );
  app.post<{ Params: { id: string } }>(
    "/api/admin/messages/:id/retry",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema },
        },
      },
    },
    async (request) => {
      await service.deliver(request.params.id);
      return { ok: true };
    },
  );

  app.post<{
    Body: { deviceId: string; recipientKey: string; durationMs?: number };
  }>(
    "/api/admin/mock/incoming",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["deviceId", "recipientKey"],
          properties: {
            deviceId: idSchema,
            recipientKey: recipientKeySchema,
            durationMs: { type: "integer", minimum: 1, maximum: 120_000 },
          },
        },
      },
    },
    async (request) => {
      if (!(adapter instanceof MockMessagingAdapter)) {
        throw new RequestError("The mock adapter is not active.", 409);
      }
      const durationMs = request.body.durationMs ?? 4_000;
      const mapping = db
        .prepare(
          `
      SELECT cm.chat_id FROM chat_mappings cm
      JOIN recipients r ON r.id=cm.recipient_id
      JOIN button_slots bs ON bs.recipient_id=r.id
      WHERE cm.adapter=? AND bs.device_id=? AND r.recipient_key=?
    `,
        )
        .get(adapter.name, request.body.deviceId, request.body.recipientKey) as
        { chat_id: string } | undefined;
      if (!mapping)
        throw new RequestError(
          "Recipient is not assigned to this device.",
          404,
        );
      const converted = await convertToOpus({
        input: createSimulatorWav(durationMs),
        mime: "audio/wav",
        audioDir: config.audioDir,
        ffmpegPath: config.ffmpegPath,
        maxBytes: config.maxUploadBytes,
        minDurationSeconds: 0,
        maxDurationSeconds: 120,
        ...(process.env.NODE_ENV === "test"
          ? { fixtureDurationMs: durationMs }
          : {}),
      });
      let messageId: string;
      try {
        messageId = await service.receiveIncoming({
          adapterMessageId: `mock-in-${nanoid()}`,
          chatId: mapping.chat_id,
          audio: await fsp.readFile(converted.audioPath),
          mime: converted.mime,
          durationMs,
        });
      } finally {
        await fsp.rm(converted.audioPath, { force: true });
      }
      return { messageId };
    },
  );

  app.post<{
    Body: {
      deviceId: string;
      recipientKey: string;
      durationMs: number;
      idempotencyKey: string;
    };
  }>(
    "/api/admin/simulator/recording",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "deviceId",
            "recipientKey",
            "durationMs",
            "idempotencyKey",
          ],
          properties: {
            deviceId: idSchema,
            recipientKey: recipientKeySchema,
            durationMs: { type: "number", minimum: 1, maximum: 120_000 },
            idempotencyKey: idempotencyKeySchema,
          },
        },
      },
    },
    async (request, reply) => {
      const settings = service.getConfig(request.body.deviceId).settings;
      const minimumMs = settings.minDurationSeconds * 1_000;
      const maximumMs = settings.maxDurationSeconds * 1_000;
      const durationMs = Math.round(request.body.durationMs);
      if (
        !Number.isFinite(durationMs) ||
        durationMs < minimumMs ||
        durationMs > maximumMs
      ) {
        return reply.code(400).send({
          error: `Recording duration must be between ${settings.minDurationSeconds} and ${settings.maxDurationSeconds} seconds.`,
        });
      }
      const duplicate = db
        .prepare(
          `SELECT m.id,m.delivery_state,m.error,r.recipient_key
       FROM messages m JOIN recipients r ON r.id=m.recipient_id
       WHERE m.device_id=? AND m.idempotency_key=?`,
        )
        .get(request.body.deviceId, request.body.idempotencyKey) as any;
      if (duplicate) {
        if (duplicate.recipient_key !== request.body.recipientKey) {
          throw new RequestError(
            "This idempotency key was already used for another recipient.",
            409,
          );
        }
        return {
          messageId: duplicate.id,
          deliveryState: duplicate.delivery_state,
          error: duplicate.error,
          duplicate: true,
        };
      }

      const messageId = nanoid();
      const converted = await convertToOpus({
        input: createSimulatorWav(durationMs),
        mime: "audio/wav",
        audioDir: config.audioDir,
        ffmpegPath: config.ffmpegPath,
        maxBytes: config.maxUploadBytes,
        minDurationSeconds: settings.minDurationSeconds,
        maxDurationSeconds: settings.maxDurationSeconds,
        ...(process.env.NODE_ENV === "test"
          ? { fixtureDurationMs: durationMs }
          : {}),
      });
      const audioPath = converted.audioPath;
      let created;
      try {
        created = service.createOutgoing({
          messageId,
          deviceId: request.body.deviceId,
          recipientKey: request.body.recipientKey,
          audioPath,
          originalMime: "audio/ogg",
          durationMs,
          idempotencyKey: request.body.idempotencyKey,
        });
      } catch (error) {
        await fsp.rm(audioPath, { force: true });
        throw error;
      }
      if (created.duplicate) await fsp.rm(audioPath, { force: true });
      try {
        await service.deliver(created.id);
      } catch {
        // The persisted failed state is returned for inspection in the simulator.
      }
      const row = db
        .prepare(
          "SELECT delivery_state,error,transport_mode FROM messages WHERE id=?",
        )
        .get(created.id) as any;
      return {
        messageId: created.id,
        deliveryState: row.delivery_state,
        error: row.error,
        transportMode: row.transport_mode,
      };
    },
  );

  app.post(
    "/api/admin/simulator/recording/audio",
    {
      schema: {
        headers: {
          type: "object",
          required: ["x-device-id", "x-recipient-key", "idempotency-key"],
          properties: {
            "x-device-id": idSchema,
            "x-recipient-key": recipientKeySchema,
            "idempotency-key": idempotencyKeySchema,
          },
        },
      },
    },
    async (request, reply) => {
      const deviceId = String(request.headers["x-device-id"] ?? "");
      const recipientKey = String(request.headers["x-recipient-key"] ?? "");
      const idempotencyKey = String(request.headers["idempotency-key"] ?? "");
      const duplicate = db
        .prepare(
          `SELECT m.id,m.delivery_state,m.error,m.transport_mode,r.recipient_key
       FROM messages m JOIN recipients r ON r.id=m.recipient_id
       WHERE m.device_id=? AND m.idempotency_key=?`,
        )
        .get(deviceId, idempotencyKey) as any;
      if (duplicate) {
        if (duplicate.recipient_key !== recipientKey) {
          throw new RequestError(
            "This idempotency key was already used for another recipient.",
            409,
          );
        }
        return {
          messageId: duplicate.id,
          deliveryState: duplicate.delivery_state,
          error: duplicate.error,
          transportMode: duplicate.transport_mode,
          duplicate: true,
        };
      }
      const part = await request.file();
      if (!part)
        throw new RequestError("One microphone recording is required.", 400);
      const settings = service.getConfig(deviceId).settings;
      const converted = await convertToOpus({
        input: await part.toBuffer(),
        mime: part.mimetype,
        audioDir: config.audioDir,
        ffmpegPath: config.ffmpegPath,
        maxBytes: config.maxUploadBytes,
        minDurationSeconds: settings.minDurationSeconds,
        maxDurationSeconds: settings.maxDurationSeconds,
        ...(process.env.NODE_ENV === "test"
          ? { fixtureDurationMs: 4_000 }
          : {}),
      });
      const messageId = nanoid();
      let created;
      try {
        created = service.createOutgoing({
          messageId,
          deviceId,
          recipientKey,
          audioPath: converted.audioPath,
          originalMime: part.mimetype,
          durationMs: converted.durationMs,
          idempotencyKey,
        });
      } catch (error) {
        await fsp.rm(converted.audioPath, { force: true });
        throw error;
      }
      if (created.duplicate) await fsp.rm(converted.audioPath, { force: true });
      try {
        await service.deliver(created.id);
      } catch {
        // The persisted failure is returned so the simulator can show it.
      }
      const row = db
        .prepare(
          "SELECT delivery_state,error,transport_mode FROM messages WHERE id=?",
        )
        .get(created.id) as any;
      return reply.code(created.duplicate ? 200 : 201).send({
        messageId: created.id,
        deliveryState: row.delivery_state,
        error: row.error,
        transportMode: row.transport_mode,
        duplicate: created.duplicate,
      });
    },
  );

  app.get<{ Querystring: { deviceId: string; recipientKey: string } }>(
    "/api/admin/simulator/messages/next",
    {
      schema: {
        querystring: {
          type: "object",
          additionalProperties: false,
          required: ["deviceId", "recipientKey"],
          properties: {
            deviceId: idSchema,
            recipientKey: recipientKeySchema,
          },
        },
      },
    },
    async (request, reply) => {
      const message = service.oldestWaiting(
        request.query.deviceId,
        request.query.recipientKey,
      );
      if (!message) return reply.code(204).send();
      return {
        id: message.id,
        duration_ms: message.duration_ms,
        created_at: message.created_at,
        audioUrl: `/api/admin/simulator/messages/${encodeURIComponent(message.id)}/audio`,
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    "/api/admin/simulator/messages/:id/audio",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema },
        },
      },
    },
    async (request, reply) => {
      const row = db
        .prepare(
          "SELECT audio_path FROM messages WHERE id=? AND direction='incoming'",
        )
        .get(request.params.id) as { audio_path: string } | undefined;
      if (!row)
        throw new RequestError("Incoming message audio was not found.", 404);
      const relativeAudioPath = path.relative(
        config.audioDir,
        path.resolve(row.audio_path),
      );
      if (
        relativeAudioPath.startsWith("..") ||
        path.isAbsolute(relativeAudioPath)
      ) {
        throw new RequestError("Stored audio path is invalid.", 500);
      }
      try {
        const stat = await fsp.stat(row.audio_path);
        if (!stat.isFile()) throw new Error("not a regular file");
      } catch {
        throw new RequestError("Message audio is unavailable.", 404);
      }
      reply.header("cache-control", "private, no-store");
      reply.type("audio/ogg");
      return reply.send(fs.createReadStream(row.audio_path));
    },
  );

  app.post<{
    Params: { id: string };
    Body: { deviceId: string; idempotencyKey: string };
  }>(
    "/api/admin/simulator/messages/:id/played",
    {
      schema: {
        params: {
          type: "object",
          additionalProperties: false,
          required: ["id"],
          properties: { id: idSchema },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["deviceId", "idempotencyKey"],
          properties: {
            deviceId: idSchema,
            idempotencyKey: idempotencyKeySchema,
          },
        },
      },
    },
    async (request) => {
      return service.acknowledgePlayback(
        request.body.deviceId,
        request.params.id,
        request.body.idempotencyKey,
      );
    },
  );

  const adminDist = path.resolve(import.meta.dirname, "../../admin/dist");
  if (fs.existsSync(adminDist)) {
    await app.register(fastifyStatic, { root: adminDist, wildcard: false });
    app.get("/*", async (_request, reply) => reply.sendFile("index.html"));
  }

  await adapter.start();
  let queueWork: Promise<void> = Promise.resolve();
  const scheduleQueueWork = () => {
    queueWork = queueWork
      .then(async () => {
        await service.processQueuedMessages();
      })
      .catch((error) => app.log.error(error, "Queued delivery worker failed"));
  };
  const queueTimer = setInterval(() => {
    scheduleQueueWork();
  }, 15_000);
  queueTimer.unref();
  scheduleQueueWork();

  app.addHook("onClose", async () => {
    clearInterval(queueTimer);
    await queueWork;
    await adapter.stop();
    db.close();
  });
  return { app, db, service, adapter, config };
}
