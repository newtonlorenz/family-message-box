import path from "node:path";
import { config as loadEnv } from "dotenv";

export const projectRoot = path.resolve(import.meta.dirname, "../../..");
loadEnv({ path: path.join(projectRoot, ".env") });

export interface AppConfig {
  host: string;
  exposureHost: string;
  port: number;
  databasePath: string;
  audioDir: string;
  firmwareDir: string;
  deviceBootstrapToken: string;
  firmwareAdminToken: string;
  firmwareSigningPublicKeyPath: string | undefined;
  allowInsecureLanOta: boolean;
  seedDevelopmentDevice: boolean;
  developmentDeviceCredential: string;
  ffmpegPath: string;
  maxUploadBytes: number;
  maxFirmwareBytes: number;
  adminOrigin: string;
  tlsCertPath: string | undefined;
  tlsKeyPath: string | undefined;
  mockAdapter: boolean;
  messagingAdapter: "mock" | "twilio-whatsapp" | "whatsapp-web";
  whatsappWebDataPath: string;
  whatsappWebChromePath: string | undefined;
  twilioAccountSid: string | undefined;
  twilioAuthToken: string | undefined;
  twilioWhatsAppFrom: string;
  twilioContentSid: string | undefined;
  twilioPublicBaseUrl: string | undefined;
  twilioWebhookUrl: string | undefined;
}

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);
const PLACEHOLDER_BOOTSTRAP_TOKENS = new Set([
  "development-only-token",
  "change-this-before-lan-use",
]);

export function getConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  const host = process.env.HOST ?? "127.0.0.1";
  const exposureHost = process.env.FAMILY_BOX_BIND_IP ?? host;
  const effectiveExposureHost =
    overrides.exposureHost ?? overrides.host ?? exposureHost;
  const seedDevelopmentDevice =
    overrides.seedDevelopmentDevice ??
    (process.env.SEED_DEVELOPMENT_DEVICE === undefined
      ? LOOPBACK_HOSTS.has(effectiveExposureHost)
      : process.env.SEED_DEVELOPMENT_DEVICE === "true");
  const environmentAdapter = process.env.MESSAGING_ADAPTER as
    AppConfig["messagingAdapter"] | undefined;
  const config: AppConfig = {
    host,
    exposureHost: effectiveExposureHost,
    port: Number(process.env.PORT ?? 8787),
    databasePath: process.env.DATABASE_PATH ?? "./data/family-box.db",
    audioDir: process.env.AUDIO_DIR ?? "./data/audio",
    firmwareDir: process.env.FIRMWARE_DIR ?? "./data/firmware",
    deviceBootstrapToken:
      process.env.DEVICE_BOOTSTRAP_TOKEN ?? "development-only-token",
    firmwareAdminToken: process.env.FIRMWARE_ADMIN_TOKEN ?? "",
    firmwareSigningPublicKeyPath:
      process.env.FIRMWARE_SIGNING_PUBLIC_KEY_PATH || undefined,
    allowInsecureLanOta: process.env.ALLOW_INSECURE_LAN_OTA === "true",
    seedDevelopmentDevice,
    developmentDeviceCredential:
      process.env.DEVELOPMENT_DEVICE_CREDENTIAL ?? "dev-device-secret",
    ffmpegPath: process.env.FFMPEG_PATH ?? "ffmpeg",
    maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 5_000_000),
    maxFirmwareBytes: Number(process.env.MAX_FIRMWARE_BYTES ?? 0x640000),
    adminOrigin: process.env.ADMIN_ORIGIN ?? "http://127.0.0.1:5173",
    tlsCertPath: process.env.TLS_CERT_PATH || undefined,
    tlsKeyPath: process.env.TLS_KEY_PATH || undefined,
    mockAdapter: process.env.MOCK_ADAPTER !== "false",
    messagingAdapter:
      environmentAdapter ??
      (process.env.MOCK_ADAPTER !== "false" ? "mock" : "twilio-whatsapp"),
    whatsappWebDataPath:
      process.env.WHATSAPP_WEB_DATA_PATH ?? "./data/whatsapp-web",
    whatsappWebChromePath: process.env.WHATSAPP_WEB_CHROME_PATH || undefined,
    twilioAccountSid: process.env.TWILIO_ACCOUNT_SID || undefined,
    twilioAuthToken: process.env.TWILIO_AUTH_TOKEN || undefined,
    twilioWhatsAppFrom:
      process.env.TWILIO_WHATSAPP_FROM ?? "whatsapp:+14155238886",
    twilioContentSid: process.env.TWILIO_CONTENT_SID || undefined,
    twilioPublicBaseUrl: process.env.TWILIO_PUBLIC_BASE_URL || undefined,
    twilioWebhookUrl: process.env.TWILIO_WEBHOOK_URL || undefined,
    ...overrides,
  };
  if (
    overrides.mockAdapter === true &&
    overrides.messagingAdapter === undefined
  ) {
    config.messagingAdapter = "mock";
  } else if (
    overrides.mockAdapter === false &&
    overrides.messagingAdapter === undefined
  ) {
    config.messagingAdapter = "twilio-whatsapp";
  }
  if (
    !["mock", "twilio-whatsapp", "whatsapp-web"].includes(
      config.messagingAdapter,
    )
  ) {
    throw new Error(
      "MESSAGING_ADAPTER must be mock, twilio-whatsapp, or whatsapp-web.",
    );
  }
  if (Boolean(config.tlsCertPath) !== Boolean(config.tlsKeyPath)) {
    throw new Error("TLS_CERT_PATH and TLS_KEY_PATH must be set together.");
  }
  if (
    !LOOPBACK_HOSTS.has(config.exposureHost) &&
    PLACEHOLDER_BOOTSTRAP_TOKENS.has(config.deviceBootstrapToken)
  ) {
    throw new Error(
      "Set a strong DEVICE_BOOTSTRAP_TOKEN before binding the server beyond loopback.",
    );
  }
  if (
    !LOOPBACK_HOSTS.has(config.exposureHost) &&
    config.seedDevelopmentDevice &&
    config.developmentDeviceCredential === "dev-device-secret"
  ) {
    throw new Error(
      "The known development device credential cannot be seeded beyond loopback.",
    );
  }
  if (
    config.firmwareAdminToken &&
    Buffer.byteLength(config.firmwareAdminToken, "utf8") < 32
  ) {
    throw new Error("FIRMWARE_ADMIN_TOKEN must be at least 32 bytes.");
  }
  if (
    config.firmwareAdminToken &&
    !LOOPBACK_HOSTS.has(config.exposureHost) &&
    !config.tlsCertPath &&
    !config.allowInsecureLanOta
  ) {
    throw new Error(
      "LAN firmware updates require TLS, or the explicit ALLOW_INSECURE_LAN_OTA=true development override.",
    );
  }
  if (config.messagingAdapter === "twilio-whatsapp") {
    if (!config.twilioAccountSid || !config.twilioAuthToken) {
      throw new Error(
        "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN are required for the Twilio adapter.",
      );
    }
    if (
      !config.twilioPublicBaseUrl ||
      !config.twilioPublicBaseUrl.startsWith("https://")
    ) {
      throw new Error(
        "TWILIO_PUBLIC_BASE_URL must be a public HTTPS origin for the Twilio adapter.",
      );
    }
    if (
      config.twilioWebhookUrl &&
      !config.twilioWebhookUrl.startsWith("https://")
    ) {
      throw new Error("TWILIO_WEBHOOK_URL must use HTTPS.");
    }
  }
  return {
    ...config,
    databasePath:
      config.databasePath === ":memory:" || path.isAbsolute(config.databasePath)
        ? config.databasePath
        : path.resolve(projectRoot, config.databasePath),
    audioDir: path.isAbsolute(config.audioDir)
      ? config.audioDir
      : path.resolve(projectRoot, config.audioDir),
    firmwareDir: path.isAbsolute(config.firmwareDir)
      ? config.firmwareDir
      : path.resolve(projectRoot, config.firmwareDir),
    firmwareSigningPublicKeyPath:
      config.firmwareSigningPublicKeyPath &&
      !path.isAbsolute(config.firmwareSigningPublicKeyPath)
        ? path.resolve(projectRoot, config.firmwareSigningPublicKeyPath)
        : config.firmwareSigningPublicKeyPath,
    tlsCertPath:
      config.tlsCertPath && !path.isAbsolute(config.tlsCertPath)
        ? path.resolve(projectRoot, config.tlsCertPath)
        : config.tlsCertPath,
    tlsKeyPath:
      config.tlsKeyPath && !path.isAbsolute(config.tlsKeyPath)
        ? path.resolve(projectRoot, config.tlsKeyPath)
        : config.tlsKeyPath,
    whatsappWebDataPath: path.isAbsolute(config.whatsappWebDataPath)
      ? config.whatsappWebDataPath
      : path.resolve(projectRoot, config.whatsappWebDataPath),
  };
}
