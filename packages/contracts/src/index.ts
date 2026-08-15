export const BUTTON_SLOTS = [1, 2, 3, 4, 5, 6, 7, 8] as const;
export type ButtonSlot = (typeof BUTTON_SLOTS)[number];

export type MessageDirection = "outgoing" | "incoming";
export type DeliveryState =
  | "queued"
  | "converting"
  | "ready"
  | "sending"
  | "sent"
  | "confirmation_unknown"
  | "failed";
export type PlaybackState = "not_applicable" | "waiting" | "playing" | "played";

export interface DeviceStatus {
  id: string;
  name: string;
  online: boolean;
  lastSeenAt: string | null;
  firmwareVersion: string | null;
  batteryPercent: number | null;
}

export interface ButtonAssignment {
  slot: ButtonSlot;
  recipientKey: string | null;
  recipientName: string | null;
  chatId: string | null;
  status: "unassigned" | "ready" | "waiting" | "recording" | "quiet";
  waitingCount: number;
  nextMessageId: string | null;
}

export interface DeviceConfig {
  deviceId: string;
  buttons: ButtonAssignment[];
  settings: {
    volume: number;
    chimeVolume: number;
    microphoneGainPercent: number;
    microphoneNoiseGatePercent: number;
    minDurationSeconds: number;
    maxDurationSeconds: number;
    quietHoursStart: string | null;
    quietHoursEnd: string | null;
  };
}

export type FirmwareUpdateState =
  | "staged"
  | "downloading"
  | "installing"
  | "rebooting"
  | "succeeded"
  | "failed"
  | "rolled_back"
  | "superseded";

export interface FirmwareUpdateManifest {
  updateId: string;
  deviceId: string;
  target: "esp32-s3-wroom-1-n16r8";
  version: string;
  build: number;
  sizeBytes: number;
  sha256: string;
  expiresAt: number;
  signature: string;
}

export interface FirmwareUpdateSummary extends FirmwareUpdateManifest {
  state: FirmwareUpdateState;
  error: string | null;
  createdAt: string;
  updatedAt: string;
}

export type DeviceToServerEvent =
  | { type: "device.hello"; deviceId: string; firmwareVersion: string }
  | { type: "device.heartbeat"; deviceId: string; batteryPercent?: number };

export type ServerToDeviceEvent =
  | { type: "config.updated"; config: DeviceConfig }
  | { type: "queue.updated"; slot: ButtonSlot; waitingCount: number }
  | { type: "message.available"; slot: ButtonSlot; messageId: string }
  | { type: "settings.updated"; settings: DeviceConfig["settings"] }
  | { type: "firmware.update.available"; update: FirmwareUpdateManifest }
  | { type: "server.error"; code: string; message: string };

export interface MessageSummary {
  id: string;
  direction: MessageDirection;
  recipientKey: string;
  recipientName: string;
  deliveryState: DeliveryState;
  playbackState: PlaybackState;
  durationMs: number;
  createdAt: string;
  error: string | null;
}
