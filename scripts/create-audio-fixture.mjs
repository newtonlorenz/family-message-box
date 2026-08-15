import fs from "node:fs";
import path from "node:path";

const output = path.resolve(process.argv[2] ?? "work/four-seconds.wav");
const seconds = 4;
const rate = 16000;
const samples = rate * seconds;
const dataBytes = samples * 2;
const buffer = Buffer.alloc(44 + dataBytes);
buffer.write("RIFF", 0);
buffer.writeUInt32LE(36 + dataBytes, 4);
buffer.write("WAVEfmt ", 8);
buffer.writeUInt32LE(16, 16);
buffer.writeUInt16LE(1, 20);
buffer.writeUInt16LE(1, 22);
buffer.writeUInt32LE(rate, 24);
buffer.writeUInt32LE(rate * 2, 28);
buffer.writeUInt16LE(2, 32);
buffer.writeUInt16LE(16, 34);
buffer.write("data", 36);
buffer.writeUInt32LE(dataBytes, 40);
for (let index = 0; index < samples; index++) {
  const envelope = Math.min(1, index / 800, (samples - index) / 800);
  buffer.writeInt16LE(Math.round(Math.sin(2 * Math.PI * 440 * index / rate) * 3500 * envelope), 44 + index * 2);
}
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, buffer);
console.log(output);
