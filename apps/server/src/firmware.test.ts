import { createHash, generateKeyPairSync, sign } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_FIRMWARE_BYTES,
  canonicalFirmwareManifest,
  stageFirmwareImage,
  validateFirmwarePackage,
  type FirmwareManifest,
} from "./firmware.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true }),
    ),
  );
});

function signedPackage(overrides: Partial<FirmwareManifest> = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ec", {
    namedCurve: "prime256v1",
  });
  const image = Buffer.alloc(256, 0x42);
  image[0] = 0xe9;
  const digest = createHash("sha256").update(image).digest("hex");
  const unsigned = {
    updateId: "ota_test_update_01",
    deviceId: "family-box-01",
    target: "esp32-s3-wroom-1-n16r8" as const,
    version: "1.4.0",
    build: 10400,
    sizeBytes: image.length,
    sha256: digest,
    expiresAt: Math.floor(Date.now() / 1000) + 3600,
    ...overrides,
  };
  const manifest = {
    ...unsigned,
    sha256: overrides.sha256 ?? digest,
    signature:
      overrides.signature ??
      sign(
        "sha256",
        Buffer.from(canonicalFirmwareManifest(unsigned as FirmwareManifest)),
        privateKey,
      ).toString("base64"),
  } as FirmwareManifest;
  return {
    image,
    manifest,
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

describe("signed firmware packages", () => {
  it("accepts a signed ESP32-S3 image and stores it under a generated safe path", async () => {
    const firmwareDir = await fs.mkdtemp(path.join(os.tmpdir(), "message-box-ota-"));
    temporaryDirectories.push(firmwareDir);
    const firmware = await signedPackage();

    const validated = validateFirmwarePackage(
      firmware.image,
      firmware.manifest,
      firmware.publicKeyPem,
    );
    const storedPath = await stageFirmwareImage(
      firmwareDir,
      firmware.manifest.updateId,
      firmware.image,
    );

    expect(validated.sha256).toBe(firmware.manifest.sha256);
    expect(path.dirname(storedPath)).toBe(path.resolve(firmwareDir));
    expect(path.basename(storedPath)).toBe("ota_test_update_01.bin");
    expect(await fs.readFile(storedPath)).toEqual(firmware.image);
  });

  it.each([
    ["truncated image", Buffer.alloc(23), {}],
    ["wrong ESP image magic", Buffer.alloc(24), {}],
    ["oversized image", Buffer.alloc(MAX_FIRMWARE_BYTES + 1, 0xe9), {}],
    ["wrong target", undefined, { target: "esp32" }],
    ["unsafe version", undefined, { version: "../firmware" }],
    ["expired manifest", undefined, { expiresAt: 1 }],
    ["invalid digest", undefined, { sha256: "00".repeat(32) }],
    ["invalid signature", undefined, { signature: Buffer.from("bad").toString("base64") }],
  ])("rejects %s", async (_name, replacementImage, overrides) => {
    const firmware = await signedPackage(overrides as Partial<FirmwareManifest>);
    expect(() =>
      validateFirmwarePackage(
        (replacementImage as Buffer | undefined) ?? firmware.image,
        firmware.manifest,
        firmware.publicKeyPem,
      ),
    ).toThrow();
  });

  it("never accepts a client-controlled path as an update id", async () => {
    const firmwareDir = await fs.mkdtemp(path.join(os.tmpdir(), "message-box-ota-"));
    temporaryDirectories.push(firmwareDir);

    await expect(
      stageFirmwareImage(firmwareDir, "../../outside", Buffer.from([0xe9])),
    ).rejects.toThrow();
  });
});
