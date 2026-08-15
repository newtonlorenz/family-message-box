import {
  createPublicKey,
  generateKeyPairSync,
  randomBytes,
} from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const envPath = path.join(root, ".env");
const privateKeyPath = path.join(root, "data/firmware-signing-private.pem");
const publicKeyPath = path.join(root, "data/firmware-signing-public.pem");
fs.mkdirSync(path.dirname(privateKeyPath), { recursive: true });
if (!fs.existsSync(privateKeyPath)) {
  const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  fs.writeFileSync(
    privateKeyPath,
    keys.privateKey.export({ type: "pkcs8", format: "pem" }),
    { mode: 0o600 },
  );
  fs.writeFileSync(
    publicKeyPath,
    keys.publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o644 },
  );
} else if (!fs.existsSync(publicKeyPath)) {
  const publicKey = createPublicKey(fs.readFileSync(privateKeyPath));
  fs.writeFileSync(
    publicKeyPath,
    publicKey.export({ type: "spki", format: "pem" }),
    { mode: 0o644 },
  );
}
fs.chmodSync(privateKeyPath, 0o600);
const existing = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
const values = new Map();
for (const line of existing.split(/\r?\n/)) {
  const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/);
  if (match) values.set(match[1], match[2]);
}

if (!values.get("FIRMWARE_ADMIN_TOKEN")) {
  values.set("FIRMWARE_ADMIN_TOKEN", randomBytes(32).toString("hex"));
}
values.set("FIRMWARE_DIR", "./data/firmware");
values.set(
  "FIRMWARE_SIGNING_PUBLIC_KEY_PATH",
  "./data/firmware-signing-public.pem",
);
values.set("MAX_FIRMWARE_BYTES", "6553600");
const allowInsecureHttp = process.argv.includes("--allow-insecure-http");
values.set("ALLOW_INSECURE_LAN_OTA", allowInsecureHttp ? "true" : "false");
const requestedBindIp = process.argv
  .slice(2)
  .find((argument) => argument !== "--allow-insecure-http");
const interfaces = os.networkInterfaces();
const privateIpv4 = (interfaces.en0 ?? Object.values(interfaces).flat())
  .filter(Boolean)
  .find(
    (address) =>
      address.family === "IPv4" &&
      !address.internal &&
      (/^192\.168\./.test(address.address) ||
        /^10\./.test(address.address) ||
        /^172\.(1[6-9]|2\d|3[01])\./.test(address.address)),
  )?.address;
const bindIp = requestedBindIp ?? privateIpv4;
if (!bindIp) {
  throw new Error(
    "Could not determine a private LAN address. Pass one as the first argument.",
  );
}
values.set("FAMILY_BOX_BIND_IP", bindIp);

const managed = new Set([
  "FIRMWARE_ADMIN_TOKEN",
  "FIRMWARE_DIR",
  "FIRMWARE_SIGNING_PUBLIC_KEY_PATH",
  "MAX_FIRMWARE_BYTES",
  "ALLOW_INSECURE_LAN_OTA",
  "FAMILY_BOX_BIND_IP",
]);
const preserved = existing
  .split(/\r?\n/)
  .filter((line) => {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=/);
    return !match || !managed.has(match[1]);
  })
  .join("\n")
  .replace(/\n+$/, "");
const block = [...managed].map((key) => `${key}=${values.get(key)}`).join("\n");
fs.writeFileSync(envPath, `${preserved}\n${block}\n`, { mode: 0o600 });
fs.chmodSync(envPath, 0o600);
console.log(
  `Firmware OTA credentials and signing paths are configured for ${bindIp}.`,
);
if (allowInsecureHttp) {
  console.warn(
    "Private-LAN HTTP OTA was explicitly enabled. Device and admin credentials are not encrypted in transit.",
  );
}
