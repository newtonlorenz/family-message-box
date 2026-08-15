import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const baseUrl = process.env.API_URL ?? "http://127.0.0.1:8787";
const deviceId = process.env.DEVICE_ID ?? "family-box-01";
const credential = process.env.DEVICE_CREDENTIAL ?? "dev-device-secret";
const command = process.argv[2] ?? "status";
const recipientKey = process.argv[3];

const headers = { "x-device-id": deviceId, "x-device-credential": credential };

if (command === "status") {
  console.log(JSON.stringify(await fetch(`${baseUrl}/api/device/config`, { headers }).then((r) => r.json()), null, 2));
} else if (command === "press") {
  if (!recipientKey) throw new Error("Usage: npm run simulator -- press <recipient-key>");
  const next = await fetch(`${baseUrl}/api/device/messages/next?recipientKey=${encodeURIComponent(recipientKey)}`, { headers });
  if (next.status === 204) {
    console.log(`No waiting message for ${recipientKey}. A physical press would begin recording.`);
  } else {
    const message = await next.json() as any;
    console.log(`Playing oldest message ${message.id} for ${recipientKey}.`);
    await fetch(`${baseUrl}/api/device/messages/${message.id}/played`, {
      method: "POST", headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({ idempotencyKey: randomUUID() })
    });
    console.log("Playback acknowledged.");
  }
} else if (command === "upload") {
  const fixture = process.argv[4];
  if (!recipientKey || !fixture) throw new Error("Usage: npm run simulator -- upload <recipient-key> <wav-file>");
  const fixturePath = path.resolve(process.env.INIT_CWD ?? process.cwd(), fixture);
  const form = new FormData();
  form.append("audio", new Blob([await fs.readFile(fixturePath)], { type: "audio/wav" }), "recording.wav");
  const response = await fetch(`${baseUrl}/api/device/messages/upload`, {
    method: "POST", headers: { ...headers, "x-recipient-key": recipientKey, "idempotency-key": randomUUID() }, body: form
  });
  console.log(JSON.stringify(await response.json(), null, 2));
} else {
  throw new Error("Commands: status | press <recipient-key> | upload <recipient-key> <wav-file>");
}
