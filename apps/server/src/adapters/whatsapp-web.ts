import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  UnknownDeliveryConfirmationError,
  type IncomingMessage,
  type MessagingAdapter,
  type SendMessageInput,
} from "./types.js";

const WHATSAPP_CLIENT_ID = "family-message-box";
const CHROMIUM_SINGLETON_FILES = [
  "SingletonLock",
  "SingletonSocket",
  "SingletonCookie",
] as const;

export type MessageContent = unknown;

export interface MessageSendOptions {
  sendAudioAsVoice?: boolean;
  waitUntilMsgSent?: boolean;
}

interface MessageId {
  _serialized?: string;
  $1?: string;
  fromMe?: boolean;
  remote?: string | { _serialized?: string };
  id?: string;
}

export interface Contact {
  id?: { _serialized?: string };
  number?: string;
  isGroup: boolean;
}

interface IncomingMediaPayload {
  mimetype: string;
  data: string;
}

export interface Message {
  id: MessageId;
  fromMe?: boolean;
  hasMedia?: boolean;
  from?: string;
  author?: string;
  getContact(): Promise<Contact>;
  downloadMedia(): Promise<IncomingMediaPayload | null | undefined>;
}

export type WhatsAppWebConnectionState =
  | "starting"
  | "qr"
  | "authenticated"
  | "ready"
  | "disconnected"
  | "auth_failure"
  | "stopped";

export interface WhatsAppWebStatus {
  state: WhatsAppWebConnectionState;
  qr: string | null;
  lastError: string | null;
  account: string | null;
}

interface WhatsAppWebClient {
  info?: { wid: { _serialized: string } };
  on(event: string, listener: (...args: any[]) => void): this;
  initialize(): Promise<void>;
  destroy(): Promise<void>;
  getContactLidAndPhone(
    userIds: string[],
  ): Promise<Array<{ lid?: string; pn?: string }>>;
  sendMessage(
    chatId: string,
    content: MessageContent,
    options?: MessageSendOptions,
  ): Promise<Message | undefined>;
}

interface WhatsAppWebLibrary {
  Client: new (options: Record<string, unknown>) => WhatsAppWebClient;
  LocalAuth: new (options: { clientId: string; dataPath: string }) => unknown;
  MessageMedia: new (
    mime: string,
    data: string,
    filename: string,
  ) => MessageContent;
}

interface WhatsAppWebAdapterOptions {
  dataPath: string;
  chromePath?: string;
  maxMediaBytes: number;
  isAllowedChat: (chatId: string) => boolean;
  normalizeAudio: (
    audio: Buffer,
    mime: string,
  ) => Promise<{ audio: Buffer; mime: string; durationMs?: number }>;
  prepareOutboundAudio: (
    audioPath: string,
    messageId: string,
  ) => Promise<{ data: Buffer; mime: string; filename: string }>;
  createClient?: () => WhatsAppWebClient;
  createMedia?: (
    mime: string,
    data: string,
    filename: string,
  ) => MessageContent;
  loadLibrary?: () => Promise<WhatsAppWebLibrary>;
}

interface WhatsAppPage {
  evaluate<T>(
    pageFunction: (messageId: string) => Promise<T>,
    messageId: string,
  ): Promise<T>;
}

function phoneDigits(value: string): string {
  return value.replace(/^whatsapp:/i, "").replace(/[^\d]/g, "");
}

function incomingError(stage: string, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(
    `Incoming WhatsApp ${stage} failed: ${detail || "unknown error"}`,
  );
}

function serializeWhatsAppMessageId(id: Message["id"]): string | null {
  const modernId = id;
  const direct = modernId._serialized || modernId.$1;
  if (direct) return direct;
  const remote =
    typeof modernId.remote === "string"
      ? modernId.remote
      : modernId.remote?._serialized;
  if (remote && modernId.id && typeof modernId.fromMe === "boolean") {
    return `${modernId.fromMe}_${remote}_${modernId.id}`;
  }
  const fallback = String(id);
  return fallback && fallback !== "[object Object]" ? fallback : null;
}

async function loadOptionalWhatsAppWebLibrary(): Promise<WhatsAppWebLibrary> {
  const moduleName = "whatsapp-web.js";
  const loaded = (await import(moduleName)) as {
    default?: WhatsAppWebLibrary;
  } & Partial<WhatsAppWebLibrary>;
  const library = loaded.default ?? loaded;
  if (!library.Client || !library.LocalAuth || !library.MessageMedia) {
    throw new Error(
      "the installed module does not expose the expected client API",
    );
  }
  return library as WhatsAppWebLibrary;
}

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

export async function clearStaleChromiumProfileLocks(
  dataPath: string,
  currentHostname = os.hostname(),
  isProcessRunning: (pid: number) => boolean = processExists,
): Promise<boolean> {
  const sessionPath = path.join(dataPath, `session-${WHATSAPP_CLIENT_ID}`);
  const lockPath = path.join(sessionPath, "SingletonLock");
  let owner: string;
  try {
    owner = await fs.readlink(lockPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }

  const separator = owner.lastIndexOf("-");
  const ownerHostname = separator > 0 ? owner.slice(0, separator) : "";
  const ownerPid = Number(owner.slice(separator + 1));
  if (!ownerHostname || !Number.isSafeInteger(ownerPid) || ownerPid <= 0)
    return false;
  if (ownerHostname === currentHostname && isProcessRunning(ownerPid))
    return false;

  await Promise.all(
    CHROMIUM_SINGLETON_FILES.map((name) =>
      fs.rm(path.join(sessionPath, name), { force: true }),
    ),
  );
  return true;
}

export function normalizeWhatsAppChatId(value: string): string {
  if (value.endsWith("@c.us")) return value;
  const digits = phoneDigits(value);
  if (!digits)
    throw new Error("The recipient must be a WhatsApp phone number.");
  return `${digits}@c.us`;
}

export class WhatsAppWebAdapter implements MessagingAdapter {
  readonly name = "whatsapp-web";
  private incomingHandler:
    ((message: IncomingMessage) => Promise<void>) | null = null;
  private client: WhatsAppWebClient | null = null;
  private libraryMediaFactory:
    ((mime: string, data: string, filename: string) => MessageContent) | null =
    null;
  private status: WhatsAppWebStatus = {
    state: "stopped",
    qr: null,
    lastError: null,
    account: null,
  };

  constructor(private readonly options: WhatsAppWebAdapterOptions) {}

  getStatus(): WhatsAppWebStatus {
    return { ...this.status };
  }

  onIncoming(handler: (message: IncomingMessage) => Promise<void>): void {
    this.incomingHandler = handler;
  }

  async start(): Promise<void> {
    if (this.client) return;
    this.setStatus("starting");
    if (!this.options.createClient) {
      await clearStaleChromiumProfileLocks(this.options.dataPath);
    }
    let client = this.options.createClient?.();
    if (!client) {
      let library: WhatsAppWebLibrary;
      try {
        library = await (
          this.options.loadLibrary ?? loadOptionalWhatsAppWebLibrary
        )();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const message = `WhatsApp Web is an optional prototype and is not bundled in the public build: ${detail}`;
        this.status = {
          state: "auth_failure",
          qr: null,
          lastError: message,
          account: null,
        };
        throw new Error(message, { cause: error });
      }
      const { Client, LocalAuth, MessageMedia } = library;
      this.libraryMediaFactory = (mime, data, filename) =>
        new MessageMedia(mime, data, filename);
      client = new Client({
        authStrategy: new LocalAuth({
          clientId: WHATSAPP_CLIENT_ID,
          dataPath: this.options.dataPath,
        }),
        puppeteer: {
          headless: true,
          ...(this.options.chromePath
            ? { executablePath: this.options.chromePath }
            : {}),
          args: ["--no-sandbox", "--disable-setuid-sandbox"],
        },
        deviceName: "Family Message Box",
        browserName: "Chrome",
      });
    }
    this.client = client;
    client.on("qr", (qr: string) => {
      this.status = { ...this.status, state: "qr", qr, lastError: null };
    });
    client.on("authenticated", () => this.setStatus("authenticated"));
    client.on("ready", () => {
      this.status = {
        state: "ready",
        qr: null,
        lastError: null,
        account: client.info?.wid._serialized ?? null,
      };
    });
    client.on("auth_failure", (message: string) => {
      this.status = {
        ...this.status,
        state: "auth_failure",
        qr: null,
        lastError: message,
      };
    });
    client.on("disconnected", (reason: unknown) => {
      this.status = {
        ...this.status,
        state: "disconnected",
        qr: null,
        lastError: `WhatsApp disconnected: ${String(reason)}`,
      };
    });
    client.on("message", (message: Message) => {
      void this.receive(message).catch((error) => {
        this.status = {
          ...this.status,
          lastError:
            error instanceof Error
              ? error.message
              : "An incoming voice note could not be processed.",
        };
      });
    });
    try {
      await client.initialize();
    } catch (error) {
      this.status = {
        ...this.status,
        state: "auth_failure",
        qr: null,
        lastError:
          error instanceof Error
            ? error.message
            : "WhatsApp Web could not start.",
      };
      throw error;
    }
  }

  async stop(): Promise<void> {
    const client = this.client;
    this.client = null;
    this.status = {
      state: "stopped",
      qr: null,
      lastError: null,
      account: null,
    };
    if (client) await client.destroy();
  }

  async sendVoiceMessage(input: SendMessageInput): Promise<{
    adapterMessageId: string;
    transportMode: "voice-media";
  }> {
    if (!this.client || this.status.state !== "ready") {
      throw new Error(
        "WhatsApp is not connected. Scan the pairing code before sending.",
      );
    }
    const chatId = normalizeWhatsAppChatId(input.chatId);
    if (!this.options.isAllowedChat(chatId)) {
      throw new Error("This WhatsApp contact is not assigned to a button.");
    }
    await fs.access(input.audioPath);
    const audio = await this.options.prepareOutboundAudio(
      input.audioPath,
      input.messageId,
    );
    const createMedia = this.options.createMedia ?? this.libraryMediaFactory;
    if (!createMedia) throw new Error("WhatsApp media support is unavailable.");
    const media = createMedia(
      audio.mime,
      audio.data.toString("base64"),
      audio.filename,
    );
    const sent = await this.client.sendMessage(chatId, media, {
      sendAudioAsVoice: true,
      waitUntilMsgSent: true,
    });
    if (!sent?.id) {
      throw new UnknownDeliveryConfirmationError(
        "WhatsApp did not return a sent-message confirmation.",
        "voice-media",
      );
    }
    const serializedId = serializeWhatsAppMessageId(sent.id);
    if (!serializedId) {
      throw new UnknownDeliveryConfirmationError(
        "WhatsApp returned an invalid sent-message confirmation.",
        "voice-media",
      );
    }
    return {
      adapterMessageId: serializedId,
      transportMode: "voice-media",
    };
  }

  private setStatus(state: WhatsAppWebConnectionState): void {
    this.status = { ...this.status, state, qr: null, lastError: null };
  }

  private async receive(message: Message): Promise<void> {
    if (message.fromMe || !message.hasMedia || !this.incomingHandler) return;
    let contact: Contact;
    try {
      contact = await message.getContact();
    } catch (error) {
      throw incomingError("contact lookup", error);
    }
    if (contact.isGroup) return;
    let chatId: string | null;
    try {
      chatId = await this.resolveIncomingChatId(message, contact);
    } catch (error) {
      throw incomingError("identity resolution", error);
    }
    if (!chatId) return;
    if (!this.options.isAllowedChat(chatId)) return;
    const adapterMessageId = serializeWhatsAppMessageId(message.id);
    if (!adapterMessageId) {
      throw new Error("WhatsApp returned an invalid incoming-message ID.");
    }
    let media: IncomingMediaPayload | undefined;
    try {
      media = await this.downloadIncomingMedia(message, adapterMessageId);
    } catch (error) {
      throw incomingError("media download", error);
    }
    if (!media)
      throw new Error(
        "Incoming WhatsApp media download failed: voice note is unavailable.",
      );
    if (!media.mimetype.toLowerCase().startsWith("audio/")) return;
    const audio = Buffer.from(media.data, "base64");
    if (audio.length > this.options.maxMediaBytes) {
      throw new Error("The incoming WhatsApp voice note is too large.");
    }
    let normalized: { audio: Buffer; mime: string; durationMs?: number };
    try {
      normalized = await this.options.normalizeAudio(audio, media.mimetype);
    } catch (error) {
      throw incomingError("audio conversion", error);
    }
    try {
      await this.incomingHandler({
        adapterMessageId,
        chatId,
        audio: normalized.audio,
        mime: normalized.mime,
        ...(normalized.durationMs === undefined
          ? {}
          : { durationMs: normalized.durationMs }),
      });
    } catch (error) {
      throw incomingError("queue storage", error);
    }
  }

  private async downloadIncomingMedia(
    message: Message,
    messageId: string,
  ): Promise<IncomingMediaPayload | undefined> {
    // whatsapp-web.js currently asks the message model to change media stages
    // before decrypting. Recent WhatsApp Web builds can reject that stage change
    // with a minified `r` error, while the underlying downloader still works.
    const page = (
      message as Message & {
        client?: { pupPage?: WhatsAppPage };
      }
    ).client?.pupPage;
    let directDownloadError: unknown;
    if (page) {
      try {
        const direct = await page.evaluate(async (targetId) => {
          const wa = globalThis as typeof globalThis & {
            require(moduleName: string): any;
            WWebJS: {
              arrayBufferToBase64Async(input: ArrayBuffer): Promise<string>;
            };
          };
          const msg =
            wa.require("WAWebCollections").Msg.get(targetId) ??
            (
              await wa
                .require("WAWebCollections")
                .Msg.getMessagesById([targetId])
            )?.messages?.[0];
          if (!msg?.directPath || !msg.mediaKey) return undefined;
          const mockQpl = {
            addAnnotations() {
              return this;
            },
            addPoint() {
              return this;
            },
          };
          try {
            const decrypted = await wa
              .require("WAWebDownloadManager")
              .downloadManager.downloadAndMaybeDecrypt({
                directPath: msg.directPath,
                encFilehash: msg.encFilehash,
                filehash: msg.filehash,
                mediaKey: msg.mediaKey,
                mediaKeyTimestamp: msg.mediaKeyTimestamp,
                type: msg.type,
                signal: new AbortController().signal,
                downloadQpl: mockQpl,
              });
            return {
              mimetype: msg.mimetype,
              data: await wa.WWebJS.arrayBufferToBase64Async(decrypted),
            };
          } catch (error) {
            if ((error as { status?: number })?.status === 404)
              return undefined;
            throw error;
          }
        }, messageId);
        if (direct) return direct;
      } catch (error) {
        directDownloadError = error;
      }
    }

    try {
      return (await message.downloadMedia()) ?? undefined;
    } catch (error) {
      if (directDownloadError) {
        const directDetail =
          directDownloadError instanceof Error
            ? directDownloadError.message
            : String(directDownloadError);
        const publicDetail =
          error instanceof Error ? error.message : String(error);
        throw new Error(
          `direct download: ${directDetail}; public download: ${publicDetail}`,
        );
      }
      throw error;
    }
  }

  private async resolveIncomingChatId(
    message: Message,
    contact: Contact,
  ): Promise<string | null> {
    const contactId = contact.id?._serialized;
    const senderId = message.author || message.from || contactId;
    const lid = [senderId, contactId].find((candidate) =>
      candidate?.endsWith("@lid"),
    );
    if (lid) {
      const [resolved] = await this.client!.getContactLidAndPhone([lid]);
      return resolved?.pn ? normalizeWhatsAppChatId(resolved.pn) : null;
    }
    const phoneId = [contactId, message.from].find((candidate) =>
      candidate?.endsWith("@c.us"),
    );
    if (phoneId) return normalizeWhatsAppChatId(phoneId);
    return contact.number ? normalizeWhatsAppChatId(contact.number) : null;
  }
}
