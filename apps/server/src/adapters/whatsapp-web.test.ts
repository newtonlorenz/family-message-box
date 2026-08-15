import { EventEmitter } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearStaleChromiumProfileLocks,
  type Message,
  type MessageContent,
  type MessageSendOptions,
  normalizeWhatsAppChatId,
  WhatsAppWebAdapter,
} from "./whatsapp-web.js";
import { UnknownDeliveryConfirmationError } from "./types.js";

class FakeClient extends EventEmitter {
  info = { wid: { _serialized: "447700900456@c.us" } };
  sent: Array<{
    chatId: string;
    content: MessageContent;
    options?: MessageSendOptions;
  }> = [];
  lidMappings = new Map<string, string>();

  async initialize(): Promise<void> {}
  async destroy(): Promise<void> {}
  async getContactLidAndPhone(
    userIds: string[],
  ): Promise<Array<{ lid?: string; pn?: string }>> {
    return userIds.map((userId) => {
      const pn = this.lidMappings.get(userId);
      return {
        ...(userId.endsWith("@lid") ? { lid: userId } : {}),
        ...(pn ? { pn } : userId.endsWith("@c.us") ? { pn: userId } : {}),
      };
    });
  }
  async sendMessage(
    chatId: string,
    content: MessageContent,
    options?: MessageSendOptions,
  ): Promise<Message> {
    this.sent.push({ chatId, content, ...(options ? { options } : {}) });
    const message = {
      to: chatId,
      id: { remote: chatId, _serialized: `sent-message-${this.sent.length}` },
    } as unknown as Message;
    return message;
  }
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("WhatsApp Web adapter", () => {
  it("fails clearly when the optional browser integration is unavailable", async () => {
    const adapter = new WhatsAppWebAdapter({
      dataPath: "/tmp/test-session",
      maxMediaBytes: 10_000,
      isAllowedChat: () => true,
      normalizeAudio: async (audio, mime) => ({ audio, mime }),
      prepareOutboundAudio: async () => ({
        data: Buffer.from("OggS opus-audio"),
        mime: "audio/ogg; codecs=opus",
        filename: "family-message-box-message.ogg",
      }),
      loadLibrary: async () => {
        throw new Error("module unavailable");
      },
    });

    await expect(adapter.start()).rejects.toThrow(
      "WhatsApp Web is an optional prototype and is not bundled",
    );
    expect(adapter.getStatus()).toMatchObject({ state: "auth_failure" });
  });

  it("clears Chromium singleton links left by a replaced container", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "whatsapp-web-adapter-"),
    );
    tempDirs.push(directory);
    const sessionPath = path.join(directory, "session-family-message-box");
    await fs.mkdir(sessionPath);
    await fs.symlink(
      "old-container-45",
      path.join(sessionPath, "SingletonLock"),
    );
    await fs.symlink(
      "13536205229421798164",
      path.join(sessionPath, "SingletonCookie"),
    );
    await fs.symlink(
      "/tmp/old-chromium/SingletonSocket",
      path.join(sessionPath, "SingletonSocket"),
    );

    await expect(
      clearStaleChromiumProfileLocks(directory, "new-container"),
    ).resolves.toBe(true);
    await expect(
      fs.lstat(path.join(sessionPath, "SingletonLock")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.lstat(path.join(sessionPath, "SingletonCookie")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(
      fs.lstat(path.join(sessionPath, "SingletonSocket")),
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps Chromium singleton links owned by a live process in this container", async () => {
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "whatsapp-web-adapter-"),
    );
    tempDirs.push(directory);
    const sessionPath = path.join(directory, "session-family-message-box");
    await fs.mkdir(sessionPath);
    const lockPath = path.join(sessionPath, "SingletonLock");
    await fs.symlink("current-container-45", lockPath);

    await expect(
      clearStaleChromiumProfileLocks(
        directory,
        "current-container",
        () => true,
      ),
    ).resolves.toBe(false);
    await expect(fs.readlink(lockPath)).resolves.toBe("current-container-45");
  });

  it("normalizes supported phone number formats", () => {
    expect(normalizeWhatsAppChatId("+44 7700 900 123")).toBe(
      "447700900123@c.us",
    );
    expect(normalizeWhatsAppChatId("whatsapp:+447700900123")).toBe(
      "447700900123@c.us",
    );
    expect(normalizeWhatsAppChatId("447700900123@c.us")).toBe(
      "447700900123@c.us",
    );
  });

  it("publishes QR and ready states and sends prepared Ogg/Opus through WhatsApp's voice-note encoder", async () => {
    const client = new FakeClient();
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "whatsapp-web-adapter-"),
    );
    tempDirs.push(directory);
    const audioPath = path.join(directory, "message.ogg");
    await fs.writeFile(audioPath, "audio");
    const media: MessageContent = {
      fixture: true,
    } as unknown as MessageContent;
    const adapter = new WhatsAppWebAdapter({
      dataPath: directory,
      maxMediaBytes: 10_000,
      isAllowedChat: (chatId) => chatId === "447700900123@c.us",
      normalizeAudio: async (audio, mime) => ({ audio, mime }),
      prepareOutboundAudio: async () => ({
        data: Buffer.from("OggS opus-audio"),
        mime: "audio/ogg; codecs=opus",
        filename: "family-message-box-message-1.ogg",
      }),
      createClient: () => client,
      createMedia: () => media,
    });

    await adapter.start();
    client.emit("qr", "qr-payload");
    expect(adapter.getStatus()).toMatchObject({
      state: "qr",
      qr: "qr-payload",
    });
    client.emit("ready");
    expect(adapter.getStatus()).toMatchObject({
      state: "ready",
      account: "447700900456@c.us",
    });

    const result = await adapter.sendVoiceMessage({
      messageId: "message-1",
      chatId: "whatsapp:+447700900123",
      audioPath,
      idempotencyKey: "send:message-1",
    });
    expect(result).toEqual({
      adapterMessageId: "sent-message-1",
      transportMode: "voice-media",
    });
    expect(client.sent).toEqual([
      {
        chatId: "447700900123@c.us",
        content: media,
        options: { sendAudioAsVoice: true, waitUntilMsgSent: true },
      },
    ]);
  });

  it("classifies a missing WhatsApp result as an unknown confirmation", async () => {
    const client = new FakeClient();
    client.sendMessage = async () => undefined as unknown as Message;
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "whatsapp-web-adapter-"),
    );
    tempDirs.push(directory);
    const audioPath = path.join(directory, "message.ogg");
    await fs.writeFile(audioPath, "audio");
    const adapter = new WhatsAppWebAdapter({
      dataPath: directory,
      maxMediaBytes: 10_000,
      isAllowedChat: () => true,
      normalizeAudio: async (audio, mime) => ({ audio, mime }),
      prepareOutboundAudio: async () => ({
        data: Buffer.from("OggS opus-audio"),
        mime: "audio/ogg; codecs=opus",
        filename: "family-message-box-message.ogg",
      }),
      createClient: () => client,
      createMedia: () => ({ fixture: true }) as unknown as MessageContent,
    });
    await adapter.start();
    client.emit("ready");
    await expect(
      adapter.sendVoiceMessage({
        messageId: "message-without-provider-result",
        chatId: "+447700900123",
        audioPath,
        idempotencyKey: "send:message-without-provider-result",
      }),
    ).rejects.toMatchObject({
      name: UnknownDeliveryConfirmationError.name,
      message: "WhatsApp did not return a sent-message confirmation.",
      transportMode: "voice-media",
    });
  });

  it("serializes modern WhatsApp message IDs that omit _serialized", async () => {
    const client = new FakeClient();
    client.sendMessage = async () =>
      ({
        id: {
          id: "3EB0123456789",
          toString: () => "true_recipient@lid_3EB0123456789",
        },
      }) as unknown as Message;
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "whatsapp-web-adapter-"),
    );
    tempDirs.push(directory);
    const audioPath = path.join(directory, "message.ogg");
    await fs.writeFile(audioPath, "audio");
    const adapter = new WhatsAppWebAdapter({
      dataPath: directory,
      maxMediaBytes: 10_000,
      isAllowedChat: () => true,
      normalizeAudio: async (audio, mime) => ({ audio, mime }),
      prepareOutboundAudio: async () => ({
        data: Buffer.from("OggS opus-audio"),
        mime: "audio/ogg; codecs=opus",
        filename: "family-message-box-message.ogg",
      }),
      createClient: () => client,
      createMedia: () => ({ fixture: true }) as unknown as MessageContent,
    });
    await adapter.start();
    client.emit("ready");

    await expect(
      adapter.sendVoiceMessage({
        messageId: "modern-provider-id",
        chatId: "+447700900123",
        audioPath,
        idempotencyKey: "send:modern-provider-id",
      }),
    ).resolves.toMatchObject({
      adapterMessageId: "true_recipient@lid_3EB0123456789",
    });
  });

  it("does not create duplicate voice-note placeholders when a send fails", async () => {
    const client = new FakeClient();
    let attempts = 0;
    client.sendMessage = async () => {
      attempts++;
      throw new Error("voice-note upload failed");
    };
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), "whatsapp-web-adapter-"),
    );
    tempDirs.push(directory);
    const audioPath = path.join(directory, "message.ogg");
    await fs.writeFile(audioPath, "audio");
    const adapter = new WhatsAppWebAdapter({
      dataPath: directory,
      maxMediaBytes: 10_000,
      isAllowedChat: () => true,
      normalizeAudio: async (audio, mime) => ({ audio, mime }),
      prepareOutboundAudio: async () => ({
        data: Buffer.from("OggS opus-audio"),
        mime: "audio/ogg; codecs=opus",
        filename: "family-message-box-message.ogg",
      }),
      createClient: () => client,
      createMedia: () => ({ fixture: true }) as unknown as MessageContent,
    });
    await adapter.start();
    client.emit("ready");

    await expect(
      adapter.sendVoiceMessage({
        messageId: "failed-upload",
        chatId: "+447700900123",
        audioPath,
        idempotencyKey: "send:failed-upload",
      }),
    ).rejects.toThrow("voice-note upload failed");
    expect(attempts).toBe(1);
  });

  it("resolves modern LID senders before accepting voice notes from assigned direct contacts", async () => {
    const client = new FakeClient();
    client.lidMappings.set("12345678901234@lid", "447700900123@c.us");
    let received: { chatId: string; audio: Buffer; mime: string } | undefined;
    let resolveReceived: (() => void) | undefined;
    const receivedPromise = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });
    const adapter = new WhatsAppWebAdapter({
      dataPath: "/tmp/test-session",
      maxMediaBytes: 10_000,
      isAllowedChat: (chatId) => chatId === "447700900123@c.us",
      normalizeAudio: async (audio) => ({
        audio: Buffer.concat([audio, Buffer.from("-opus")]),
        mime: "audio/ogg",
      }),
      prepareOutboundAudio: async () => ({
        data: Buffer.from("OggS opus-audio"),
        mime: "audio/ogg; codecs=opus",
        filename: "family-message-box-message.ogg",
      }),
      createClient: () => client,
    });
    adapter.onIncoming(async (message) => {
      received = message;
      resolveReceived?.();
    });
    await adapter.start();
    client.emit("message", {
      fromMe: false,
      hasMedia: true,
      from: "12345678901234@lid",
      id: { _serialized: "false_12345678901234@lid_incoming-1" },
      getContact: async () => ({
        id: { _serialized: "12345678901234@lid" },
        number: "12345678901234",
        isGroup: false,
      }),
      downloadMedia: async () => ({
        mimetype: "audio/ogg",
        data: Buffer.from("voice").toString("base64"),
      }),
    } as unknown as Message);
    await receivedPromise;

    expect(received).toMatchObject({
      chatId: "447700900123@c.us",
      mime: "audio/ogg",
    });
    expect(received?.audio.toString()).toBe("voice-opus");
  });

  it("does not mistake an unresolved LID for a phone-number chat", async () => {
    const client = new FakeClient();
    let received = false;
    const adapter = new WhatsAppWebAdapter({
      dataPath: "/tmp/test-session",
      maxMediaBytes: 10_000,
      isAllowedChat: () => true,
      normalizeAudio: async (audio, mime) => ({ audio, mime }),
      prepareOutboundAudio: async () => ({
        data: Buffer.from("OggS opus-audio"),
        mime: "audio/ogg; codecs=opus",
        filename: "family-message-box-message.ogg",
      }),
      createClient: () => client,
    });
    adapter.onIncoming(async () => {
      received = true;
    });
    await adapter.start();
    client.emit("message", {
      fromMe: false,
      hasMedia: true,
      from: "12345678901234@lid",
      id: { _serialized: "unresolved-incoming" },
      getContact: async () => ({
        id: { _serialized: "12345678901234@lid" },
        number: "12345678901234",
        isGroup: false,
      }),
      downloadMedia: async () => ({
        mimetype: "audio/ogg",
        data: Buffer.from("voice").toString("base64"),
      }),
    } as unknown as Message);
    await new Promise((resolve) => setImmediate(resolve));

    expect(received).toBe(false);
  });

  it("uses WhatsApp's direct downloader when the public media method rejects", async () => {
    const client = new FakeClient();
    client.lidMappings.set("12345678901234@lid", "447700900123@c.us");
    let receivedAudio = "";
    let receivedDurationMs: number | undefined;
    let resolveReceived: (() => void) | undefined;
    const receivedPromise = new Promise<void>((resolve) => {
      resolveReceived = resolve;
    });
    const adapter = new WhatsAppWebAdapter({
      dataPath: "/tmp/test-session",
      maxMediaBytes: 10_000,
      isAllowedChat: (chatId) => chatId === "447700900123@c.us",
      normalizeAudio: async (audio, mime) => ({
        audio,
        mime,
        durationMs: 2_820,
      }),
      prepareOutboundAudio: async () => ({
        data: Buffer.from("OggS opus-audio"),
        mime: "audio/ogg; codecs=opus",
        filename: "family-message-box-message.ogg",
      }),
      createClient: () => client,
    });
    adapter.onIncoming(async (message) => {
      receivedAudio = message.audio.toString();
      receivedDurationMs = message.durationMs;
      resolveReceived?.();
    });
    await adapter.start();
    client.emit("message", {
      fromMe: false,
      hasMedia: true,
      from: "12345678901234@lid",
      id: {
        fromMe: false,
        remote: "12345678901234@lid",
        id: "3AB598930D5196539323",
        $1: "false_12345678901234@lid_3AB598930D5196539323",
      },
      client: {
        pupPage: {
          evaluate: async () => ({
            mimetype: "audio/ogg; codecs=opus",
            data: Buffer.from("direct-voice").toString("base64"),
          }),
        },
      },
      getContact: async () => ({
        id: { _serialized: "12345678901234@lid" },
        number: "12345678901234",
        isGroup: false,
      }),
      downloadMedia: async () => {
        throw new Error("r");
      },
    } as unknown as Message);
    await receivedPromise;

    expect(receivedAudio).toBe("direct-voice");
    expect(receivedDurationMs).toBe(2_820);
  });
});
