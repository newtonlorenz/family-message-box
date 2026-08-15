/* global AbortSignal, fetch */
import fs from "node:fs";
import path from "node:path";

import { assertSecureFirmwareUrl } from "./firmware-release.mjs";

const root = path.resolve(import.meta.dirname, "..");
const env = new Map();
for (const line of fs.readFileSync(path.join(root, ".env"), "utf8").split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match) env.set(match[1], match[2]);
}
const manifestPath = process.argv[2];
const binaryPath = process.argv[3];
if (!manifestPath || !binaryPath)
  throw new Error(
    "Usage: node scripts/upload-firmware.mjs <manifest.json> <firmware.bin>",
  );
const manifest = JSON.parse(fs.readFileSync(path.resolve(manifestPath), "utf8"));
const image = fs.readFileSync(path.resolve(binaryPath));
const token = env.get("FIRMWARE_ADMIN_TOKEN");
if (!token) throw new Error("FIRMWARE_ADMIN_TOKEN is not configured in .env.");
const baseUrl = (
  process.env.FIRMWARE_BASE_URL ??
  `http://${env.get("FAMILY_BOX_BIND_IP") ?? "127.0.0.1"}:${env.get("PORT") ?? "8787"}`
).replace(/\/$/, "");
assertSecureFirmwareUrl(
  baseUrl,
  process.argv.includes("--allow-insecure-http") ||
    process.env.ALLOW_INSECURE_FIRMWARE_HTTP === "true",
);
const response = await fetch(
  `${baseUrl}/api/admin/firmware?deviceId=${encodeURIComponent(manifest.deviceId)}`,
  {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "x-ota-csrf": "1",
      "x-firmware-manifest": Buffer.from(JSON.stringify(manifest)).toString(
        "base64url",
      ),
      "content-type": "application/octet-stream",
    },
    body: image,
    signal: AbortSignal.timeout(30_000),
  },
);
const body = await response.json();
if (!response.ok) throw new Error(body.error ?? `Upload failed (${response.status}).`);
console.log(
  `Staged ${body.version} build ${body.build} for ${body.deviceId}; state=${body.state}.`,
);
