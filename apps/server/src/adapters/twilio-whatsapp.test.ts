import { describe, expect, it, vi } from "vitest";
import {
  createTwilioMediaToken,
  TwilioWhatsAppAdapter,
  verifyTwilioMediaToken
} from "./twilio-whatsapp.js";

const options = (overrides: Record<string, unknown> = {}) => ({
  accountSid: "AC00000000000000000000000000000000",
  authToken: "test-auth-token",
  from: "whatsapp:+14155238886",
  mediaUrlFor: (messageId: string) => `https://box.example/api/twilio/media/${messageId}?token=signed`,
  normalizeAudio: async (audio: Buffer) => ({ audio, mime: "audio/ogg" }),
  maxMediaBytes: 1_024,
  ...overrides
});

describe("Twilio WhatsApp adapter", () => {
  it("sends an outbound WhatsApp media message through the official client", async () => {
    const create = vi.fn(async () => ({ sid: "SM00000000000000000000000000000000" }));
    const adapter = new TwilioWhatsAppAdapter(options({ client: { messages: { create } } }));

    await expect(adapter.sendVoiceMessage({
      messageId: "message-1",
      chatId: "+34600000000",
      audioPath: "/tmp/message.ogg",
      idempotencyKey: "send:message-1"
    })).resolves.toEqual({
      adapterMessageId: "SM00000000000000000000000000000000",
      transportMode: "voice-media"
    });

    expect(create).toHaveBeenCalledWith({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+34600000000",
      mediaUrl: ["https://box.example/api/twilio/media/message-1?token=signed"]
    });
  });

  it("uses an approved content template in Sandbox template-test mode", async () => {
    const create = vi.fn(async () => ({ sid: "MM00000000000000000000000000000000" }));
    const adapter = new TwilioWhatsAppAdapter(options({
      contentSid: "HX00000000000000000000000000000000",
      client: { messages: { create } }
    }));

    await adapter.sendVoiceMessage({
      messageId: "message-1",
      chatId: "+34600000000",
      audioPath: "/tmp/message.ogg",
      idempotencyKey: "send:message-1"
    });

    expect(create).toHaveBeenCalledWith({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+34600000000",
      contentSid: "HX00000000000000000000000000000000"
    });
  });

  it("sends the recorded audio after an inbound message opens the conversation", async () => {
    const create = vi.fn(async () => ({ sid: "SM00000000000000000000000000000000" }));
    const adapter = new TwilioWhatsAppAdapter(options({
      contentSid: "HX00000000000000000000000000000000",
      isConversationOpen: () => true,
      client: { messages: { create } }
    }));

    await expect(adapter.sendVoiceMessage({
      messageId: "message-1",
      chatId: "+34600000000",
      audioPath: "/tmp/message.ogg",
      idempotencyKey: "send:message-1"
    })).resolves.toEqual({
      adapterMessageId: "SM00000000000000000000000000000000",
      transportMode: "voice-media"
    });

    expect(create).toHaveBeenCalledWith({
      from: "whatsapp:+14155238886",
      to: "whatsapp:+34600000000",
      mediaUrl: ["https://box.example/api/twilio/media/message-1?token=signed"]
    });
  });

  it("records inbound text activity even when there is no audio attachment", async () => {
    const onInboundActivity = vi.fn();
    const adapter = new TwilioWhatsAppAdapter(options({
      onInboundActivity,
      client: { messages: { create: vi.fn() } }
    }));
    adapter.onIncoming(vi.fn());

    await expect(adapter.receiveWebhook({
      MessageSid: "SM11111111111111111111111111111111",
      From: "whatsapp:+34600000000",
      NumMedia: "0"
    })).resolves.toBe("ignored");

    expect(onInboundActivity).toHaveBeenCalledWith("whatsapp:+34600000000");
  });

  it("downloads and dispatches signed webhook audio", async () => {
    const received: Array<{ id: string; chatId: string; audio: string; mime: string }> = [];
    const fetchImpl = vi.fn(async () => new Response(Buffer.from("voice-note"), {
      status: 200,
      headers: { "content-length": "10", "content-type": "audio/ogg" }
    }));
    const adapter = new TwilioWhatsAppAdapter(options({
      client: { messages: { create: vi.fn() } },
      fetchImpl
    }));
    adapter.onIncoming(async (message) => {
      received.push({
        id: message.adapterMessageId,
        chatId: message.chatId,
        audio: message.audio.toString(),
        mime: message.mime
      });
    });
    await adapter.start();

    await expect(adapter.receiveWebhook({
      MessageSid: "SM11111111111111111111111111111111",
      From: "whatsapp:+34600000000",
      NumMedia: "1",
      MediaUrl0: "https://api.twilio.com/media/ME1",
      MediaContentType0: "audio/ogg"
    })).resolves.toBe("received");

    expect(received).toEqual([{
      id: "SM11111111111111111111111111111111",
      chatId: "whatsapp:+34600000000",
      audio: "voice-note",
      mime: "audio/ogg"
    }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("signs outbound media URLs without exposing the auth token", () => {
    const token = createTwilioMediaToken("secret-token", "message-1");
    expect(token).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyTwilioMediaToken("secret-token", "message-1", token)).toBe(true);
    expect(verifyTwilioMediaToken("secret-token", "message-2", token)).toBe(false);
  });
});
