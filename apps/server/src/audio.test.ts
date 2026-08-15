import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  canonicalizeWhatsAppOgg,
  createDevicePlaybackPcm,
  createWhatsAppVoiceNote,
  parseFfmpegDurationMs
} from "./audio.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("FFmpeg duration parsing", () => {
  it("reads a normal container duration header", () => {
    expect(parseFfmpegDurationMs("Duration: 00:00:05.32, start: 0.000000, bitrate: 24 kb/s"))
      .toBe(5_320);
  });

  it("uses the decoded timeline for streaming browser WebM without a header duration", () => {
    const output = [
      "Duration: N/A, start: -0.007000, bitrate: N/A",
      "size=N/A time=00:00:01.28 bitrate=N/A speed=2.5x",
      "size=N/A time=00:00:05.31 bitrate=N/A speed=4.9x"
    ].join("\n");
    expect(parseFfmpegDurationMs(output)).toBe(5_310);
  });

  it("fails closed when FFmpeg reports no measurable audio timeline", () => {
    expect(parseFfmpegDurationMs("Duration: N/A\nOutput file is empty")).toBeNull();
  });
});

describe("WhatsApp voice-note preparation", () => {
  function oggPage(body: Buffer, serial: number, sequence: number, headerType = 0): Buffer {
    const header = Buffer.alloc(28);
    header.write("OggS", 0, "ascii");
    header[4] = 0;
    header[5] = headerType;
    header.writeUInt32LE(serial, 14);
    header.writeUInt32LE(sequence, 18);
    header[26] = 1;
    header[27] = body.length;
    return Buffer.concat([header, body]);
  }

  function fixtureOgg(): Buffer {
    const opusHead = Buffer.concat([Buffer.from("OpusHead", "ascii"), Buffer.alloc(11)]);
    const vendor = Buffer.from("Lavf fixture", "ascii");
    const comment = Buffer.from("encoder=fixture", "ascii");
    const tagsHeader = Buffer.alloc(8);
    tagsHeader.writeUInt32LE(vendor.length, 0);
    tagsHeader.writeUInt32LE(1, 4);
    const commentLength = Buffer.alloc(4);
    commentLength.writeUInt32LE(comment.length, 0);
    const opusTags = Buffer.concat([
      Buffer.from("OpusTags", "ascii"),
      tagsHeader.subarray(0, 4),
      vendor,
      tagsHeader.subarray(4),
      commentLength,
      comment
    ]);
    return Buffer.concat([
      oggPage(opusHead, 42, 0, 2),
      oggPage(opusTags, 42, 1),
      oggPage(Buffer.from([0xf8, 0xff, 0xfe]), 42, 2, 4)
    ]);
  }

  it("rewrites FFmpeg Ogg metadata to WhatsApp's native OpusTags container", () => {
    const canonical = canonicalizeWhatsAppOgg(fixtureOgg());
    expect(canonical.includes(Buffer.from("OpusTags\u0008\u0000\u0000\u0000WhatsApp\u0000\u0000\u0000\u0000", "binary"))).toBe(true);
    expect(canonical.includes(Buffer.from("Lavf fixture"))).toBe(false);
    expect(canonical.includes(Buffer.from("encoder=fixture"))).toBe(false);
    expect(canonical.readUInt32LE(14)).toBe(100);
    expect(canonicalizeWhatsAppOgg(canonical)).toEqual(canonical);
  });

  it("transcodes outbound audio before applying WhatsApp's native container", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "whatsapp-voice-note-"));
    tempDirs.push(directory);
    const inputPath = path.join(directory, "message.ogg");
    const ffmpegPath = path.join(directory, "fake-ffmpeg.mjs");
    const fixture = fixtureOgg();
    await fs.writeFile(inputPath, "source audio");
    await fs.writeFile(ffmpegPath, [
      "#!/usr/bin/env node",
      `process.stdout.write(Buffer.from(${JSON.stringify(fixture.toString("base64"))}, "base64"));`
    ].join("\n"));
    await fs.chmod(ffmpegPath, 0o755);

    const result = await createWhatsAppVoiceNote(inputPath, "message-1", 10_000, ffmpegPath);
    expect(result).toMatchObject({
      mime: "audio/ogg; codecs=opus",
      filename: "family-message-box-message-1.ogg"
    });
    expect(result.data.includes(Buffer.from("WhatsApp"))).toBe(true);
    expect(result.data.includes(Buffer.from("Lavf fixture"))).toBe(false);
  });

  it("rejects a transcoder result that is not an Ogg container", () => {
    expect(() => canonicalizeWhatsAppOgg(Buffer.from("not ogg audio")))
      .toThrow("did not produce an Ogg container");
  });
});

describe("device playback preparation", () => {
  it("produces bounded 16 kHz mono signed PCM for the ESP32", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "device-playback-"));
    tempDirs.push(directory);
    const inputPath = path.join(directory, "message.ogg");
    const ffmpegPath = path.join(directory, "fake-ffmpeg.mjs");
    const samples = Buffer.from([0x01, 0x00, 0xff, 0x7f]);
    await fs.writeFile(inputPath, "source audio");
    await fs.writeFile(ffmpegPath, [
      "#!/usr/bin/env node",
      `process.stdout.write(Buffer.from(${JSON.stringify(samples.toString("base64"))}, "base64"));`
    ].join("\n"));
    await fs.chmod(ffmpegPath, 0o755);

    const result = await createDevicePlaybackPcm(inputPath, ffmpegPath, 30);
    expect(result).toEqual({
      data: samples,
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16
    });
  });

  it("rejects empty PCM output", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "device-playback-empty-"));
    tempDirs.push(directory);
    const inputPath = path.join(directory, "message.ogg");
    const ffmpegPath = path.join(directory, "fake-ffmpeg.mjs");
    await fs.writeFile(inputPath, "source audio");
    await fs.writeFile(ffmpegPath, "#!/usr/bin/env node\n");
    await fs.chmod(ffmpegPath, 0o755);

    await expect(createDevicePlaybackPcm(inputPath, ffmpegPath, 30))
      .rejects.toThrow("invalid 16-bit PCM");
  });
});
