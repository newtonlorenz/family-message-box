import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, migrate, seedDevice, type Db } from "./db.js";
import { MockMessagingAdapter } from "./adapters/mock.js";
import type { MessagingAdapter } from "./adapters/types.js";
import { UnknownDeliveryConfirmationError } from "./adapters/types.js";
import { MessageService } from "./service.js";
import { convertToOpus, AudioValidationError } from "./audio.js";
import { isQuietHours } from "./quiet-hours.js";

let tempDir: string;
let db: Db;
let adapter: MockMessagingAdapter;
let service: MessageService;
let clock: Date;
let notifications: Array<{ deviceId: string; event: any }>;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "family-box-test-"));
  db = openDatabase(path.join(tempDir, "test.db"));
  migrate(db);
  seedDevice(db);
  adapter = new MockMessagingAdapter();
  clock = new Date("2026-07-30T12:00:00Z");
  notifications = [];
  service = new MessageService(
    db,
    adapter,
    tempDir,
    (deviceId, event) => notifications.push({ deviceId, event }),
    () => clock,
  );
  await adapter.start();
  service.assignSlot("family-box-01", 1, {
    recipientKey: "mum",
    displayName: "Mum",
    chatId: "mock:mum",
  });
  service.assignSlot("family-box-01", 2, {
    recipientKey: "dad",
    displayName: "Dad",
    chatId: "mock:dad",
  });
});

afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("message service", () => {
  it("orders incoming messages oldest first and isolates recipients", async () => {
    const mum1 = await service.receiveIncoming({
      adapterMessageId: "m1",
      chatId: "mock:mum",
      audio: Buffer.from("OggS1"),
      mime: "audio/ogg",
    });
    await new Promise((resolve) => setTimeout(resolve, 2));
    const mum2 = await service.receiveIncoming({
      adapterMessageId: "m2",
      chatId: "mock:mum",
      audio: Buffer.from("OggS2"),
      mime: "audio/ogg",
    });
    const dad = await service.receiveIncoming({
      adapterMessageId: "d1",
      chatId: "mock:dad",
      audio: Buffer.from("OggS3"),
      mime: "audio/ogg",
    });
    expect(service.oldestWaiting("family-box-01", "mum").id).toBe(mum1);
    expect(service.oldestWaiting("family-box-01", "dad").id).toBe(dad);
    service.acknowledgePlayback("family-box-01", mum1, "played-1");
    expect(service.oldestWaiting("family-box-01", "mum").id).toBe(mum2);
    expect(service.oldestWaiting("family-box-01", "dad").id).toBe(dad);
  });

  it("makes playback acknowledgement idempotent", async () => {
    const id = await service.receiveIncoming({
      adapterMessageId: "m1",
      chatId: "mock:mum",
      audio: Buffer.from("OggS"),
      mime: "audio/ogg",
    });
    expect(
      service.acknowledgePlayback("family-box-01", id, "same-key"),
    ).toEqual({ messageId: id, state: "played" });
    expect(
      service.acknowledgePlayback("family-box-01", id, "same-key"),
    ).toMatchObject({ messageId: id, state: "played", duplicate: true });
  });

  it("rejects reusing a playback idempotency key for another message", async () => {
    const first = await service.receiveIncoming({
      adapterMessageId: "m1",
      chatId: "mock:mum",
      audio: Buffer.from("OggS1"),
      mime: "audio/ogg",
    });
    const second = await service.receiveIncoming({
      adapterMessageId: "m2",
      chatId: "mock:mum",
      audio: Buffer.from("OggS2"),
      mime: "audio/ogg",
    });
    service.acknowledgePlayback("family-box-01", first, "shared-playback-key");
    expect(() =>
      service.acknowledgePlayback(
        "family-box-01",
        second,
        "shared-playback-key",
      ),
    ).toThrow("already used for another playback");
  });

  it("publishes exact waiting counts until the matching lamp can turn off", async () => {
    const first = await service.receiveIncoming({
      adapterMessageId: "m1",
      chatId: "mock:mum",
      audio: Buffer.from("OggS1"),
      mime: "audio/ogg",
    });
    const second = await service.receiveIncoming({
      adapterMessageId: "m2",
      chatId: "mock:mum",
      audio: Buffer.from("OggS2"),
      mime: "audio/ogg",
    });
    service.acknowledgePlayback("family-box-01", first, "play-first");
    service.acknowledgePlayback("family-box-01", second, "play-second");
    const queueEvents = notifications
      .filter(({ event }) => event.type === "queue.updated")
      .map(({ deviceId, event }) => ({
        deviceId,
        slot: event.slot,
        waitingCount: event.waitingCount,
      }));
    expect(queueEvents).toEqual([
      { deviceId: "family-box-01", slot: 1, waitingCount: 1 },
      { deviceId: "family-box-01", slot: 1, waitingCount: 2 },
      { deviceId: "family-box-01", slot: 1, waitingCount: 1 },
      { deviceId: "family-box-01", slot: 1, waitingCount: 0 },
    ]);
  });

  it("sends outgoing messages once across retries", async () => {
    const audioPath = path.join(tempDir, "voice.ogg");
    await fs.writeFile(audioPath, "OggS");
    service.createOutgoing({
      messageId: "out-1",
      deviceId: "family-box-01",
      recipientKey: "mum",
      audioPath,
      originalMime: "audio/wav",
      durationMs: 4_000,
      idempotencyKey: "upload-1",
    });
    await service.deliver("out-1");
    await service.deliver("out-1");
    expect(adapter.sent.size).toBe(1);
    expect(service.listMessages()[0]?.deliveryState).toBe("sent");
  });

  it("does not retry a send whose provider confirmation is unknown", async () => {
    let calls = 0;
    const uncertainAdapter: MessagingAdapter = {
      name: "uncertain",
      onIncoming: () => {},
      start: async () => {},
      stop: async () => {},
      sendVoiceMessage: async () => {
        calls++;
        throw new UnknownDeliveryConfirmationError(
          "WhatsApp did not return a sent-message confirmation.",
          "voice-media",
        );
      },
    };
    const uncertainService = new MessageService(db, uncertainAdapter, tempDir);
    uncertainService.assignSlot("family-box-01", 1, {
      recipientKey: "mum",
      displayName: "Mum",
      chatId: "uncertain:mum",
    });
    const audioPath = path.join(tempDir, "uncertain.ogg");
    await fs.writeFile(audioPath, "OggS");
    uncertainService.createOutgoing({
      messageId: "uncertain-1",
      deviceId: "family-box-01",
      recipientKey: "mum",
      audioPath,
      originalMime: "audio/wav",
      durationMs: 4_000,
      idempotencyKey: "uncertain-upload",
    });
    db.prepare("UPDATE messages SET delivery_state='queued' WHERE id=?").run(
      "uncertain-1",
    );

    expect(await uncertainService.processQueuedMessages()).toEqual({
      processed: 1,
      sent: 0,
      failed: 0,
    });
    expect(uncertainService.listMessages()[0]?.deliveryState).toBe(
      "confirmation_unknown",
    );
    expect(
      db
        .prepare(
          "SELECT attempts,source_message_id,transport_mode FROM messages WHERE id=?",
        )
        .get("uncertain-1"),
    ).toEqual({
      attempts: 1,
      source_message_id: null,
      transport_mode: "voice-media",
    });
    expect(
      db
        .prepare(
          "SELECT action FROM audit_events WHERE entity_id=? ORDER BY rowid DESC LIMIT 1",
        )
        .get("uncertain-1"),
    ).toEqual({ action: "message.confirmation_unknown" });

    await expect(uncertainService.deliver("uncertain-1")).rejects.toThrow(
      "cannot be retried",
    );
    expect(calls).toBe(1);
  });

  it("rejects reusing an upload idempotency key for another recipient", async () => {
    const audioPath = path.join(tempDir, "voice.ogg");
    await fs.writeFile(audioPath, "OggS");
    service.createOutgoing({
      messageId: "out-1",
      deviceId: "family-box-01",
      recipientKey: "mum",
      audioPath,
      originalMime: "audio/wav",
      durationMs: 4_000,
      idempotencyKey: "shared-upload-key",
    });
    expect(() =>
      service.createOutgoing({
        messageId: "out-2",
        deviceId: "family-box-01",
        recipientKey: "dad",
        audioPath,
        originalMime: "audio/wav",
        durationMs: 4_000,
        idempotencyKey: "shared-upload-key",
      }),
    ).toThrow("already used for another recipient");
  });

  it("persists an explicit sending state before crossing the adapter boundary", async () => {
    let releaseSend: (() => void) | undefined;
    const blockingAdapter: MessagingAdapter = {
      name: "blocking",
      onIncoming: () => {},
      start: async () => {},
      stop: async () => {},
      sendVoiceMessage: async () => {
        await new Promise<void>((resolve) => {
          releaseSend = resolve;
        });
        return { adapterMessageId: "provider-1" };
      },
    };
    const blockingService = new MessageService(db, blockingAdapter, tempDir);
    blockingService.assignSlot("family-box-01", 1, {
      recipientKey: "mum",
      displayName: "Mum",
      chatId: "blocking:mum",
    });
    const audioPath = path.join(tempDir, "blocked.ogg");
    await fs.writeFile(audioPath, "OggS");
    blockingService.createOutgoing({
      messageId: "blocked-1",
      deviceId: "family-box-01",
      recipientKey: "mum",
      audioPath,
      originalMime: "audio/wav",
      durationMs: 4_000,
      idempotencyKey: "blocked-upload",
    });
    const delivery = blockingService.deliver("blocked-1");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(blockingService.listMessages()[0]?.deliveryState).toBe("sending");
    releaseSend?.();
    await delivery;
    expect(blockingService.listMessages()[0]?.deliveryState).toBe("sent");
  });

  it("serializes concurrent delivery requests for the same message", async () => {
    let calls = 0;
    const adapterWithLatency: MessagingAdapter = {
      name: "serialized",
      onIncoming: () => {},
      start: async () => {},
      stop: async () => {},
      sendVoiceMessage: async () => {
        calls++;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { adapterMessageId: "provider-serialized" };
      },
    };
    const serializedService = new MessageService(
      db,
      adapterWithLatency,
      tempDir,
    );
    serializedService.assignSlot("family-box-01", 1, {
      recipientKey: "mum",
      displayName: "Mum",
      chatId: "serialized:mum",
    });
    const audioPath = path.join(tempDir, "serialized.ogg");
    await fs.writeFile(audioPath, "OggS");
    serializedService.createOutgoing({
      messageId: "serialized-1",
      deviceId: "family-box-01",
      recipientKey: "mum",
      audioPath,
      originalMime: "audio/wav",
      durationMs: 4_000,
      idempotencyKey: "serialized-upload",
    });
    await Promise.all([
      serializedService.deliver("serialized-1"),
      serializedService.deliver("serialized-1"),
    ]);
    expect(calls).toBe(1);
  });

  it("deduplicates concurrent incoming provider events in the database", async () => {
    const [first, second] = await Promise.all([
      service.receiveIncoming({
        adapterMessageId: "provider-same",
        chatId: "mock:mum",
        audio: Buffer.from("OggS1"),
        mime: "audio/ogg",
      }),
      service.receiveIncoming({
        adapterMessageId: "provider-same",
        chatId: "mock:mum",
        audio: Buffer.from("OggS1"),
        mime: "audio/ogg",
      }),
    ]);
    expect(first).toBe(second);
    expect(service.listMessages()).toHaveLength(1);
    expect(
      notifications.filter(({ event }) => event.type === "message.available"),
    ).toEqual([
      {
        deviceId: "family-box-01",
        event: { type: "message.available", slot: 1, messageId: first },
      },
    ]);
    const audioFiles = (await fs.readdir(tempDir)).filter((name) =>
      name.endsWith(".ogg"),
    );
    expect(audioFiles).toHaveLength(1);
  });

  it("rejects assigning one recipient to two physical buttons", () => {
    expect(() =>
      service.assignSlot("family-box-01", 3, {
        recipientKey: "mum",
        displayName: "Mum",
        chatId: "mock:mum",
      }),
    ).toThrow("already assigned to button 1");
    expect(
      service.getConfig("family-box-01").buttons[2]?.recipientKey,
    ).toBeNull();
  });

  it("rejects assigning one adapter chat to two recipients", () => {
    expect(() =>
      service.assignSlot("family-box-01", 2, {
        recipientKey: "dad",
        displayName: "Dad",
        chatId: "mock:mum",
      }),
    ).toThrow("chat is already assigned");
    expect(service.getConfig("family-box-01").buttons[1]?.recipientKey).toBe(
      "dad",
    );
  });

  it("persists audio settings and broadcasts them to the connected device", () => {
    const config = service.updateSettings("family-box-01", {
      volume: 100,
      chimeVolume: 100,
      microphoneGainPercent: 150,
      microphoneNoiseGatePercent: 3,
      minDurationSeconds: 2,
      maxDurationSeconds: 45,
    });

    expect(config.settings).toMatchObject({
      volume: 100,
      chimeVolume: 100,
      microphoneGainPercent: 150,
      microphoneNoiseGatePercent: 3,
      minDurationSeconds: 2,
      maxDurationSeconds: 45,
    });
    expect(notifications.at(-1)).toEqual({
      deviceId: "family-box-01",
      event: { type: "settings.updated", settings: config.settings },
    });
  });

  it("rejects unsafe audio settings", () => {
    expect(() =>
      service.updateSettings("family-box-01", { volume: 101 }),
    ).toThrow("Invalid settings");
    expect(() =>
      service.updateSettings("family-box-01", { chimeVolume: 101 }),
    ).toThrow("Invalid settings");
    expect(() =>
      service.updateSettings("family-box-01", { microphoneGainPercent: 401 }),
    ).toThrow("Invalid settings");
    expect(() =>
      service.updateSettings("family-box-01", {
        microphoneNoiseGatePercent: 21,
      }),
    ).toThrow("Invalid settings");
  });

  it("keeps quiet-hour messages queued", async () => {
    service.updateSettings("family-box-01", {
      quietHoursStart: "00:00",
      quietHoursEnd: "23:59",
      timezone: "UTC",
    });
    const audioPath = path.join(tempDir, "quiet.ogg");
    await fs.writeFile(audioPath, "OggS");
    service.createOutgoing({
      messageId: "quiet-1",
      deviceId: "family-box-01",
      recipientKey: "mum",
      audioPath,
      originalMime: "audio/wav",
      durationMs: 4_000,
      idempotencyKey: "quiet-upload",
    });
    await service.deliver("quiet-1");
    expect(service.listMessages()[0]?.deliveryState).toBe("queued");
    expect(adapter.sent.size).toBe(0);
  });

  it("releases persisted quiet-hour messages after restart", async () => {
    clock = new Date("2026-07-30T23:00:00Z");
    service.updateSettings("family-box-01", {
      quietHoursStart: "22:00",
      quietHoursEnd: "07:00",
      timezone: "UTC",
    });
    const audioPath = path.join(tempDir, "restart.ogg");
    await fs.writeFile(audioPath, "OggS");
    service.createOutgoing({
      messageId: "restart-1",
      deviceId: "family-box-01",
      recipientKey: "mum",
      audioPath,
      originalMime: "audio/wav",
      durationMs: 4_000,
      idempotencyKey: "restart-upload",
    });
    await service.deliver("restart-1");
    expect(service.listMessages()[0]?.deliveryState).toBe("queued");

    clock = new Date("2026-07-31T08:00:00Z");
    db.close();
    db = openDatabase(path.join(tempDir, "test.db"));
    migrate(db);
    adapter = new MockMessagingAdapter();
    await adapter.start();
    const restartedService = new MessageService(
      db,
      adapter,
      tempDir,
      () => {},
      () => clock,
    );
    expect(await restartedService.processQueuedMessages()).toEqual({
      processed: 1,
      sent: 1,
      failed: 0,
    });
    expect(restartedService.listMessages()[0]?.deliveryState).toBe("sent");
    expect(adapter.sent.size).toBe(1);
  });
});

describe("quiet hours", () => {
  it("supports overnight windows", () => {
    expect(
      isQuietHours(new Date("2026-01-01T23:00:00Z"), "22:00", "07:00", "UTC"),
    ).toBe(true);
    expect(
      isQuietHours(new Date("2026-01-01T12:00:00Z"), "22:00", "07:00", "UTC"),
    ).toBe(false);
  });
});

describe("audio validation", () => {
  const wavFixture = Buffer.from("RIFFxxxxWAVE");

  it("rejects unsupported MIME and duration outside bounds", async () => {
    await expect(
      convertToOpus({
        input: Buffer.from("audio"),
        mime: "text/plain",
        audioDir: tempDir,
        ffmpegPath: "ffmpeg",
        maxBytes: 100,
        minDurationSeconds: 3,
        maxDurationSeconds: 30,
        fixtureDurationMs: 4_000,
      }),
    ).rejects.toBeInstanceOf(AudioValidationError);
    await expect(
      convertToOpus({
        input: wavFixture,
        mime: "audio/wav",
        audioDir: tempDir,
        ffmpegPath: "ffmpeg",
        maxBytes: 100,
        minDurationSeconds: 3,
        maxDurationSeconds: 30,
        fixtureDurationMs: 2_000,
      }),
    ).rejects.toThrow("at least 3 seconds");
  });

  it("verifies WAV signatures and raw PCM metadata", async () => {
    await expect(
      convertToOpus({
        input: Buffer.from("not a wav file"),
        mime: "audio/wav",
        audioDir: tempDir,
        ffmpegPath: "ffmpeg",
        maxBytes: 100,
        minDurationSeconds: 3,
        maxDurationSeconds: 30,
        fixtureDurationMs: 4_000,
      }),
    ).rejects.toThrow("no RIFF/WAVE header");
    await expect(
      convertToOpus({
        input: Buffer.alloc(16_000),
        mime: "application/octet-stream",
        audioDir: tempDir,
        ffmpegPath: "ffmpeg",
        maxBytes: 20_000,
        minDurationSeconds: 1,
        maxDurationSeconds: 30,
        fixtureDurationMs: 1_000,
      }),
    ).rejects.toThrow("X-Audio-Sample-Rate");
    await expect(
      convertToOpus({
        input: Buffer.alloc(32_000),
        mime: "application/octet-stream",
        audioDir: tempDir,
        ffmpegPath: "ffmpeg",
        maxBytes: 40_000,
        minDurationSeconds: 1,
        maxDurationSeconds: 30,
        pcmSampleRate: 16_000,
        pcmChannels: 1,
        fixtureDurationMs: 1_000,
      }),
    ).resolves.toMatchObject({ durationMs: 1_000, mime: "audio/ogg" });
  });

  it("uses a deterministic CI fixture without FFmpeg", async () => {
    const result = await convertToOpus({
      input: wavFixture,
      mime: "audio/wav",
      audioDir: tempDir,
      ffmpegPath: "missing",
      maxBytes: 100,
      minDurationSeconds: 3,
      maxDurationSeconds: 30,
      fixtureDurationMs: 4_000,
    });
    expect(result.durationMs).toBe(4_000);
    expect(await fs.readFile(result.audioPath, "utf8")).toContain("OggS");
  });
});
