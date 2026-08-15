import { createHash, randomBytes, sign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import {
  assertImageIdentity,
  parseFirmwareIdentity,
} from "./firmware-release.mjs";

const root = path.resolve(import.meta.dirname, "..");
const argumentsByName = new Map();
for (let index = 2; index < process.argv.length; index += 2) {
  argumentsByName.set(process.argv[index], process.argv[index + 1]);
}
const identity = fs.readFileSync(
  path.join(root, "firmware/include/firmware_identity.h"),
  "utf8",
);
const compiledIdentity = parseFirmwareIdentity(identity);
const version = argumentsByName.get("--version") ?? compiledIdentity.version;
const build = Number(argumentsByName.get("--build") ?? compiledIdentity.build);
const target = compiledIdentity.target;
const deviceId = argumentsByName.get("--device") ?? "family-box-01";
const input = path.resolve(
  root,
  argumentsByName.get("--input") ??
    "firmware/.pio/build/esp32-s3-wroom-1-n16r8/firmware.bin",
);
const outputDirectory = path.resolve(
  root,
  argumentsByName.get("--output") ?? "data/firmware-packages",
);
const privateKeyPath = path.resolve(
  root,
  argumentsByName.get("--private-key") ??
    "data/firmware-signing-private.pem",
);
if (!version || !Number.isSafeInteger(build) || build < 1)
  throw new Error("Firmware identity is missing a valid version/build.");
const image = fs.readFileSync(input);
if (image.length < 24 || image.length > 0x640000 || image[0] !== 0xe9)
  throw new Error("The input is not a bounded ESP application image.");
assertImageIdentity(image, { version, build, target });
const updateId = `ota_${randomBytes(12).toString("hex")}`;
const unsigned = {
  updateId,
  deviceId,
  target,
  version,
  build,
  sizeBytes: image.length,
  sha256: createHash("sha256").update(image).digest("hex"),
  expiresAt: Math.floor(Date.now() / 1000) + 24 * 60 * 60,
};
const canonical = [
  "message-box-firmware-v1",
  unsigned.updateId,
  unsigned.deviceId,
  unsigned.target,
  unsigned.version,
  String(unsigned.build),
  String(unsigned.sizeBytes),
  unsigned.sha256,
  String(unsigned.expiresAt),
  "",
].join("\n");
const manifest = {
  ...unsigned,
  signature: sign(
    "sha256",
    Buffer.from(canonical),
    fs.readFileSync(privateKeyPath),
  ).toString("base64"),
};
fs.mkdirSync(outputDirectory, { recursive: true });
const binaryPath = path.join(outputDirectory, `${updateId}.bin`);
const manifestPath = path.join(outputDirectory, `${updateId}.manifest.json`);
fs.writeFileSync(binaryPath, image, { flag: "wx", mode: 0o600 });
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
  flag: "wx",
  mode: 0o600,
});
console.log(`Signed firmware package: ${path.relative(root, manifestPath)}`);
console.log(`Firmware binary: ${path.relative(root, binaryPath)}`);
