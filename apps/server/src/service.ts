import fs from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import type {
  ButtonSlot,
  DeviceConfig,
  MessageSummary,
} from "@family-box/contracts";
import type { Db } from "./db.js";
import { audit } from "./db.js";
import {
  UnknownDeliveryConfirmationError,
  type MessagingAdapter,
  type IncomingMessage,
} from "./adapters/types.js";
import { isQuietHours } from "./quiet-hours.js";
import { RequestError } from "./errors.js";

export class MessageService {
  private processingQueue = false;
  private readonly activeDeliveries = new Map<string, Promise<void>>();

  constructor(
    private readonly db: Db,
    private readonly adapter: MessagingAdapter,
    private readonly audioDir: string,
    private readonly notify: (
      deviceId: string,
      event: unknown,
    ) => void = () => {},
    private readonly clock: () => Date = () => new Date(),
  ) {
    adapter.onIncoming(async (message) => {
      await this.receiveIncoming(message);
    });
  }

  private timestamp(): string {
    return this.clock().toISOString();
  }

  getConfig(deviceId: string): DeviceConfig {
    const settings = this.db
      .prepare("SELECT * FROM settings WHERE device_id=?")
      .get(deviceId) as any;
    if (!settings) throw new Error("Device not found.");
    const buttons = this.db
      .prepare(
        `
      SELECT bs.slot, r.recipient_key, r.display_name, cm.chat_id,
        COUNT(CASE WHEN m.direction='incoming' AND m.playback_state='waiting' THEN 1 END) waiting_count,
        (
          SELECT pending.id FROM messages pending
          WHERE pending.device_id=bs.device_id AND pending.recipient_id=r.id
            AND pending.direction='incoming' AND pending.playback_state='waiting'
          ORDER BY pending.rowid ASC LIMIT 1
        ) next_message_id
      FROM button_slots bs
      LEFT JOIN recipients r ON r.id=bs.recipient_id
      LEFT JOIN chat_mappings cm ON cm.recipient_id=r.id AND cm.adapter=?
      LEFT JOIN messages m ON m.device_id=bs.device_id AND m.recipient_id=r.id
      WHERE bs.device_id=? GROUP BY bs.slot ORDER BY bs.slot
    `,
      )
      .all(this.adapter.name, deviceId) as any[];
    return {
      deviceId,
      buttons: buttons.map((row) => ({
        slot: row.slot as ButtonSlot,
        recipientKey: row.recipient_key ?? null,
        recipientName: row.display_name ?? null,
        chatId: row.chat_id ?? null,
        status:
          row.recipient_key && row.chat_id
            ? row.waiting_count
              ? "waiting"
              : "ready"
            : "unassigned",
        waitingCount: row.waiting_count,
        nextMessageId: row.next_message_id ?? null,
      })),
      settings: {
        volume: settings.volume,
        chimeVolume: settings.chime_volume,
        microphoneGainPercent: settings.microphone_gain_percent,
        microphoneNoiseGatePercent: settings.microphone_noise_gate_percent,
        minDurationSeconds: settings.min_duration_seconds,
        maxDurationSeconds: settings.max_duration_seconds,
        quietHoursStart: settings.quiet_hours_start,
        quietHoursEnd: settings.quiet_hours_end,
      },
    };
  }

  assignSlot(
    deviceId: string,
    slot: number,
    input: { recipientKey: string; displayName: string; chatId: string },
  ): DeviceConfig {
    if (!Number.isInteger(slot) || slot < 1 || slot > 8)
      throw new RequestError("Slot must be from 1 to 8.");
    if (!/^[a-z0-9][a-z0-9_-]{1,47}$/i.test(input.recipientKey)) {
      throw new RequestError(
        "Recipient key must be stable letters, numbers, dashes or underscores.",
      );
    }
    const timestamp = this.timestamp();
    this.db.transaction(() => {
      const recipient = this.db
        .prepare("SELECT id FROM recipients WHERE recipient_key=?")
        .get(input.recipientKey) as { id: string } | undefined;
      const recipientId = recipient?.id ?? nanoid();
      if (!recipient) {
        this.db
          .prepare(
            "INSERT INTO recipients(id,recipient_key,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
          )
          .run(
            recipientId,
            input.recipientKey,
            input.displayName,
            timestamp,
            timestamp,
          );
      } else {
        this.db
          .prepare(
            "UPDATE recipients SET display_name=?,updated_at=? WHERE id=?",
          )
          .run(input.displayName, timestamp, recipientId);
      }
      const otherSlot = this.db
        .prepare(
          `
        SELECT slot FROM button_slots
        WHERE device_id=? AND recipient_id=? AND slot<>?
      `,
        )
        .get(deviceId, recipientId, slot) as { slot: number } | undefined;
      if (otherSlot) {
        throw new RequestError(
          `This recipient is already assigned to button ${otherSlot.slot}.`,
          409,
        );
      }
      const otherRecipient = this.db
        .prepare(
          `
        SELECT recipient_id FROM chat_mappings
        WHERE adapter=? AND chat_id=? AND recipient_id<>?
      `,
        )
        .get(this.adapter.name, input.chatId, recipientId) as
        { recipient_id: string } | undefined;
      if (otherRecipient) {
        throw new RequestError(
          "This chat is already assigned to another recipient.",
          409,
        );
      }
      this.db
        .prepare(
          `
        INSERT INTO chat_mappings(id,recipient_id,adapter,chat_id,created_at,updated_at) VALUES (?,?,?,?,?,?)
        ON CONFLICT(recipient_id) DO UPDATE SET adapter=excluded.adapter,chat_id=excluded.chat_id,updated_at=excluded.updated_at
      `,
        )
        .run(
          nanoid(),
          recipientId,
          this.adapter.name,
          input.chatId,
          timestamp,
          timestamp,
        );
      this.db
        .prepare(
          "UPDATE button_slots SET recipient_id=?,label=? WHERE device_id=? AND slot=?",
        )
        .run(recipientId, input.displayName, deviceId, slot);
      audit(this.db, "button.assigned", "button_slot", String(slot), deviceId, {
        recipientKey: input.recipientKey,
      });
    })();
    const config = this.getConfig(deviceId);
    this.notify(deviceId, { type: "config.updated", config });
    return config;
  }

  updateSettings(
    deviceId: string,
    input: Partial<DeviceConfig["settings"]> & { timezone?: string },
  ): DeviceConfig {
    const current = this.db
      .prepare("SELECT * FROM settings WHERE device_id=?")
      .get(deviceId) as any;
    if (!current) throw new RequestError("Device not found.", 404);
    const volume = input.volume ?? current.volume;
    const chimeVolume = input.chimeVolume ?? current.chime_volume;
    const microphoneGain =
      input.microphoneGainPercent ?? current.microphone_gain_percent;
    const microphoneNoiseGate =
      input.microphoneNoiseGatePercent ?? current.microphone_noise_gate_percent;
    const minimum = input.minDurationSeconds ?? current.min_duration_seconds;
    const maximum = input.maxDurationSeconds ?? current.max_duration_seconds;
    if (
      volume < 0 ||
      volume > 100 ||
      chimeVolume < 0 ||
      chimeVolume > 100 ||
      microphoneGain < 25 ||
      microphoneGain > 400 ||
      microphoneNoiseGate < 0 ||
      microphoneNoiseGate > 20 ||
      minimum < 1 ||
      maximum > 120 ||
      minimum > maximum
    ) {
      throw new RequestError("Invalid settings.");
    }
    try {
      new Intl.DateTimeFormat("en-GB", {
        timeZone: input.timezone ?? current.timezone,
      }).format(this.clock());
    } catch {
      throw new RequestError("Timezone must be a valid IANA timezone.");
    }
    this.db
      .prepare(
        `
      UPDATE settings SET volume=?,chime_volume=?,microphone_gain_percent=?,microphone_noise_gate_percent=?,
      min_duration_seconds=?,max_duration_seconds=?,
      quiet_hours_start=?,quiet_hours_end=?,timezone=?,updated_at=? WHERE device_id=?
    `,
      )
      .run(
        volume,
        chimeVolume,
        microphoneGain,
        microphoneNoiseGate,
        minimum,
        maximum,
        input.quietHoursStart === undefined
          ? current.quiet_hours_start
          : input.quietHoursStart,
        input.quietHoursEnd === undefined
          ? current.quiet_hours_end
          : input.quietHoursEnd,
        input.timezone ?? current.timezone,
        this.timestamp(),
        deviceId,
      );
    audit(this.db, "settings.updated", "settings", deviceId, deviceId, input);
    const config = this.getConfig(deviceId);
    this.notify(deviceId, {
      type: "settings.updated",
      settings: config.settings,
    });
    return config;
  }

  createOutgoing(input: {
    messageId: string;
    deviceId: string;
    recipientKey: string;
    audioPath: string;
    originalMime: string;
    durationMs: number;
    idempotencyKey: string;
  }): { id: string; duplicate: boolean } {
    const duplicate = this.db
      .prepare(
        `
      SELECT m.id,r.recipient_key FROM messages m
      JOIN recipients r ON r.id=m.recipient_id
      WHERE m.device_id=? AND m.idempotency_key=?
    `,
      )
      .get(input.deviceId, input.idempotencyKey) as
      { id: string; recipient_key: string } | undefined;
    if (duplicate) {
      if (duplicate.recipient_key !== input.recipientKey) {
        throw new RequestError(
          "This idempotency key was already used for another recipient.",
          409,
        );
      }
      return { id: duplicate.id, duplicate: true };
    }
    const recipient = this.db
      .prepare(
        `
      SELECT r.id FROM recipients r JOIN button_slots bs ON bs.recipient_id=r.id
      WHERE bs.device_id=? AND r.recipient_key=? AND r.enabled=1
    `,
      )
      .get(input.deviceId, input.recipientKey) as { id: string } | undefined;
    if (!recipient)
      throw new RequestError("Recipient is not assigned to this device.", 409);
    const timestamp = this.timestamp();
    try {
      this.db
        .prepare(
          `
        INSERT INTO messages(id,device_id,recipient_id,direction,audio_path,original_mime,duration_ms,
        delivery_state,playback_state,available_after,idempotency_key,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
        )
        .run(
          input.messageId,
          input.deviceId,
          recipient.id,
          "outgoing",
          input.audioPath,
          input.originalMime,
          input.durationMs,
          "ready",
          "not_applicable",
          timestamp,
          input.idempotencyKey,
          timestamp,
          timestamp,
        );
    } catch (error) {
      const racedDuplicate = this.db
        .prepare(
          "SELECT id FROM messages WHERE device_id=? AND idempotency_key=?",
        )
        .get(input.deviceId, input.idempotencyKey) as
        { id: string } | undefined;
      if (racedDuplicate) return { id: racedDuplicate.id, duplicate: true };
      throw error;
    }
    audit(
      this.db,
      "message.uploaded",
      "message",
      input.messageId,
      input.deviceId,
      { recipientKey: input.recipientKey },
    );
    return { id: input.messageId, duplicate: false };
  }

  async deliver(messageId: string): Promise<void> {
    const active = this.activeDeliveries.get(messageId);
    if (active) return active;
    const delivery = this.deliverOnce(messageId);
    this.activeDeliveries.set(messageId, delivery);
    try {
      await delivery;
    } finally {
      this.activeDeliveries.delete(messageId);
    }
  }

  private async deliverOnce(messageId: string): Promise<void> {
    const row = this.db
      .prepare(
        `
      SELECT m.*, cm.chat_id, s.quiet_hours_start,s.quiet_hours_end,s.timezone
      FROM messages m JOIN chat_mappings cm ON cm.recipient_id=m.recipient_id AND cm.adapter=?
      JOIN settings s ON s.device_id=m.device_id WHERE m.id=?
    `,
      )
      .get(this.adapter.name, messageId) as any;
    if (!row)
      throw new RequestError(
        "This recipient is not configured for the active messaging connection.",
        409,
      );
    if (row.delivery_state === "sent") return;
    if (row.delivery_state === "confirmation_unknown") {
      throw new RequestError(
        "Delivery confirmation is unknown and cannot be retried safely.",
        409,
      );
    }
    if (row.delivery_state === "sending") {
      throw new RequestError(
        "Delivery is already in progress or its result is unknown and cannot be retried safely.",
        409,
      );
    }
    if (
      isQuietHours(
        this.clock(),
        row.quiet_hours_start,
        row.quiet_hours_end,
        row.timezone,
      )
    ) {
      this.db
        .prepare(
          "UPDATE messages SET delivery_state='queued',error=NULL,updated_at=? WHERE id=?",
        )
        .run(this.timestamp(), messageId);
      if (row.delivery_state !== "queued") {
        audit(
          this.db,
          "message.queued_quiet_hours",
          "message",
          messageId,
          row.device_id,
        );
      }
      return;
    }
    try {
      this.db
        .prepare(
          "UPDATE messages SET delivery_state='sending',attempts=attempts+1,error=NULL,updated_at=? WHERE id=?",
        )
        .run(this.timestamp(), messageId);
      audit(this.db, "message.sending", "message", messageId, row.device_id);
      const delivery = await this.adapter.sendVoiceMessage({
        messageId,
        chatId: row.chat_id,
        audioPath: row.audio_path,
        idempotencyKey: `send:${messageId}`,
      });
      this.db
        .prepare(
          `
        UPDATE messages SET delivery_state='sent',source_message_id=?,transport_mode=?,delivered_at=?,updated_at=? WHERE id=?
      `,
        )
        .run(
          delivery.adapterMessageId,
          delivery.transportMode ?? null,
          this.timestamp(),
          this.timestamp(),
          messageId,
        );
      audit(this.db, "message.sent", "message", messageId, row.device_id);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Delivery failed";
      if (error instanceof UnknownDeliveryConfirmationError) {
        this.db
          .prepare(
            `UPDATE messages SET
              delivery_state='confirmation_unknown',
              transport_mode=?,
              error=?,
              updated_at=?
            WHERE id=?`,
          )
          .run(
            error.transportMode,
            message,
            this.timestamp(),
            messageId,
          );
        audit(
          this.db,
          "message.confirmation_unknown",
          "message",
          messageId,
          row.device_id,
          { error: message, transportMode: error.transportMode },
        );
        return;
      }
      this.db
        .prepare(
          "UPDATE messages SET delivery_state='failed',error=?,updated_at=? WHERE id=?",
        )
        .run(message, this.timestamp(), messageId);
      audit(this.db, "message.failed", "message", messageId, row.device_id, {
        error: message,
      });
      throw error;
    }
  }

  async processQueuedMessages(
    limit = 25,
  ): Promise<{ processed: number; sent: number; failed: number }> {
    if (this.processingQueue) return { processed: 0, sent: 0, failed: 0 };
    this.processingQueue = true;
    try {
      const queued = this.db
        .prepare(
          `
        SELECT id FROM messages
        WHERE direction='outgoing' AND delivery_state='queued' AND available_after <= ?
        ORDER BY rowid ASC LIMIT ?
      `,
        )
        .all(this.clock().toISOString(), limit) as Array<{ id: string }>;
      let sent = 0;
      let failed = 0;
      for (const message of queued) {
        try {
          await this.deliver(message.id);
          const state = this.db
            .prepare("SELECT delivery_state FROM messages WHERE id=?")
            .get(message.id) as { delivery_state: string };
          if (state.delivery_state === "sent") sent++;
        } catch {
          failed++;
        }
      }
      return { processed: queued.length, sent, failed };
    } finally {
      this.processingQueue = false;
    }
  }

  async receiveIncoming(input: IncomingMessage): Promise<string> {
    const existing = this.db
      .prepare(
        "SELECT id FROM messages WHERE direction='incoming' AND source_message_id=?",
      )
      .get(input.adapterMessageId) as { id: string } | undefined;
    if (existing) return existing.id;
    const mapping = this.db
      .prepare(
        `
      SELECT cm.recipient_id,bs.device_id,bs.slot FROM chat_mappings cm
      JOIN button_slots bs ON bs.recipient_id=cm.recipient_id
      WHERE cm.adapter=? AND cm.chat_id=? LIMIT 1
    `,
      )
      .get(this.adapter.name, input.chatId) as any;
    if (!mapping)
      throw new RequestError("Incoming chat is not mapped to a button.", 404);
    await fs.mkdir(this.audioDir, { recursive: true });
    const id = nanoid();
    const audioPath = path.resolve(this.audioDir, `${id}.ogg`);
    await fs.writeFile(audioPath, input.audio, { flag: "wx" });
    const timestamp = this.timestamp();
    try {
      this.db
        .prepare(
          `
        INSERT INTO messages(id,device_id,recipient_id,direction,source_message_id,audio_path,original_mime,
        duration_ms,delivery_state,playback_state,available_after,created_at,updated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
        )
        .run(
          id,
          mapping.device_id,
          mapping.recipient_id,
          "incoming",
          input.adapterMessageId,
          audioPath,
          input.mime,
          input.durationMs ?? 0,
          "sent",
          "waiting",
          timestamp,
          timestamp,
          timestamp,
        );
    } catch (error) {
      await fs.rm(audioPath, { force: true });
      const duplicate = this.db
        .prepare(
          "SELECT id FROM messages WHERE direction='incoming' AND source_message_id=?",
        )
        .get(input.adapterMessageId) as { id: string } | undefined;
      if (duplicate) return duplicate.id;
      throw error;
    }
    audit(this.db, "message.incoming", "message", id, mapping.device_id, {
      slot: mapping.slot,
    });
    const waitingCount = this.waitingCount(
      mapping.device_id,
      mapping.recipient_id,
    );
    this.notify(mapping.device_id, {
      type: "queue.updated",
      slot: mapping.slot,
      waitingCount,
    });
    this.notify(mapping.device_id, {
      type: "message.available",
      slot: mapping.slot,
      messageId: id,
    });
    return id;
  }

  oldestWaiting(deviceId: string, recipientKey: string): any {
    return this.db
      .prepare(
        `
      SELECT m.id,m.audio_path,m.duration_ms,m.created_at FROM messages m JOIN recipients r ON r.id=m.recipient_id
      JOIN button_slots bs ON bs.recipient_id=r.id AND bs.device_id=m.device_id
      WHERE m.device_id=? AND r.recipient_key=? AND m.direction='incoming' AND m.playback_state='waiting'
      ORDER BY m.rowid ASC LIMIT 1
    `,
      )
      .get(deviceId, recipientKey);
  }

  acknowledgePlayback(
    deviceId: string,
    messageId: string,
    idempotencyKey: string,
  ): { messageId: string; state: string; duplicate?: boolean } {
    const existing = this.db
      .prepare(
        "SELECT response_json FROM idempotency_actions WHERE device_id=? AND idempotency_key=? AND action='playback.completed'",
      )
      .get(deviceId, idempotencyKey) as { response_json: string } | undefined;
    if (existing) {
      const prior = JSON.parse(existing.response_json) as {
        messageId: string;
        state: string;
      };
      if (prior.messageId !== messageId) {
        throw new RequestError(
          "This idempotency key was already used for another playback.",
          409,
        );
      }
      return { ...prior, duplicate: true };
    }
    const message = this.db
      .prepare(
        `
      SELECT m.*,bs.slot FROM messages m
      JOIN button_slots bs ON bs.device_id=m.device_id AND bs.recipient_id=m.recipient_id
      WHERE m.id=? AND m.device_id=? AND m.direction='incoming'
    `,
      )
      .get(messageId, deviceId) as any;
    if (!message)
      throw new RequestError(
        "Incoming message not found for this device.",
        404,
      );
    const response = { messageId, state: "played" };
    this.db.transaction(() => {
      this.db
        .prepare(
          "UPDATE messages SET playback_state='played',played_at=?,updated_at=? WHERE id=?",
        )
        .run(this.timestamp(), this.timestamp(), messageId);
      this.db
        .prepare(
          "INSERT INTO idempotency_actions(device_id,idempotency_key,action,response_json,created_at) VALUES (?,?,?,?,?)",
        )
        .run(
          deviceId,
          idempotencyKey,
          "playback.completed",
          JSON.stringify(response),
          this.timestamp(),
        );
      audit(this.db, "playback.completed", "message", messageId, deviceId);
    })();
    const waitingCount = this.waitingCount(deviceId, message.recipient_id);
    this.notify(deviceId, {
      type: "queue.updated",
      slot: message.slot,
      waitingCount,
    });
    return response;
  }

  private waitingCount(deviceId: string, recipientId: string): number {
    const row = this.db
      .prepare(
        `
      SELECT COUNT(*) count FROM messages
      WHERE device_id=? AND recipient_id=? AND direction='incoming' AND playback_state='waiting'
    `,
      )
      .get(deviceId, recipientId) as { count: number };
    return row.count;
  }

  listMessages(deviceId?: string): MessageSummary[] {
    const deviceFilter = deviceId ? "WHERE m.device_id=?" : "";
    return this.db
      .prepare(
        `
      SELECT m.id,m.direction,r.recipient_key,r.display_name,m.delivery_state,m.playback_state,
      m.duration_ms,m.created_at,m.error FROM messages m JOIN recipients r ON r.id=m.recipient_id
      ${deviceFilter} ORDER BY m.created_at DESC LIMIT 100
    `,
      )
      .all(...(deviceId ? [deviceId] : []))
      .map((row: any) => ({
        id: row.id,
        direction: row.direction,
        recipientKey: row.recipient_key,
        recipientName: row.display_name,
        deliveryState: row.delivery_state,
        playbackState: row.playback_state,
        durationMs: row.duration_ms,
        createdAt: row.created_at,
        error: row.error,
      }));
  }
}
