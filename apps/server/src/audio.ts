import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { nanoid } from "nanoid";

const WAV_MIME = new Set(["audio/wav", "audio/x-wav", "audio/wave"]);
const RAW_PCM_MIME = new Set(["audio/l16", "application/octet-stream"]);
const ENCODED_AUDIO_MIME = new Set([
  "audio/ogg", "audio/opus", "audio/webm", "audio/mpeg", "audio/mp4", "audio/amr", "audio/3gpp"
]);

export class AudioValidationError extends Error {
  constructor(message: string, public readonly statusCode = 422) {
    super(message);
  }
}

export interface AudioResult {
  audioPath: string;
  durationMs: number;
  mime: "audio/ogg";
}

export interface WhatsAppVoiceNote {
  data: Buffer;
  mime: "audio/ogg; codecs=opus";
  filename: string;
}

interface ConvertOptions {
  input: Buffer;
  mime: string;
  audioDir: string;
  ffmpegPath: string;
  maxBytes: number;
  minDurationSeconds: number;
  maxDurationSeconds: number;
  pcmSampleRate?: number;
  pcmChannels?: number;
  fixtureDurationMs?: number;
}

function run(command: string, args: string[]): Promise<{ stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk).slice(0, 8_000);
    });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve({ stderr }) : reject(new Error(stderr || `${command} exited ${code}`)));
  });
}

function runWithOutput(
  command: string,
  args: string[],
  maxOutputBytes: number,
  outputLabel = "Audio output"
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let stderr = "";
    let exceededLimit = false;
    let settled = false;

    child.stdout.on("data", (chunk: Buffer) => {
      if (exceededLimit) return;
      size += chunk.length;
      if (size > maxOutputBytes) {
        exceededLimit = true;
        child.kill("SIGKILL");
        return;
      }
      chunks.push(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk).slice(0, 8_000);
    });
    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      if (exceededLimit) {
        reject(new AudioValidationError(`${outputLabel} exceeds the ${maxOutputBytes} byte limit.`, 413));
      } else if (code === 0) {
        resolve(Buffer.concat(chunks, size));
      } else {
        reject(new Error(stderr || `${command} exited ${code}`));
      }
    });
  });
}

export interface DevicePlaybackPcm {
  data: Buffer;
  sampleRate: 16_000;
  channels: 1;
  bitsPerSample: 16;
}

/**
 * Browsers and messaging adapters use Ogg/Opus, while the ESP32 receives
 * bounded signed 16-bit little-endian PCM. This keeps decoding off the device.
 */
export async function createDevicePlaybackPcm(
  inputPath: string,
  ffmpegPath: string,
  maximumDurationSeconds: number
): Promise<DevicePlaybackPcm> {
  await fs.access(inputPath);
  const maximumBytes = Math.ceil(maximumDurationSeconds * 16_000 * 2) + 4_096;
  let data: Buffer;
  try {
    data = await runWithOutput(ffmpegPath, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-i", inputPath,
      "-map_metadata", "-1", "-vn", "-acodec", "pcm_s16le",
      "-ar", "16000", "-ac", "1", "-f", "s16le", "pipe:1"
    ], maximumBytes, "Device playback audio");
  } catch (error) {
    if (error instanceof AudioValidationError) throw error;
    const message = error instanceof Error && "code" in error && error.code === "ENOENT"
      ? "FFmpeg is unavailable."
      : error instanceof Error ? error.message : "unknown error";
    throw new AudioValidationError(`Device playback conversion failed: ${message}`);
  }
  if (data.length === 0 || data.length % 2 !== 0) {
    throw new AudioValidationError("Device playback conversion produced invalid 16-bit PCM.");
  }
  return { data, sampleRate: 16_000, channels: 1, bitsPerSample: 16 };
}

function createOggCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let index = 0; index < table.length; index++) {
    let value = index << 24;
    for (let bit = 0; bit < 8; bit++) {
      value = (value & 0x80000000) !== 0
        ? ((value << 1) ^ 0x04c11db7) >>> 0
        : (value << 1) >>> 0;
    }
    table[index] = value;
  }
  return table;
}

const OGG_CRC_TABLE = createOggCrcTable();
const WHATSAPP_OPUS_TAGS = Buffer.concat([
  Buffer.from("OpusTags", "ascii"),
  Buffer.from([8, 0, 0, 0]),
  Buffer.from("WhatsApp", "ascii"),
  Buffer.from([0, 0, 0, 0])
]);

function oggCrc(page: Buffer): number {
  let crc = 0;
  for (const byte of page) {
    crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  }
  return crc;
}

function withOggChecksum(page: Buffer): Buffer {
  const result = Buffer.from(page);
  result.fill(0, 22, 26);
  result.writeUInt32LE(oggCrc(result), 22);
  return result;
}

/**
 * WhatsApp's mobile clients are stricter than WhatsApp Web about push-to-talk
 * containers. Match the native recorder's minimal OpusTags page and stream
 * serial instead of forwarding FFmpeg's vendor and encoder comments.
 */
export function canonicalizeWhatsAppOgg(input: Buffer): Buffer {
  const pages: Buffer[] = [];
  let offset = 0;
  let foundHead = false;
  let foundTags = false;

  while (offset < input.length) {
    if (offset + 27 > input.length || input.subarray(offset, offset + 4).toString("ascii") !== "OggS") {
      throw new AudioValidationError("WhatsApp voice-note conversion did not produce an Ogg container.");
    }
    const segmentCount = input[offset + 26]!;
    const segmentTableEnd = offset + 27 + segmentCount;
    if (segmentTableEnd > input.length) {
      throw new AudioValidationError("The WhatsApp Ogg segment table is truncated.");
    }
    let bodyLength = 0;
    for (let index = offset + 27; index < segmentTableEnd; index++) {
      bodyLength += input[index]!;
    }
    const pageEnd = segmentTableEnd + bodyLength;
    if (pageEnd > input.length) {
      throw new AudioValidationError("The WhatsApp Ogg page is truncated.");
    }

    const body = input.subarray(segmentTableEnd, pageEnd);
    let page: Buffer;
    if (body.subarray(0, 8).toString("ascii") === "OpusTags") {
      if (segmentCount !== 1) {
        throw new AudioValidationError("The WhatsApp OpusTags packet spans multiple Ogg segments.");
      }
      const header = Buffer.from(input.subarray(offset, offset + 27));
      header[26] = 1;
      page = Buffer.concat([header, Buffer.from([WHATSAPP_OPUS_TAGS.length]), WHATSAPP_OPUS_TAGS]);
      foundTags = true;
    } else {
      page = Buffer.from(input.subarray(offset, pageEnd));
    }
    if (body.subarray(0, 8).toString("ascii") === "OpusHead") foundHead = true;

    // Native WhatsApp voice notes use stream serial 100.
    page.writeUInt32LE(100, 14);
    pages.push(withOggChecksum(page));
    offset = pageEnd;
  }

  if (!foundHead || !foundTags) {
    throw new AudioValidationError("WhatsApp voice notes require OpusHead and OpusTags packets.");
  }
  return Buffer.concat(pages);
}

async function durationMs(ffmpegPath: string, inputPath: string): Promise<number> {
  const { stderr } = await run(ffmpegPath, ["-hide_banner", "-i", inputPath, "-f", "null", "-"]);
  const measured = parseFfmpegDurationMs(stderr);
  if (measured === null) throw new AudioValidationError("The audio duration could not be read.");
  return measured;
}

function timestampMs(hours: string, minutes: string, seconds: string): number {
  return Math.round((Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)) * 1000);
}

export function parseFfmpegDurationMs(stderr: string): number | null {
  const header = /Duration:\s+(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(stderr);
  if (header) return timestampMs(header[1]!, header[2]!, header[3]!);

  // MediaRecorder's streaming WebM often has `Duration: N/A`. FFmpeg still
  // decodes the complete stream and reports the last processed timestamp.
  const timeline = [...stderr.matchAll(/time=\s*(\d+):(\d+):(\d+(?:\.\d+)?)/g)];
  const last = timeline.at(-1);
  return last ? timestampMs(last[1]!, last[2]!, last[3]!) : null;
}

export async function convertToOpus(options: ConvertOptions): Promise<AudioResult> {
  const mime = options.mime.toLowerCase().split(";", 1)[0]!.trim();
  if (!WAV_MIME.has(mime) && !RAW_PCM_MIME.has(mime) && !ENCODED_AUDIO_MIME.has(mime)) {
    throw new AudioValidationError(`Unsupported audio type: ${options.mime}`, 415);
  }
  if (options.input.length === 0) throw new AudioValidationError("The audio file is empty.");
  if (options.input.length > options.maxBytes) throw new AudioValidationError(`Audio exceeds the ${options.maxBytes} byte limit.`, 413);
  const isWav = options.input.length >= 12
    && options.input.subarray(0, 4).toString("ascii") === "RIFF"
    && options.input.subarray(8, 12).toString("ascii") === "WAVE";
  if (WAV_MIME.has(mime) && !isWav) {
    throw new AudioValidationError("The upload is labelled as WAV but has no RIFF/WAVE header.");
  }
  const rawPcm = RAW_PCM_MIME.has(mime) && !isWav;
  if (rawPcm) {
    if (!options.pcmSampleRate || options.pcmSampleRate < 8_000 || options.pcmSampleRate > 48_000) {
      throw new AudioValidationError("Raw PCM requires X-Audio-Sample-Rate between 8000 and 48000.");
    }
    if (!options.pcmChannels || ![1, 2].includes(options.pcmChannels)) {
      throw new AudioValidationError("Raw PCM requires X-Audio-Channels set to 1 or 2.");
    }
    if (options.input.length % (2 * options.pcmChannels) !== 0) {
      throw new AudioValidationError("Raw 16-bit PCM byte length is not aligned to its channel count.");
    }
  }

  await fs.mkdir(options.audioDir, { recursive: true });
  const id = nanoid();
  const inputPath = path.resolve(options.audioDir, `${id}.upload`);
  const outputPath = path.resolve(options.audioDir, `${id}.ogg`);
  await fs.writeFile(inputPath, options.input, { flag: "wx" });
  try {
    if (options.fixtureDurationMs !== undefined) {
      if (process.env.NODE_ENV !== "test") throw new Error("Fixture conversion is only available in tests.");
      await fs.writeFile(outputPath, Buffer.from("OggS mock opus fixture"));
      validateDuration(options.fixtureDurationMs, options.minDurationSeconds, options.maxDurationSeconds);
      return { audioPath: outputPath, durationMs: options.fixtureDurationMs, mime: "audio/ogg" };
    }
    const inputArgs = rawPcm
      ? ["-f", mime === "audio/l16" ? "s16be" : "s16le", "-ar", String(options.pcmSampleRate), "-ac", String(options.pcmChannels)]
      : [];
    const measured = rawPcm
      ? Math.round(options.input.length / (options.pcmSampleRate! * options.pcmChannels! * 2) * 1000)
      : await durationMs(options.ffmpegPath, inputPath);
    validateDuration(measured, options.minDurationSeconds, options.maxDurationSeconds);
    await run(options.ffmpegPath, [
      "-nostdin", "-y", ...inputArgs, "-i", inputPath, "-vn", "-c:a", "libopus", "-b:a", "24k",
      "-application", "voip", "-f", "ogg", outputPath
    ]);
    return { audioPath: outputPath, durationMs: measured, mime: "audio/ogg" };
  } catch (error) {
    await fs.rm(outputPath, { force: true });
    if (error instanceof AudioValidationError) throw error;
    const message = error instanceof Error && "code" in error && error.code === "ENOENT"
      ? "FFmpeg is unavailable. Install it or use the test fixture converter in CI."
      : `Audio conversion failed: ${error instanceof Error ? error.message : "unknown error"}`;
    throw new AudioValidationError(message);
  } finally {
    await fs.rm(inputPath, { force: true });
  }
}

export async function createWhatsAppVoiceNote(
  inputPath: string,
  messageId: string,
  maxBytes: number,
  ffmpegPath: string
): Promise<WhatsAppVoiceNote> {
  await fs.access(inputPath);
  let encoded: Buffer;
  try {
    encoded = await runWithOutput(ffmpegPath, [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-i", inputPath,
      "-map_metadata", "-1", "-vn", "-c:a", "libopus", "-b:a", "32k",
      "-ar", "48000", "-ac", "1", "-application", "voip",
      "-frame_duration", "120", "-page_duration", "20000000",
      "-oggpagesize", "4096", "-output_ts_offset", "0.007",
      "-f", "ogg", "pipe:1"
    ], maxBytes);
  } catch (error) {
    if (error instanceof AudioValidationError) throw error;
    const message = error instanceof Error && "code" in error && error.code === "ENOENT"
      ? "FFmpeg is unavailable."
      : error instanceof Error ? error.message : "unknown error";
    throw new AudioValidationError(`WhatsApp voice-note conversion failed: ${message}`);
  }
  const data = canonicalizeWhatsAppOgg(encoded);
  if (data.length > maxBytes) {
    throw new AudioValidationError(`WhatsApp audio exceeds the ${maxBytes} byte limit.`, 413);
  }
  return {
    data,
    mime: "audio/ogg; codecs=opus",
    filename: `family-message-box-${messageId}.ogg`
  };
}

export function validateDuration(durationMs: number, minimumSeconds: number, maximumSeconds: number): void {
  if (durationMs < minimumSeconds * 1000) throw new AudioValidationError(`Record for at least ${minimumSeconds} seconds.`);
  if (durationMs > maximumSeconds * 1000) throw new AudioValidationError(`Recording exceeds the ${maximumSeconds} second limit.`);
}
