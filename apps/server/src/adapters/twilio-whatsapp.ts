import { createHmac, timingSafeEqual } from "node:crypto";
import twilio from "twilio";
import type { IncomingMessage, MessagingAdapter, SendMessageInput } from "./types.js";

interface TwilioMessageClient {
  messages: {
    create(input: {
      from: string;
      to: string;
      mediaUrl?: string[];
      contentSid?: string;
    }): Promise<{ sid: string }>;
  };
}

export interface TwilioWebhookPayload {
  MessageSid?: string;
  From?: string;
  NumMedia?: string;
  [key: `MediaUrl${number}`]: string | undefined;
  [key: `MediaContentType${number}`]: string | undefined;
}

interface TwilioWhatsAppOptions {
  accountSid: string;
  authToken: string;
  from: string;
  contentSid?: string;
  isConversationOpen?: (chatId: string) => boolean;
  onInboundActivity?: (chatId: string) => void;
  mediaUrlFor: (messageId: string) => string;
  normalizeAudio: (
    audio: Buffer,
    mime: string
  ) => Promise<{ audio: Buffer; mime: string; durationMs?: number }>;
  maxMediaBytes: number;
  client?: TwilioMessageClient;
  fetchImpl?: typeof fetch;
}

function whatsappAddress(value: string): string {
  const normalized = value.trim();
  if (/^whatsapp:\+[1-9]\d{6,14}$/.test(normalized)) return normalized;
  if (/^\+[1-9]\d{6,14}$/.test(normalized)) return `whatsapp:${normalized}`;
  throw new Error("Twilio WhatsApp recipients must use an E.164 number such as whatsapp:+34600000000.");
}

async function boundedDownload(
  url: string,
  accountSid: string,
  authToken: string,
  maxBytes: number,
  fetchImpl: typeof fetch
): Promise<Buffer> {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Twilio media URLs must use HTTPS.");
  const response = await fetchImpl(parsed, {
    headers: {
      authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`
    },
    redirect: "follow"
  });
  if (response.url && new URL(response.url).protocol !== "https:") {
    throw new Error("Twilio media redirects must remain on HTTPS.");
  }
  if (!response.ok || !response.body) {
    throw new Error(`Twilio media download failed (${response.status}).`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > maxBytes) throw new Error("Twilio media exceeds the configured upload limit.");

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("Twilio media exceeds the configured upload limit.");
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)), total);
}

export function createTwilioMediaToken(authToken: string, messageId: string): string {
  return createHmac("sha256", authToken).update(`outbound-media:${messageId}`).digest("hex");
}

export function verifyTwilioMediaToken(authToken: string, messageId: string, supplied: string): boolean {
  const expected = Buffer.from(createTwilioMediaToken(authToken, messageId), "hex");
  let actual: Buffer;
  try {
    actual = Buffer.from(supplied, "hex");
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class TwilioWhatsAppAdapter implements MessagingAdapter {
  readonly name = "twilio-whatsapp";
  private readonly client: TwilioMessageClient;
  private readonly fetchImpl: typeof fetch;
  private handler: ((message: IncomingMessage) => Promise<void>) | null = null;

  constructor(private readonly options: TwilioWhatsAppOptions) {
    this.client = options.client ?? twilio(options.accountSid, options.authToken);
    this.fetchImpl = options.fetchImpl ?? fetch;
    whatsappAddress(options.from);
  }

  onIncoming(handler: (message: IncomingMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async sendVoiceMessage(input: SendMessageInput): Promise<{
    adapterMessageId: string;
    transportMode: "template" | "voice-media";
  }> {
    const chatId = whatsappAddress(input.chatId);
    const useTemplate = Boolean(this.options.contentSid) && !this.options.isConversationOpen?.(chatId);
    const content = useTemplate
      ? { contentSid: this.options.contentSid! }
      : { mediaUrl: [this.options.mediaUrlFor(input.messageId)] };
    const sent = await this.client.messages.create({
      from: whatsappAddress(this.options.from),
      to: chatId,
      ...content
    });
    return {
      adapterMessageId: sent.sid,
      transportMode: useTemplate ? "template" : "voice-media"
    };
  }

  async receiveWebhook(payload: TwilioWebhookPayload): Promise<"ignored" | "received"> {
    if (!this.handler) throw new Error("The Twilio adapter is not started.");
    if (!payload.MessageSid || !payload.From) throw new Error("Twilio webhook is missing its message identity.");
    const chatId = whatsappAddress(payload.From);
    this.options.onInboundActivity?.(chatId);
    const mediaCount = Math.max(0, Number(payload.NumMedia ?? 0));
    let mediaUrl: string | undefined;
    let mime: string | undefined;
    for (let index = 0; index < mediaCount; index++) {
      const candidateMime = payload[`MediaContentType${index}`];
      if (candidateMime?.toLowerCase().startsWith("audio/")) {
        mediaUrl = payload[`MediaUrl${index}`];
        mime = candidateMime;
        break;
      }
    }
    if (!mediaUrl || !mime) return "ignored";

    const downloaded = await boundedDownload(
      mediaUrl,
      this.options.accountSid,
      this.options.authToken,
      this.options.maxMediaBytes,
      this.fetchImpl
    );
    const normalized = await this.options.normalizeAudio(downloaded, mime);
    await this.handler({
      adapterMessageId: payload.MessageSid,
      chatId,
      audio: normalized.audio,
      mime: normalized.mime,
      ...(normalized.durationMs === undefined ? {} : { durationMs: normalized.durationMs })
    });
    return "received";
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {
    this.handler = null;
  }
}
