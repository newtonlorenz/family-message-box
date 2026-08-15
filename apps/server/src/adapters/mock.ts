import type { IncomingMessage, MessagingAdapter, SendMessageInput } from "./types.js";

export class MockMessagingAdapter implements MessagingAdapter {
  readonly name = "mock";
  readonly sent = new Map<string, SendMessageInput & { adapterMessageId: string }>();
  private handler: ((message: IncomingMessage) => Promise<void>) | null = null;

  async sendVoiceMessage(input: SendMessageInput): Promise<{ adapterMessageId: string }> {
    const existing = this.sent.get(input.idempotencyKey);
    if (existing) return { adapterMessageId: existing.adapterMessageId };
    if (input.chatId.startsWith("fail:")) throw new Error("Mock delivery failure requested by chat ID.");
    const adapterMessageId = `mock-out-${this.sent.size + 1}`;
    this.sent.set(input.idempotencyKey, { ...input, adapterMessageId });
    return { adapterMessageId };
  }

  onIncoming(handler: (message: IncomingMessage) => Promise<void>): void {
    this.handler = handler;
  }

  async injectIncoming(message: IncomingMessage): Promise<void> {
    if (!this.handler) throw new Error("Mock adapter is not started.");
    await this.handler(message);
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
}
