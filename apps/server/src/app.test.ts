import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp, type AppContext } from "./app.js";
import { seedDevice } from "./db.js";

let tempDir: string;
let context: AppContext;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "family-box-api-"));
  context = await buildApp({
    host: "127.0.0.1",
    databasePath: ":memory:",
    audioDir: tempDir,
    mockAdapter: true,
    seedDevelopmentDevice: true,
    developmentDeviceCredential: "dev-device-secret",
  });
});
afterEach(async () => {
  await context.app.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("mock end-to-end API", () => {
  it("configures eight slots, receives, plays, and clears only one queued message", async () => {
    const dashboard = await context.app.inject({
      method: "GET",
      url: "/api/admin/dashboard",
    });
    expect(dashboard.json().config.buttons).toHaveLength(8);
    await context.app.inject({
      method: "PUT",
      url: "/api/admin/buttons/1",
      payload: {
        recipientKey: "gran",
        displayName: "Gran",
        chatId: "mock:gran-custom",
      },
    });
    const incomingPayload = { deviceId: "family-box-01", recipientKey: "gran" };
    const first = await context.app.inject({
      method: "POST",
      url: "/api/admin/mock/incoming",
      payload: incomingPayload,
    });
    await context.app.inject({
      method: "POST",
      url: "/api/admin/mock/incoming",
      payload: incomingPayload,
    });
    const waitingConfig = context.service.getConfig("family-box-01").buttons[0];
    expect(waitingConfig?.nextMessageId).toBe(first.json().messageId);
    const headers = {
      "x-device-id": "family-box-01",
      "x-device-credential": "dev-device-secret",
    };
    const next = await context.app.inject({
      method: "GET",
      url: "/api/device/messages/next?recipientKey=gran",
      headers,
    });
    expect(next.json().id).toBe(first.json().messageId);
    expect(next.json()).not.toHaveProperty("audio_path");
    const waiting = await context.app.inject({
      method: "GET",
      url: "/api/admin/simulator/messages/next?deviceId=family-box-01&recipientKey=gran",
    });
    expect(waiting.json()).not.toHaveProperty("audio_path");
    const played = await context.app.inject({
      method: "POST",
      url: `/api/admin/simulator/messages/${waiting.json().id}/played`,
      payload: { deviceId: "family-box-01", idempotencyKey: "play-action-1" },
    });
    expect(played.statusCode).toBe(200);
    expect(played.json().state).toBe("played");
    const after = await context.app.inject({
      method: "GET",
      url: "/api/device/messages/next?recipientKey=gran",
      headers,
    });
    expect(after.statusCode).toBe(200);
    expect(after.json().id).not.toBe(first.json().messageId);
  });

  it("requires valid device credentials", async () => {
    const response = await context.app.inject({
      method: "GET",
      url: "/api/device/config",
      headers: {
        "x-device-id": "family-box-01",
        "x-device-credential": "wrong",
      },
    });
    expect(response.statusCode).toBe(401);
  });

  it("records authenticated bounded playback failure telemetry", async () => {
    await context.app.inject({
      method: "PUT",
      url: "/api/admin/buttons/1",
      payload: {
        recipientKey: "gran",
        displayName: "Gran",
        chatId: "mock:gran",
      },
    });
    const messageId = await context.service.receiveIncoming({
      adapterMessageId: "telemetry-message",
      chatId: "mock:gran",
      audio: Buffer.from("stored source audio"),
      mime: "audio/ogg",
      durationMs: 4_000,
    });
    const payload = {
      messageId,
      phase: "fused_stream",
      reason: "stream_disconnected",
      bytesReceived: 32_768,
      contentLength: 128_000,
      httpStatus: 200,
    };

    const unauthorized = await context.app.inject({
      method: "POST",
      url: "/api/device/playback/failures",
      headers: {
        "x-device-id": "family-box-01",
        "x-device-credential": "wrong",
      },
      payload,
    });
    expect(unauthorized.statusCode).toBe(401);

    const recorded = await context.app.inject({
      method: "POST",
      url: "/api/device/playback/failures",
      headers: {
        "x-device-id": "family-box-01",
        "x-device-credential": "dev-device-secret",
      },
      payload,
    });
    expect(recorded.statusCode).toBe(201);
    expect(recorded.json()).toEqual({ ok: true, duplicate: false });

    const duplicate = await context.app.inject({
      method: "POST",
      url: "/api/device/playback/failures",
      headers: {
        "x-device-id": "family-box-01",
        "x-device-credential": "dev-device-secret",
      },
      payload: { ...payload, bytesReceived: 48_000 },
    });
    expect(duplicate.statusCode).toBe(200);
    expect(duplicate.json()).toEqual({ ok: true, duplicate: true });
    const event = context.db
      .prepare(
        "SELECT action,entity_id,detail_json FROM audit_events WHERE action=? ORDER BY rowid DESC LIMIT 1",
      )
      .get("playback.failed") as {
      action: string;
      entity_id: string;
      detail_json: string;
    };
    expect(event.action).toBe("playback.failed");
    expect(event.entity_id).toBe(messageId);
    expect(JSON.parse(event.detail_json)).toEqual({
      phase: "fused_stream",
      reason: "stream_disconnected",
      occurrences: 2,
      first: {
        bytesReceived: 32_768,
        contentLength: 128_000,
        httpStatus: 200,
      },
      latest: {
        bytesReceived: 48_000,
        contentLength: 128_000,
        httpStatus: 200,
      },
    });
    expect(
      context.db
        .prepare(
          "SELECT COUNT(*) count FROM audit_events WHERE action=? AND entity_id=?",
        )
        .get("playback.failed", messageId),
    ).toEqual({ count: 1 });

    seedDevice(context.db, "other-device", "other-secret");
    context.db
      .prepare("UPDATE messages SET device_id=? WHERE id=?")
      .run("other-device", messageId);
    const wrongDevice = await context.app.inject({
      method: "POST",
      url: "/api/device/playback/failures",
      headers: {
        "x-device-id": "family-box-01",
        "x-device-credential": "dev-device-secret",
      },
      payload,
    });
    expect(wrongDevice.statusCode).toBe(404);

    const malformed = await context.app.inject({
      method: "POST",
      url: "/api/device/playback/failures",
      headers: {
        "x-device-id": "family-box-01",
        "x-device-credential": "dev-device-secret",
      },
      payload: { ...payload, reason: "everything_broke" },
    });
    expect(malformed.statusCode).toBe(400);
  });

  it("defaults playback and chime volume to sixty percent", async () => {
    const dashboard = await context.app.inject({
      method: "GET",
      url: "/api/admin/dashboard",
    });

    expect(dashboard.statusCode).toBe(200);
    expect(dashboard.json().config.settings.volume).toBe(60);
    expect(dashboard.json().config.settings.chimeVolume).toBe(60);
  });

  it("saves all adjustable audio settings for the device", async () => {
    const saved = await context.app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      payload: {
        volume: 100,
        chimeVolume: 100,
        microphoneGainPercent: 125,
        microphoneNoiseGatePercent: 2,
        minDurationSeconds: 2,
        maxDurationSeconds: 40,
      },
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().settings).toMatchObject({
      volume: 100,
      chimeVolume: 100,
      microphoneGainPercent: 125,
      microphoneNoiseGatePercent: 2,
      minDurationSeconds: 2,
      maxDurationSeconds: 40,
    });

    const config = await context.app.inject({
      method: "GET",
      url: "/api/device/config",
      headers: {
        "x-device-id": "family-box-01",
        "x-device-credential": "dev-device-secret",
      },
    });
    expect(config.json().settings).toMatchObject(saved.json().settings);
  });

  it("accepts full-scale speaker volume and rejects values above it", async () => {
    const response = await context.app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      payload: { volume: 101 },
    });

    expect(response.statusCode).toBe(400);

    const chimeResponse = await context.app.inject({
      method: "PUT",
      url: "/api/admin/settings",
      payload: { chimeVolume: 101 },
    });

    expect(chimeResponse.statusCode).toBe(400);
  });

  it("serves authenticated bounded PCM for physical-device playback", async () => {
    await context.app.inject({
      method: "PUT",
      url: "/api/admin/buttons/1",
      payload: {
        recipientKey: "gran",
        displayName: "Gran",
        chatId: "mock:gran",
      },
    });
    const samples = Buffer.from([0x01, 0x00, 0xff, 0x7f]);
    const ffmpegPath = path.join(tempDir, "fake-playback-ffmpeg.mjs");
    await fs.writeFile(
      ffmpegPath,
      [
        "#!/usr/bin/env node",
        `process.stdout.write(Buffer.from(${JSON.stringify(samples.toString("base64"))}, "base64"));`,
      ].join("\n"),
    );
    await fs.chmod(ffmpegPath, 0o755);
    context.config.ffmpegPath = ffmpegPath;
    const messageId = await context.service.receiveIncoming({
      adapterMessageId: "mock-device-pcm-message",
      chatId: "mock:gran",
      audio: Buffer.from("stored source audio"),
      mime: "audio/ogg",
      durationMs: 4_000,
    });
    const response = await context.app.inject({
      method: "GET",
      url: `/api/device/messages/${messageId}/audio?format=pcm_s16le`,
      headers: {
        "x-device-id": "family-box-01",
        "x-device-credential": "dev-device-secret",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain(
      "application/octet-stream",
    );
    expect(response.headers["x-audio-sample-rate"]).toBe("16000");
    expect(response.headers["x-audio-channels"]).toBe("1");
    expect(response.headers["x-audio-bits-per-sample"]).toBe("16");
    expect(response.rawPayload).toEqual(samples);
  });

  it("serves the oldest waiting message and its PCM in one device request", async () => {
    await context.app.inject({
      method: "PUT",
      url: "/api/admin/buttons/1",
      payload: {
        recipientKey: "gran",
        displayName: "Gran",
        chatId: "mock:gran",
      },
    });
    const samples = Buffer.from([0x01, 0x00, 0xff, 0x7f]);
    const ffmpegPath = path.join(tempDir, "fake-fused-playback-ffmpeg.mjs");
    await fs.writeFile(
      ffmpegPath,
      [
        "#!/usr/bin/env node",
        `process.stdout.write(Buffer.from(${JSON.stringify(samples.toString("base64"))}, "base64"));`,
      ].join("\n"),
    );
    await fs.chmod(ffmpegPath, 0o755);
    context.config.ffmpegPath = ffmpegPath;
    const oldestMessageId = await context.service.receiveIncoming({
      adapterMessageId: "mock-fused-pcm-oldest",
      chatId: "mock:gran",
      audio: Buffer.from("oldest stored source audio"),
      mime: "audio/ogg",
      durationMs: 4_000,
    });
    await context.service.receiveIncoming({
      adapterMessageId: "mock-fused-pcm-newest",
      chatId: "mock:gran",
      audio: Buffer.from("newest stored source audio"),
      mime: "audio/ogg",
      durationMs: 3_000,
    });

    const response = await context.app.inject({
      method: "GET",
      url: "/api/device/messages/next/audio?recipientKey=gran&format=pcm_s16le",
      headers: {
        "x-device-id": "family-box-01",
        "x-device-credential": "dev-device-secret",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["x-message-id"]).toBe(oldestMessageId);
    expect(response.headers["x-message-duration-ms"]).toBe("4000");
    expect(response.headers["content-length"]).toBe(String(samples.length));
    expect(response.rawPayload).toEqual(samples);
    expect(context.service.oldestWaiting("family-box-01", "gran").id)
      .toBe(oldestMessageId);
  });

  it("returns no content from fused playback when the recipient queue is empty", async () => {
    await context.app.inject({
      method: "PUT",
      url: "/api/admin/buttons/1",
      payload: {
        recipientKey: "gran",
        displayName: "Gran",
        chatId: "mock:gran",
      },
    });

    const response = await context.app.inject({
      method: "GET",
      url: "/api/device/messages/next/audio?recipientKey=gran&format=pcm_s16le",
      headers: {
        "x-device-id": "family-box-01",
        "x-device-credential": "dev-device-secret",
      },
    });

    expect(response.statusCode).toBe(204);
  });

  it("accepts and normalizes a fractional simulated recording duration and rejects one below the minimum", async () => {
    await context.app.inject({
      method: "PUT",
      url: "/api/admin/buttons/1",
      payload: {
        recipientKey: "gran",
        displayName: "Gran",
        chatId: "mock:gran",
      },
    });
    const sent = await context.app.inject({
      method: "POST",
      url: "/api/admin/simulator/recording",
      payload: {
        deviceId: "family-box-01",
        recipientKey: "gran",
        durationMs: 3_200.42,
        idempotencyKey: "fixture1",
      },
    });
    expect(sent.statusCode).toBe(200);
    expect(sent.json().deliveryState).toBe("sent");

    const tooShort = await context.app.inject({
      method: "POST",
      url: "/api/admin/simulator/recording",
      payload: {
        deviceId: "family-box-01",
        recipientKey: "gran",
        durationMs: 2_999,
        idempotencyKey: "fixture2",
      },
    });
    expect(tooShort.statusCode).toBe(400);
  });

  it("accepts a browser microphone recording and sends the converted voice note", async () => {
    await context.app.inject({
      method: "PUT",
      url: "/api/admin/buttons/1",
      payload: {
        recipientKey: "gran",
        displayName: "Gran",
        chatId: "mock:gran",
      },
    });
    const boundary = "----family-message-box-test";
    const body = Buffer.from(
      [
        `--${boundary}`,
        'Content-Disposition: form-data; name="audio"; filename="recording.webm"',
        "Content-Type: audio/webm",
        "",
        "browser microphone bytes",
        `--${boundary}--`,
        "",
      ].join("\r\n"),
    );
    const sent = await context.app.inject({
      method: "POST",
      url: "/api/admin/simulator/recording/audio",
      headers: {
        "content-type": `multipart/form-data; boundary=${boundary}`,
        "x-device-id": "family-box-01",
        "x-recipient-key": "gran",
        "idempotency-key": "microphone-recording-1",
      },
      payload: body,
    });
    expect(sent.statusCode).toBe(201);
    expect(sent.json()).toMatchObject({
      deliveryState: "sent",
      transportMode: null,
      duplicate: false,
    });
  });

  it("rejects malformed admin input at the HTTP boundary", async () => {
    const response = await context.app.inject({
      method: "PUT",
      url: "/api/admin/buttons/7",
      payload: { recipientKey: "x", displayName: "", chatId: "" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({
      error: "The request did not match the API contract.",
    });
  });

  it("registers multiple devices without seeding known LAN credentials", async () => {
    const isolated = await buildApp({
      databasePath: ":memory:",
      audioDir: tempDir,
      mockAdapter: true,
      seedDevelopmentDevice: false,
      deviceBootstrapToken: "test-bootstrap-token-1234",
    });
    try {
      const before = await isolated.app.inject({
        method: "GET",
        url: "/api/admin/dashboard",
      });
      expect(before.statusCode).toBe(503);

      const registered = await isolated.app.inject({
        method: "POST",
        url: "/api/devices/register",
        payload: {
          deviceId: "kitchen-box",
          name: "Kitchen box",
          bootstrapToken: "test-bootstrap-token-1234",
        },
      });
      expect(registered.statusCode).toBe(200);

      const assignment = await isolated.app.inject({
        method: "PUT",
        url: "/api/admin/buttons/1",
        payload: {
          recipientKey: "gran",
          displayName: "Gran",
          chatId: "mock:gran",
        },
      });
      expect(assignment.statusCode).toBe(200);
      expect(assignment.json().deviceId).toBe("kitchen-box");

      const second = await isolated.app.inject({
        method: "POST",
        url: "/api/devices/register",
        payload: {
          deviceId: "different-box",
          bootstrapToken: "test-bootstrap-token-1234",
        },
      });
      expect(second.statusCode).toBe(200);

      const secondDashboard = await isolated.app.inject({
        method: "GET",
        url: "/api/admin/dashboard?deviceId=different-box",
      });
      expect(secondDashboard.statusCode).toBe(200);
      expect(secondDashboard.json().device.id).toBe("different-box");
      expect(
        secondDashboard
          .json()
          .devices.map((device: { id: string }) => device.id)
          .sort(),
      ).toEqual(["different-box", "kitchen-box"]);
      expect(
        secondDashboard
          .json()
          .config.buttons.every(
            (button: { status: string }) => button.status === "unassigned",
          ),
      ).toBe(true);

      const secondAssignment = await isolated.app.inject({
        method: "PUT",
        url: "/api/admin/buttons/1?deviceId=different-box",
        payload: {
          recipientKey: "dad",
          displayName: "Dad",
          chatId: "mock:dad",
        },
      });
      expect(secondAssignment.statusCode).toBe(200);
      expect(secondAssignment.json().deviceId).toBe("different-box");
      expect(secondAssignment.json().buttons[0]).toMatchObject({
        recipientKey: "dad",
      });

      const missing = await isolated.app.inject({
        method: "GET",
        url: "/api/admin/dashboard?deviceId=missing-box",
      });
      expect(missing.statusCode).toBe(404);
    } finally {
      await isolated.app.close();
    }
  });

  it("rejects unsigned Twilio webhooks before processing their media", async () => {
    const live = await buildApp({
      databasePath: ":memory:",
      audioDir: tempDir,
      mockAdapter: false,
      twilioAccountSid: "AC00000000000000000000000000000000",
      twilioAuthToken: "test-auth-token",
      twilioPublicBaseUrl: "https://box.example",
    });
    try {
      const response = await live.app.inject({
        method: "POST",
        url: "/api/twilio/webhook",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "x-twilio-signature": "invalid",
        },
        payload:
          "MessageSid=SM11111111111111111111111111111111&From=whatsapp%3A%2B34600000000&NumMedia=0",
      });
      expect(response.statusCode).toBe(403);
    } finally {
      await live.app.close();
    }
  });
});
