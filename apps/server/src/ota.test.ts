import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FirmwareUpdateManifest } from "@family-box/contracts";
import { buildApp, type AppContext } from "./app.js";
import { seedDevice } from "./db.js";
import { canonicalFirmwareManifest } from "./firmware.js";

let tempDir: string;
let context: AppContext;
let privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"];

function firmwarePackage(
  overrides: Partial<FirmwareUpdateManifest> = {},
): { image: Buffer; manifest: FirmwareUpdateManifest } {
  const image = Buffer.alloc(512, 0x51);
  image[0] = 0xe9;
  const unsigned = {
    updateId: "ota_route_update_01",
    deviceId: "family-box-01",
    target: "esp32-s3-wroom-1-n16r8" as const,
    version: "1.4.0-wifi-ota",
    build: 10400,
    sizeBytes: image.length,
    sha256: createHash("sha256").update(image).digest("hex"),
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
  return {
    image,
    manifest: {
      ...unsigned,
      signature: sign(
        "sha256",
        Buffer.from(canonicalFirmwareManifest(unsigned as FirmwareUpdateManifest)),
        privateKey,
      ).toString("base64"),
    },
  };
}

function uploadHeaders(manifest: FirmwareUpdateManifest) {
  return {
    authorization: "Bearer test-ota-administration-token-123456",
    "x-ota-csrf": "1",
    "x-firmware-manifest": Buffer.from(JSON.stringify(manifest)).toString(
      "base64url",
    ),
    "content-type": "application/octet-stream",
  };
}

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "family-box-ota-api-"));
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  privateKey = keys.privateKey;
  const publicKeyPath = path.join(tempDir, "firmware-public.pem");
  await fs.writeFile(
    publicKeyPath,
    keys.publicKey.export({ type: "spki", format: "pem" }),
  );
  context = await buildApp({
    host: "127.0.0.1",
    databasePath: ":memory:",
    audioDir: path.join(tempDir, "audio"),
    firmwareDir: path.join(tempDir, "firmware"),
    firmwareAdminToken: "test-ota-administration-token-123456",
    firmwareSigningPublicKeyPath: publicKeyPath,
    mockAdapter: true,
    seedDevelopmentDevice: true,
    developmentDeviceCredential: "dev-device-secret",
  });
});

afterEach(async () => {
  await context.app.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("signed LAN firmware updates", () => {
  it("requires the OTA bearer token, confirmation header, and allowed browser origin", async () => {
    const firmware = firmwarePackage();
    const encodedManifest = Buffer.from(
      JSON.stringify(firmware.manifest),
    ).toString("base64url");
    const noToken = await context.app.inject({
      method: "POST",
      url: "/api/admin/firmware?deviceId=family-box-01",
      headers: {
        "content-type": "application/octet-stream",
        "x-ota-csrf": "1",
        "x-firmware-manifest": encodedManifest,
      },
      payload: firmware.image,
    });
    expect(noToken.statusCode).toBe(401);

    const noConfirmation = await context.app.inject({
      method: "POST",
      url: "/api/admin/firmware?deviceId=family-box-01",
      headers: {
        authorization: "Bearer test-ota-administration-token-123456",
        "content-type": "application/octet-stream",
        "x-firmware-manifest": encodedManifest,
      },
      payload: firmware.image,
    });
    expect(noConfirmation.statusCode).toBe(403);

    const wrongOrigin = await context.app.inject({
      method: "POST",
      url: "/api/admin/firmware?deviceId=family-box-01",
      headers: {
        ...uploadHeaders(firmware.manifest),
        origin: "https://attacker.example",
      },
      payload: firmware.image,
    });
    expect(wrongOrigin.statusCode).toBe(403);
  });

  it("stages a signed device-scoped image and makes it recoverable after reconnect", async () => {
    const firmware = firmwarePackage();
    const staged = await context.app.inject({
      method: "POST",
      url: "/api/admin/firmware?deviceId=family-box-01",
      headers: uploadHeaders(firmware.manifest),
      payload: firmware.image,
    });
    expect(staged.statusCode).toBe(201);
    expect(staged.json()).toMatchObject({
      updateId: firmware.manifest.updateId,
      version: firmware.manifest.version,
      build: firmware.manifest.build,
      state: "staged",
    });

    const deviceHeaders = {
      "x-device-id": "family-box-01",
      "x-device-credential": "dev-device-secret",
    };
    const pending = await context.app.inject({
      method: "GET",
      url: "/api/device/firmware/pending",
      headers: deviceHeaders,
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json()).toMatchObject(firmware.manifest);

    const download = await context.app.inject({
      method: "GET",
      url: `/api/device/firmware/${firmware.manifest.updateId}`,
      headers: deviceHeaders,
    });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload).toEqual(firmware.image);
    expect(download.headers["x-firmware-sha256"]).toBe(
      firmware.manifest.sha256,
    );
    expect(download.headers["cache-control"]).toBe("private, no-store");
  });

  it("prevents another valid device from reading an update", async () => {
    seedDevice(context.db, "other-box", "other-device-secret");
    const firmware = firmwarePackage();
    await context.app.inject({
      method: "POST",
      url: "/api/admin/firmware?deviceId=family-box-01",
      headers: uploadHeaders(firmware.manifest),
      payload: firmware.image,
    });

    const response = await context.app.inject({
      method: "GET",
      url: `/api/device/firmware/${firmware.manifest.updateId}`,
      headers: {
        "x-device-id": "other-box",
        "x-device-credential": "other-device-secret",
      },
    });
    expect(response.statusCode).toBe(404);
  });

  it("enforces device-reported update transitions and exposes status on the dashboard", async () => {
    const firmware = firmwarePackage();
    await context.app.inject({
      method: "POST",
      url: "/api/admin/firmware?deviceId=family-box-01",
      headers: uploadHeaders(firmware.manifest),
      payload: firmware.image,
    });
    const headers = {
      "x-device-id": "family-box-01",
      "x-device-credential": "dev-device-secret",
    };
    const skipped = await context.app.inject({
      method: "POST",
      url: `/api/device/firmware/${firmware.manifest.updateId}/status`,
      headers,
      payload: { state: "installing" },
    });
    expect(skipped.statusCode).toBe(409);

    for (const state of ["downloading", "installing", "rebooting"] as const) {
      const response = await context.app.inject({
        method: "POST",
        url: `/api/device/firmware/${firmware.manifest.updateId}/status`,
        headers,
        payload: { state },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json().state).toBe(state);
    }

    const dashboard = await context.app.inject({
      method: "GET",
      url: "/api/admin/dashboard",
    });
    expect(dashboard.json().latestFirmwareUpdate).toMatchObject({
      updateId: firmware.manifest.updateId,
      state: "rebooting",
    });
  });
});
