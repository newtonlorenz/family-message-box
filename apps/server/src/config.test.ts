import path from "node:path";
import { describe, expect, it } from "vitest";
import { getConfig, projectRoot } from "./config.js";

describe("configuration paths", () => {
  it("resolves local data from the repository root, independent of workspace cwd", () => {
    const config = getConfig({
      databasePath: "./data/test.db",
      audioDir: "./data/audio-test",
    });
    expect(config.databasePath).toBe(path.join(projectRoot, "data/test.db"));
    expect(config.audioDir).toBe(path.join(projectRoot, "data/audio-test"));
    expect(config.whatsappWebDataPath).toBe(
      path.join(projectRoot, "data/whatsapp-web"),
    );
  });

  it("preserves absolute container and test paths", () => {
    const config = getConfig({
      databasePath: "/app/data/family-box.db",
      audioDir: "/app/data/audio",
    });
    expect(config.databasePath).toBe("/app/data/family-box.db");
    expect(config.audioDir).toBe("/app/data/audio");
  });

  it("requires a complete TLS key pair and resolves relative certificate paths", () => {
    expect(() =>
      getConfig({ tlsCertPath: "./.certs/server.crt", tlsKeyPath: undefined }),
    ).toThrow("TLS_CERT_PATH and TLS_KEY_PATH");
    const config = getConfig({
      tlsCertPath: "./.certs/server.crt",
      tlsKeyPath: "./.certs/server.key",
    });
    expect(config.tlsCertPath).toBe(
      path.join(projectRoot, ".certs/server.crt"),
    );
    expect(config.tlsKeyPath).toBe(path.join(projectRoot, ".certs/server.key"));
  });

  it("configures the Twilio WhatsApp Sandbox sender", () => {
    expect(
      getConfig({ twilioWhatsAppFrom: "whatsapp:+14155238886" })
        .twilioWhatsAppFrom,
    ).toBe("whatsapp:+14155238886");
  });

  it("requires complete Twilio configuration when the live adapter is selected", () => {
    expect(() =>
      getConfig({
        mockAdapter: false,
        twilioAccountSid: undefined,
        twilioAuthToken: undefined,
        twilioPublicBaseUrl: undefined,
      }),
    ).toThrow("TWILIO_ACCOUNT_SID");

    expect(
      getConfig({
        mockAdapter: false,
        twilioAccountSid: "AC00000000000000000000000000000000",
        twilioAuthToken: "test-auth-token",
        twilioPublicBaseUrl: "https://box.example",
      }).twilioPublicBaseUrl,
    ).toBe("https://box.example");
  });

  it("selects WhatsApp Web without requiring Twilio credentials", () => {
    const config = getConfig({
      messagingAdapter: "whatsapp-web",
      mockAdapter: false,
      twilioAccountSid: undefined,
      twilioAuthToken: undefined,
      twilioPublicBaseUrl: undefined,
    });
    expect(config.messagingAdapter).toBe("whatsapp-web");
  });

  it("refuses placeholder bootstrap credentials on a LAN bind", () => {
    expect(() =>
      getConfig({
        host: "0.0.0.0",
        deviceBootstrapToken: "change-this-before-lan-use",
        seedDevelopmentDevice: false,
      }),
    ).toThrow("strong DEVICE_BOOTSTRAP_TOKEN");
  });

  it("allows an internal container wildcard when the published port is loopback-only", () => {
    const config = getConfig({
      host: "0.0.0.0",
      exposureHost: "127.0.0.1",
      deviceBootstrapToken: "change-this-before-lan-use",
    });

    expect(config.host).toBe("0.0.0.0");
    expect(config.exposureHost).toBe("127.0.0.1");
    expect(config.seedDevelopmentDevice).toBe(true);
  });

  it("does not seed the development device by default on a LAN bind", () => {
    const config = getConfig({
      host: "0.0.0.0",
      deviceBootstrapToken: "a-long-random-bootstrap-token",
    });
    expect(config.seedDevelopmentDevice).toBe(false);
  });
});
