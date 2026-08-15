export interface SendMessageInput {
  messageId: string;
  chatId: string;
  audioPath: string;
  idempotencyKey: string;
}

export type MessageTransportMode =
  | "template"
  | "voice-media"
  | "audio-attachment";

export class UnknownDeliveryConfirmationError extends Error {
  readonly transportMode: MessageTransportMode;

  constructor(message: string, transportMode: MessageTransportMode) {
    super(message);
    this.name = "UnknownDeliveryConfirmationError";
    this.transportMode = transportMode;
  }
}

export interface IncomingMessage {
  adapterMessageId: string;
  chatId: string;
  audio: Buffer;
  mime: string;
  durationMs?: number;
}

export interface MessagingAdapter {
  readonly name: string;
  sendVoiceMessage(input: SendMessageInput): Promise<{
    adapterMessageId: string;
    transportMode?: MessageTransportMode;
  }>;
  onIncoming(handler: (message: IncomingMessage) => Promise<void>): void;
  start(): Promise<void>;
  stop(): Promise<void>;
}
