import { createHash, randomBytes, verify } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export const FIRMWARE_TARGET = "esp32-s3-wroom-1-n16r8" as const;
export const MAX_FIRMWARE_BYTES = 0x640000;
export const MIN_FIRMWARE_BYTES = 24;

export interface FirmwareManifest {
  updateId: string;
  deviceId: string;
  target: typeof FIRMWARE_TARGET;
  version: string;
  build: number;
  sizeBytes: number;
  sha256: string;
  expiresAt: number;
  signature: string;
}

const UPDATE_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;
const DEVICE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,63}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

export class FirmwareValidationError extends Error {}

export function canonicalFirmwareManifest(
  manifest: Omit<FirmwareManifest, "signature"> | FirmwareManifest,
): string {
  return [
    "message-box-firmware-v1",
    manifest.updateId,
    manifest.deviceId,
    manifest.target,
    manifest.version,
    String(manifest.build),
    String(manifest.sizeBytes),
    manifest.sha256,
    String(manifest.expiresAt),
    "",
  ].join("\n");
}

export function validateFirmwareManifest(
  manifest: FirmwareManifest,
  nowSeconds = Math.floor(Date.now() / 1000),
): void {
  if (!manifest || typeof manifest !== "object")
    throw new FirmwareValidationError("The firmware manifest is invalid.");
  if (!UPDATE_ID_PATTERN.test(manifest.updateId))
    throw new FirmwareValidationError("The firmware update ID is invalid.");
  if (!DEVICE_ID_PATTERN.test(manifest.deviceId))
    throw new FirmwareValidationError("The firmware device ID is invalid.");
  if (manifest.target !== FIRMWARE_TARGET)
    throw new FirmwareValidationError("The firmware targets a different board.");
  if (!VERSION_PATTERN.test(manifest.version))
    throw new FirmwareValidationError("The firmware version is invalid.");
  if (!Number.isSafeInteger(manifest.build) || manifest.build < 1)
    throw new FirmwareValidationError("The firmware build number is invalid.");
  if (
    !Number.isSafeInteger(manifest.sizeBytes) ||
    manifest.sizeBytes < MIN_FIRMWARE_BYTES ||
    manifest.sizeBytes > MAX_FIRMWARE_BYTES
  )
    throw new FirmwareValidationError("The firmware size is invalid.");
  if (!SHA256_PATTERN.test(manifest.sha256))
    throw new FirmwareValidationError("The firmware SHA-256 is invalid.");
  if (
    !Number.isSafeInteger(manifest.expiresAt) ||
    manifest.expiresAt <= nowSeconds ||
    manifest.expiresAt > nowSeconds + 7 * 24 * 60 * 60
  )
    throw new FirmwareValidationError("The firmware manifest has expired or lasts too long.");
  if (typeof manifest.signature !== "string" || manifest.signature.length < 16 || manifest.signature.length > 256)
    throw new FirmwareValidationError("The firmware signature is invalid.");
}

export function validateFirmwarePackage(
  image: Buffer,
  manifest: FirmwareManifest,
  publicKeyPem: string,
): { sha256: string } {
  validateFirmwareManifest(manifest);
  if (image.length !== manifest.sizeBytes)
    throw new FirmwareValidationError("The firmware size does not match its manifest.");
  if (image[0] !== 0xe9)
    throw new FirmwareValidationError("The upload is not an ESP32 application image.");
  const sha256 = createHash("sha256").update(image).digest("hex");
  if (sha256 !== manifest.sha256)
    throw new FirmwareValidationError("The firmware digest does not match its manifest.");
  let signature: Buffer;
  try {
    signature = Buffer.from(manifest.signature, "base64");
  } catch {
    throw new FirmwareValidationError("The firmware signature is invalid.");
  }
  if (
    signature.length === 0 ||
    !verify(
      "sha256",
      Buffer.from(canonicalFirmwareManifest(manifest)),
      publicKeyPem,
      signature,
    )
  )
    throw new FirmwareValidationError("The firmware signature is invalid.");
  return { sha256 };
}

export async function stageFirmwareImage(
  firmwareDir: string,
  updateId: string,
  image: Buffer,
): Promise<string> {
  if (!UPDATE_ID_PATTERN.test(updateId))
    throw new FirmwareValidationError("The firmware update ID is invalid.");
  const root = path.resolve(firmwareDir);
  await fs.mkdir(root, { recursive: true });
  const finalPath = path.join(root, `${updateId}.bin`);
  const temporaryPath = path.join(
    root,
    `.${updateId}.${randomBytes(8).toString("hex")}.tmp`,
  );
  try {
    await fs.writeFile(temporaryPath, image, { flag: "wx", mode: 0o600 });
    await fs.rename(temporaryPath, finalPath);
    return finalPath;
  } catch (error) {
    await fs.rm(temporaryPath, { force: true });
    throw error;
  }
}

export function firmwarePath(firmwareDir: string, updateId: string): string {
  if (!UPDATE_ID_PATTERN.test(updateId))
    throw new FirmwareValidationError("The firmware update ID is invalid.");
  return path.join(path.resolve(firmwareDir), `${updateId}.bin`);
}
