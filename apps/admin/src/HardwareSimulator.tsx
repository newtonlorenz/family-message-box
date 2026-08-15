import { useEffect, useMemo, useRef, useState } from "react";
import type { ButtonAssignment, DeviceConfig } from "@family-box/contracts";

type SimulatorMode = "idle" | "recording" | "playing";
type LogKind = "input" | "device" | "server" | "warning";

interface LogEntry {
  id: string;
  at: Date;
  kind: LogKind;
  message: string;
}

interface HardwareSimulatorProps {
  config: DeviceConfig;
  adapter: string;
  deliveryMode: "sandbox-adaptive" | "voice-media" | "whatsapp-web";
  request: <T>(path: string, init?: RequestInit) => Promise<T>;
  onDataChanged: () => Promise<void>;
  onNotice: (message: string) => void;
  compact?: boolean;
  apiPrefix?: string;
}

const BUTTON_COLORS = ["red", "blue", "purple", "green", "yellow", "orange", "white", "pink"] as const;

function formatElapsed(milliseconds: number): string {
  return `${(milliseconds / 1_000).toFixed(1)}s`;
}

function createUuid(): string {
  if (typeof globalThis.crypto.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }

  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10).join("")}`;
}

async function playStoredVoiceNote(
  audioUrl: string,
  volumePercent: number,
  playbackRate: number,
  onAudio: (audio: HTMLAudioElement) => void
): Promise<void> {
  const audio = new Audio(audioUrl);
  audio.preload = "auto";
  audio.volume = Math.max(0, Math.min(1, volumePercent / 100));
  audio.playbackRate = playbackRate;
  onAudio(audio);
  await new Promise<void>((resolve, reject) => {
    audio.addEventListener("ended", () => resolve(), { once: true });
    audio.addEventListener("error", () => reject(new Error("The stored voice note could not be played.")), { once: true });
    void audio.play().catch(reject);
  });
}

export function HardwareSimulator({
  config,
  adapter,
  deliveryMode,
  request,
  onDataChanged,
  onNotice,
  compact = false,
  apiPrefix = "/api/admin/simulator"
}: HardwareSimulatorProps) {
  const [powered, setPowered] = useState(true);
  const [connected, setConnected] = useState(true);
  const [speed, setSpeed] = useState<1 | 10>(1);
  const [mode, setMode] = useState<SimulatorMode>("idle");
  const [activeSlot, setActiveSlot] = useState<number | null>(null);
  const [recordingStartedAt, setRecordingStartedAt] = useState<number | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [finishing, setFinishing] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([
    { id: createUuid(), at: new Date(), kind: "device", message: "Simulator booted · GPIO inputs ready" }
  ]);
  const finishingRef = useRef(false);
  const playbackOperationRef = useRef(0);
  const connectedRef = useRef(connected);
  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);

  const assignedButtons = useMemo(
    () => config.buttons.filter((button) => button.recipientKey && button.status !== "unassigned"),
    [config.buttons]
  );
  const minimumMs = config.settings.minDurationSeconds * 1_000;
  const maximumMs = config.settings.maxDurationSeconds * 1_000;
  const twilioActive = adapter === "twilio-whatsapp";
  const whatsappWebActive = adapter === "whatsapp-web";
  const liveWhatsApp = twilioActive || whatsappWebActive;

  function log(kind: LogKind, message: string) {
    setLogs((current) => [
      { id: createUuid(), at: new Date(), kind, message },
      ...current
    ].slice(0, 24));
  }

  function clearActiveState() {
    setMode("idle");
    setActiveSlot(null);
    setRecordingStartedAt(null);
    setElapsedMs(0);
    setFinishing(false);
    finishingRef.current = false;
  }

  useEffect(() => () => {
    playbackOperationRef.current++;
    audioElementRef.current?.pause();
    const recorder = mediaRecorderRef.current;
    if (recorder?.state === "recording") recorder.stop();
    microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  async function finishRecording(button: ButtonAssignment, durationMs: number, automatic = false) {
    if (!button.recipientKey || finishingRef.current) return;
    finishingRef.current = true;
    setFinishing(true);
    const boundedDuration = Math.round(Math.min(Math.max(durationMs, minimumMs), maximumMs));
    log("device", `${automatic ? "Auto-stop" : "Mic stopped"} · ${formatElapsed(boundedDuration)} captured`);
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== "recording") {
      log("warning", "Microphone recorder was not active");
      clearActiveState();
      return;
    }
    let recording: Blob;
    try {
      recording = await new Promise<Blob>((resolve, reject) => {
        recorder.addEventListener("stop", () => {
          resolve(new Blob(audioChunksRef.current, { type: recorder.mimeType || "audio/webm" }));
        }, { once: true });
        recorder.addEventListener("error", () => reject(new Error("The browser could not finish the microphone recording.")), { once: true });
        recorder.stop();
      });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "The microphone recording could not be completed.";
      log("warning", message);
      onNotice(message);
      clearActiveState();
      return;
    } finally {
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
    }

    if (!connectedRef.current) {
      log("warning", `Upload skipped · network unavailable for ${button.recipientName}`);
      onNotice("The simulator discarded the recording because its network is offline.");
      clearActiveState();
      return;
    }

    try {
      const form = new FormData();
      const extension = recording.type.includes("mp4") ? "m4a" : recording.type.includes("ogg") ? "ogg" : "webm";
      form.append("audio", recording, `microphone-recording.${extension}`);
      const result = await request<{
        messageId: string;
        deliveryState: string;
        error: string | null;
        transportMode: "template" | "voice-media" | "audio-attachment" | null;
      }>(`${apiPrefix}/recording/audio`, {
        method: "POST",
        headers: {
          "x-device-id": config.deviceId,
          "x-recipient-key": button.recipientKey,
          "idempotency-key": createUuid()
        },
        body: form
      });
      if (result.deliveryState === "confirmation_unknown") {
        const detail = result.error ?? "WhatsApp did not return a final confirmation.";
        log("warning", `WhatsApp confirmation unknown · ${detail}`);
        onNotice(
          `WhatsApp confirmation is unknown for ${button.recipientName}. It will not be retried automatically.`,
        );
      } else if (result.deliveryState === "failed") {
        const error = result.error ?? "WhatsApp did not accept the voice message.";
        log("warning", `WhatsApp delivery failed · ${error}`);
        onNotice(`WhatsApp delivery failed: ${error}`);
      } else {
        log("server", `Upload accepted · ${result.deliveryState} · ${button.recipientName}`);
        if (result.transportMode === "template") {
          onNotice(`Twilio Sandbox template sent to ${button.recipientName}. Ask them to reply, then the next recording will include its audio.`);
        } else if (result.transportMode === "audio-attachment") {
          onNotice(`Your ${formatElapsed(boundedDuration)} recording was sent to ${button.recipientName} as a playable MP3 attachment.`);
        } else {
          onNotice(`Your ${formatElapsed(boundedDuration)} voice message was sent to ${button.recipientName}.`);
        }
      }
      await onDataChanged();
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Recording upload failed";
      log("warning", message);
      onNotice(message);
    } finally {
      clearActiveState();
    }
  }

  useEffect(() => {
    if (mode !== "recording" || recordingStartedAt === null || activeSlot === null) return;
    const timer = window.setInterval(() => {
      const actualElapsed = performance.now() - recordingStartedAt;
      setElapsedMs(actualElapsed);
      if (actualElapsed >= maximumMs) {
        const button = config.buttons.find((candidate) => candidate.slot === activeSlot);
        if (button) void finishRecording(button, maximumMs, true);
      }
    }, 80);
    return () => window.clearInterval(timer);
  }, [activeSlot, maximumMs, mode, recordingStartedAt]);

  async function press(button: ButtonAssignment) {
    log("input", `Button ${button.slot} edge · ${button.recipientName ?? "unassigned"}`);
    if (!powered) {
      log("warning", "Ignored · device power is off");
      return;
    }
    if (!button.recipientKey || button.status === "unassigned") {
      log("warning", `Button ${button.slot} needs a contact`);
      onNotice(`Add a WhatsApp number to button ${button.slot} before testing it.`);
      return;
    }
    if (mode === "playing" || (activeSlot !== null && activeSlot !== button.slot)) {
      log("warning", "Ignored · audio hardware is busy");
      return;
    }

    if (button.waitingCount > 0 && mode === "idle") {
      if (!connected) {
        log("warning", "Playback unavailable · network disconnected");
        return;
      }
      setMode("playing");
      setActiveSlot(button.slot);
      log("device", `Speaker loading · ${button.waitingCount} queued voice note${button.waitingCount === 1 ? "" : "s"} from ${button.recipientName}`);
      onNotice(`Playing ${button.waitingCount === 1 ? "the voice message" : `${button.waitingCount} voice messages`} from ${button.recipientName}…`);
      const playbackOperation = ++playbackOperationRef.current;
      try {
        for (let index = 0; index < button.waitingCount; index++) {
          const message = index === 0 && button.nextMessageId
            ? { id: button.nextMessageId }
            : await request<{ id: string }>(
                `${apiPrefix}/messages/next?deviceId=${encodeURIComponent(config.deviceId)}&recipientKey=${encodeURIComponent(button.recipientKey)}`
              );
          log("device", `Voice note ${index + 1}/${button.waitingCount} playing · ${button.recipientName}`);
          await playStoredVoiceNote(
            `${apiPrefix}/messages/${encodeURIComponent(message.id)}/audio`,
            config.settings.volume,
            Math.min(speed, 4),
            (audio) => {
              audioElementRef.current = audio;
            }
          );
          audioElementRef.current = null;
          if (playbackOperationRef.current !== playbackOperation) return;
          await request(`${apiPrefix}/messages/${encodeURIComponent(message.id)}/played`, {
            method: "POST",
            body: JSON.stringify({
              deviceId: config.deviceId,
              idempotencyKey: createUuid()
            })
          });
          log("server", `Playback ${index + 1}/${button.waitingCount} acknowledged · ${button.recipientName}`);
        }
        onNotice(`Finished playing ${button.waitingCount === 1 ? "the message" : `all ${button.waitingCount} messages`} from ${button.recipientName}.`);
        clearActiveState();
        await onDataChanged();
      } catch (reason) {
        audioElementRef.current?.pause();
        audioElementRef.current = null;
        const message = reason instanceof Error ? reason.message : "Playback failed";
        log("warning", message);
        onNotice(`Playback failed: ${message}. The message is still waiting.`);
        clearActiveState();
        await onDataChanged();
      }
      return;
    }

    if (mode === "recording" && recordingStartedAt !== null) {
      await stopActiveRecording(button);
      return;
    }

    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("This browser does not support microphone recording.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      const preferredMime = [
        "audio/webm;codecs=opus",
        "audio/ogg;codecs=opus",
        "audio/mp4"
      ].find((mime) => MediaRecorder.isTypeSupported(mime));
      const recorder = new MediaRecorder(stream, preferredMime ? { mimeType: preferredMime } : undefined);
      audioChunksRef.current = [];
      recorder.addEventListener("dataavailable", (event) => {
        if (event.data.size > 0) audioChunksRef.current.push(event.data);
      });
      recorder.start(250);
      microphoneStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      setMode("recording");
      setActiveSlot(button.slot);
      setRecordingStartedAt(performance.now());
      setElapsedMs(0);
      log("device", `Microphone capture started · ${button.recipientName}`);
      onNotice(`Recording from this ${compact ? "phone" : "Mac"}’s microphone. Press the same button again to send.`);
    } catch (reason) {
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      mediaRecorderRef.current = null;
      const message = reason instanceof DOMException && reason.name === "NotAllowedError"
        ? "Microphone access was denied. Allow it for this page, then press the button again."
        : reason instanceof Error ? reason.message : "The microphone could not be opened.";
      log("warning", message);
      onNotice(message);
    }
  }

  async function stopActiveRecording(button?: ButtonAssignment) {
    if (mode !== "recording" || recordingStartedAt === null || finishingRef.current) return;
    const target = button ?? config.buttons.find((candidate) => candidate.slot === activeSlot);
    if (!target) return;
    const actualElapsed = performance.now() - recordingStartedAt;
    if (actualElapsed < minimumMs) {
      const remaining = minimumMs - actualElapsed;
      log("warning", `Too short · keep recording for ${formatElapsed(remaining)}`);
      onNotice(`Keep recording for ${formatElapsed(remaining)}, then tap Stop & send.`);
      return;
    }
    await finishRecording(target, actualElapsed);
  }

  async function addIncoming(button: ButtonAssignment, count = 1) {
    if (!button.recipientKey) return;
    if (!connected) {
      log("warning", "Incoming event blocked · network disconnected");
      return;
    }
    for (let index = 0; index < count; index++) {
      await request("/api/admin/mock/incoming", {
        method: "POST",
        body: JSON.stringify({
          deviceId: config.deviceId,
          recipientKey: button.recipientKey,
          durationMs: 4_000
        })
      });
    }
    log("server", `${count} incoming message${count === 1 ? "" : "s"} queued · ${button.recipientName}`);
    await onDataChanged();
  }

  function togglePower() {
    const next = !powered;
    setPowered(next);
    if (!next) {
      playbackOperationRef.current++;
      audioElementRef.current?.pause();
      audioElementRef.current = null;
      const recorder = mediaRecorderRef.current;
      if (recorder?.state === "recording") recorder.stop();
      microphoneStreamRef.current?.getTracks().forEach((track) => track.stop());
      microphoneStreamRef.current = null;
      mediaRecorderRef.current = null;
      audioChunksRef.current = [];
      clearActiveState();
    }
    log("device", next ? "USB-C power restored · boot complete" : "USB-C power removed");
  }

  const activeButton = config.buttons.find((button) => button.slot === activeSlot);

  return (
    <section className={`hardware-simulator ${compact ? "compact" : ""}`} aria-labelledby="hardware-simulator-heading">
      {!compact && <div className="simulator-heading">
        <div>
          <p className="eyebrow">Digital bench unit</p>
          <h2 id="hardware-simulator-heading">Hardware simulator</h2>
          <p>
            Exercise the physical button flow against {whatsappWebActive ? "the linked project phone" : twilioActive ? "Twilio WhatsApp" : "the local mock server"}.
          </p>
        </div>
        <div className={`bench-status ${powered && connected ? "ready" : ""}`}>
          <span aria-hidden="true" />
          {powered ? (connected ? "Ready to test" : "Network offline") : "Power off"}
        </div>
      </div>}

      <div className="simulator-layout">
        <div className={`device-stage ${powered ? "" : "powered-off"}`}>
          <div className="wood-box" aria-label="Eight-button wooden Family Message Box simulator">
            <div className="box-brand">
              <strong>Family Message Box</strong>
            </div>
            <div className="hardware-grid">
              {config.buttons.map((button, index) => {
                const isActive = activeSlot === button.slot;
                const buttonMode = isActive ? mode : button.waitingCount > 0 ? "waiting" : "idle";
                return (
                  <div className={`hardware-control ${buttonMode}`} key={button.slot}>
                    <button
                      type="button"
                      className={`arcade-button ${BUTTON_COLORS[index]}`}
                      onClick={() => void press(button)}
                      disabled={!powered}
                      aria-label={`Press button ${button.slot}, ${button.recipientName ?? "unassigned"}`}
                    >
                      <span className="lamp-lens" />
                    </button>
                    <div className="person-token" aria-hidden="true">
                      {button.recipientName?.slice(0, 1).toUpperCase() ?? button.slot}
                    </div>
                    <strong>{button.recipientName ?? `Button ${button.slot}`}</strong>
                    <small>
                      {buttonMode === "recording" ? "Recording" :
                        buttonMode === "playing" ? "Playing" :
                        button.waitingCount ? `${button.waitingCount} waiting · lamp flashing` :
                        button.status !== "unassigned" ? "Ready" : button.recipientName ? "Needs number" : "Unassigned"}
                    </small>
                  </div>
                );
              })}
            </div>
            <div className="hardware-io">
              <div className={`microphone ${mode === "recording" ? "active" : ""}`}>
                <i aria-hidden="true" />
                <span>MIC</span>
              </div>
              <div className={`speaker ${mode === "playing" ? "active" : ""}`} aria-label={mode === "playing" ? "Speaker playing mock audio" : "Speaker output"}>
                {Array.from({ length: 18 }, (_, index) => <i key={index} />)}
              </div>
            </div>
            <span className="screw top-left" /><span className="screw top-right" />
            <span className="screw bottom-left" /><span className="screw bottom-right" />
          </div>
          {!compact && <div className="device-readout" aria-live="polite">
            <div>
              <span>STATE</span>
              <strong>{mode === "idle" ? "STANDBY" : mode.toUpperCase()}</strong>
            </div>
            <div>
              <span>CHANNEL</span>
              <strong>{activeButton?.recipientName?.toUpperCase() ?? "—"}</strong>
            </div>
            <div>
              <span>TIME</span>
              <strong>{mode === "recording" ? formatElapsed(elapsedMs) : "—"}</strong>
            </div>
          </div>}
        </div>

        {compact && mode === "recording" && (
          <div className="compact-recording-action" role="status" aria-live="polite">
            <div>
              <span><i aria-hidden="true" /> Recording</span>
              <strong>{formatElapsed(elapsedMs)}</strong>
            </div>
            <button
              type="button"
              onClick={() => void stopActiveRecording()}
              disabled={finishing}
            >
              {finishing
                ? "Sending…"
                : elapsedMs < minimumMs
                  ? `Keep recording · ${formatElapsed(minimumMs - elapsedMs)}`
                  : "Stop & send"}
            </button>
          </div>
        )}

        {!compact && <aside className="bench-panel" aria-label="Simulator controls and event log">
          <section>
            <div className="panel-title"><span>Bench controls</span><small>ESP32-S3</small></div>
            <div className="toggle-row">
              <span><strong>USB-C power</strong><small>5V supply</small></span>
              <button className={`switch ${powered ? "on" : ""}`} onClick={togglePower} role="switch" aria-checked={powered}><span /></button>
            </div>
            <div className="toggle-row">
              <span><strong>Wi-Fi</strong><small>LAN connection</small></span>
              <button className={`switch ${connected ? "on" : ""}`} onClick={() => {
                const next = !connected;
                setConnected(next);
                if (!next && mode === "playing") {
                  playbackOperationRef.current++;
                  audioElementRef.current?.pause();
                  audioElementRef.current = null;
                  clearActiveState();
                }
                log("device", next ? "Wi-Fi connected" : "Wi-Fi disconnected");
              }} role="switch" aria-checked={connected} disabled={!powered}><span /></button>
            </div>
            <label className="speed-control">
              Test timing
              <select value={speed} onChange={(event) => setSpeed(Number(event.target.value) as 1 | 10)}>
                <option value={1}>Real time · 1×</option>
                <option value={10}>Accelerated · 10×</option>
              </select>
            </label>
            {liveWhatsApp && (
              <p className="transport-note">
                {whatsappWebActive
                  ? "An idle-button recording sends a live WhatsApp voice note through the linked project phone."
                  : deliveryMode === "sandbox-adaptive"
                  ? "Before the recipient replies, the Sandbox sends its approved template. A reply opens the 24-hour window so later recordings include their audio."
                  : "An idle-button recording sends a live WhatsApp voice note to that assigned number."}
              </p>
            )}
          </section>

          <section>
            <div className="panel-title">
              <span>{liveWhatsApp ? "Incoming test" : "Inject test event"}</span>
              <small>{whatsappWebActive ? "Linked phone" : twilioActive ? "Twilio WhatsApp" : "Mock adapter"}</small>
            </div>
            {liveWhatsApp ? (
              <p className="panel-empty">
                {whatsappWebActive
                  ? "Send a WhatsApp voice note to the project phone from an assigned contact. Its matching button will flash when the note arrives."
                  : "Send a WhatsApp voice note to the configured Twilio sender. Its matching button will flash when the signed webhook arrives."}
              </p>
            ) : assignedButtons.length === 0 ? <p className="panel-empty">Assign a person to a button first.</p> :
              <div className="scenario-list">
                {assignedButtons.map((button) => (
                  <div key={button.slot}>
                    <span><i className={`color-chip ${BUTTON_COLORS[button.slot - 1]}`} />{button.recipientName}</span>
                    <button onClick={() => void addIncoming(button)}>+ Message</button>
                    <button title="Queue two messages" onClick={() => void addIncoming(button, 2)}>+2</button>
                  </div>
                ))}
              </div>}
          </section>

          <section className="event-panel">
            <div className="panel-title"><span>Event trace</span><button onClick={() => setLogs([])}>Clear</button></div>
            <ol className="event-log">
              {logs.length === 0 ? <li className="panel-empty">No events yet.</li> : logs.map((entry) => (
                <li key={entry.id} className={entry.kind}>
                  <time>{entry.at.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>
                  <span>{entry.message}</span>
                </li>
              ))}
            </ol>
          </section>
        </aside>}
      </div>
    </section>
  );
}
