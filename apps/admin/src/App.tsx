import { useEffect, useMemo, useState, type FormEvent } from "react";
import type {
  ButtonAssignment,
  DeviceConfig,
  DeviceStatus,
  MessageSummary,
  FirmwareUpdateSummary,
} from "@family-box/contracts";
import { BUTTON_SLOTS } from "@family-box/contracts";
import { HardwareSimulator } from "./HardwareSimulator.tsx";
import { FirmwareUpdatePanel } from "./FirmwareUpdatePanel.tsx";

interface Dashboard {
  device: DeviceStatus;
  devices: DeviceStatus[];
  config: DeviceConfig;
  messages: MessageSummary[];
  audit: Array<{ id: string; action: string; created_at: string }>;
  adapter: string;
  deliveryMode: "sandbox-adaptive" | "voice-media" | "whatsapp-web";
  latestFirmwareUpdate: FirmwareUpdateSummary | null;
}

interface WhatsAppStatus {
  state:
    | "starting"
    | "qr"
    | "authenticated"
    | "ready"
    | "disconnected"
    | "auth_failure"
    | "stopped";
  qrDataUrl: string | null;
  lastError: string | null;
  account: string | null;
}

const api = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const isMultipart = init?.body instanceof FormData;
  const hasJsonBody = init?.body !== undefined && !isMultipart;
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(hasJsonBody ? { "content-type": "application/json" } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok)
    throw new Error(
      (await response.json()).error ?? `Request failed (${response.status})`,
    );
  return response.json() as Promise<T>;
};

function StatusDot({ active }: { active: boolean }) {
  return (
    <span
      className={`status-dot ${active ? "active" : ""}`}
      aria-hidden="true"
    />
  );
}

function AssignmentForm({
  button,
  adapter,
  deviceId,
  onSaved,
}: {
  button: ButtonAssignment;
  adapter: string;
  deviceId: string;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const whatsappActive =
    adapter === "twilio-whatsapp" || adapter === "whatsapp-web";

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      await api(
        `/api/admin/buttons/${button.slot}?deviceId=${encodeURIComponent(deviceId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            displayName: data.get("displayName"),
            recipientKey: data.get("recipientKey"),
            chatId: data.get("chatId"),
          }),
        },
      );
      setOpen(false);
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not save.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className={`button-card ${button.status}`}>
      <button
        className="button-face"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span className="slot-number">{button.slot}</span>
        <span className="avatar" aria-hidden="true">
          {button.recipientName?.slice(0, 1).toUpperCase() ?? "+"}
        </span>
        <span className="button-name">
          {button.recipientName ?? "Assign person"}
        </span>
        <span className="button-state">
          {button.waitingCount > 0
            ? `${button.waitingCount} waiting`
            : button.status === "unassigned" && button.recipientName
              ? "Needs WhatsApp number"
              : button.recipientName
                ? "Ready"
                : "Not assigned"}
        </span>
      </button>
      {open && (
        <form className="assignment-form" onSubmit={save}>
          <label>
            Name
            <input
              name="displayName"
              defaultValue={button.recipientName ?? ""}
              required
            />
          </label>
          <label>
            Recipient key
            <input
              name="recipientKey"
              defaultValue={button.recipientKey ?? ""}
              placeholder="grandma"
              pattern="[A-Za-z0-9][A-Za-z0-9_-]{1,47}"
              required
            />
          </label>
          <label>
            {whatsappActive ? "WhatsApp number" : "Mock chat ID"}
            <input
              name="chatId"
              defaultValue={button.chatId ?? ""}
              placeholder={whatsappActive ? "+34600000000" : "mock:grandma"}
              required
            />
          </label>
          {error && <p className="form-error">{error}</p>}
          <div className="form-actions">
            <button
              type="button"
              className="quiet-button"
              onClick={() => setOpen(false)}
            >
              Cancel
            </button>
            <button type="submit" disabled={saving}>
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}

export function App() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [tab, setTab] = useState<"messages" | "settings" | "simulator">(
    "messages",
  );
  const [notice, setNotice] = useState("");
  const [whatsappStatus, setWhatsAppStatus] = useState<WhatsAppStatus | null>(
    null,
  );
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | null>(null);

  const load = async (deviceId = selectedDeviceId) => {
    try {
      const dashboard = await api<Dashboard>(
        deviceId
          ? `/api/admin/dashboard?deviceId=${encodeURIComponent(deviceId)}`
          : "/api/admin/dashboard",
      );
      setData(dashboard);
      setSelectedDeviceId(dashboard.device.id);
      setError("");
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Server unavailable.",
      );
    }
  };

  useEffect(() => {
    void load(selectedDeviceId);
    const interval = setInterval(() => void load(selectedDeviceId), 5_000);
    return () => clearInterval(interval);
  }, [selectedDeviceId]);

  useEffect(() => {
    if (data?.adapter !== "whatsapp-web") {
      setWhatsAppStatus(null);
      return;
    }
    let active = true;
    const loadStatus = async () => {
      try {
        const status = await api<WhatsAppStatus>("/api/admin/whatsapp/status");
        if (active) setWhatsAppStatus(status);
      } catch {
        // The main server status handles availability errors.
      }
    };
    void loadStatus();
    const interval = window.setInterval(loadStatus, 2_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [data?.adapter]);

  const assigned = useMemo(
    () =>
      data?.config.buttons.filter(
        (button) => button.recipientKey && button.status !== "unassigned",
      ) ?? [],
    [data],
  );

  if (!data)
    return (
      <main className="loading">
        <p>{error || "Opening Family Message Box…"}</p>
      </main>
    );
  const waiting = data.config.buttons.reduce(
    (total, button) => total + button.waitingCount,
    0,
  );

  return (
    <div className="app-shell">
      <header>
        <div>
          <p className="eyebrow">Home control</p>
          <h1>Family Message Box</h1>
        </div>
        <div className="device-header-controls">
          {data.devices.length > 1 && (
            <label className="device-picker">
              Device
              <select
                value={data.device.id}
                onChange={(event) => setSelectedDeviceId(event.target.value)}
              >
                {data.devices.map((device) => (
                  <option key={device.id} value={device.id}>
                    {device.name} · {device.id}
                  </option>
                ))}
              </select>
            </label>
          )}
          <div className="device-health">
            <StatusDot active={data.device.online} />
            <span>
              {data.device.online
                ? "Device online"
                : "Device not seen recently"}
            </span>
            <small>
              {data.device.lastSeenAt
                ? new Date(data.device.lastSeenAt).toLocaleString()
                : "Waiting for first heartbeat"}
            </small>
          </div>
        </div>
      </header>

      <main>
        {data.adapter === "whatsapp-web" && (
          <WhatsAppConnection status={whatsappStatus} />
        )}

        <section className="button-workspace" aria-labelledby="buttons-heading">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Eight physical buttons</p>
              <h2 id="buttons-heading">Who each button reaches</h2>
            </div>
            <p>
              {assigned.length}/{BUTTON_SLOTS.length} assigned · {waiting} waiting
            </p>
          </div>
          <div className="button-grid">
            {data.config.buttons.map((button) => (
              <AssignmentForm
                key={button.slot}
                button={button}
                adapter={data.adapter}
                deviceId={data.device.id}
                onSaved={() => load(data.device.id)}
              />
            ))}
          </div>
        </section>

        <nav className="tabs" aria-label="Message box sections">
          {(["messages", "settings", "simulator"] as const).map((item) => (
            <button
              key={item}
              className={tab === item ? "selected" : ""}
              onClick={() => setTab(item)}
            >
              {item === "messages"
                ? "Message activity"
                : item === "settings"
                  ? "Settings"
                  : "Button simulator"}
            </button>
          ))}
        </nav>

        {notice && (
          <p className="notice" role="status">
            {notice}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}

        {tab === "messages" && (
          <section className="list-section">
            <h2>Recent messages</h2>
            {data.messages.length === 0 ? (
              <p className="empty">
                No messages yet. Use the simulator to add one.
              </p>
            ) : (
              <div className="message-list">
                {data.messages.map((message) => (
                  <article className="message-row" key={message.id}>
                    <div className={`direction ${message.direction}`}>
                      {message.direction === "incoming" ? "↓" : "↑"}
                    </div>
                    <div>
                      <strong>{message.recipientName}</strong>
                      <p>
                        {message.direction === "incoming"
                          ? "Incoming"
                          : "Outgoing"}{" "}
                        · {(message.durationMs / 1000).toFixed(1)} sec
                      </p>
                    </div>
                    <span className={`state-label ${message.deliveryState}`}>
                      {message.direction === "incoming"
                        ? message.playbackState
                        : message.deliveryState === "confirmation_unknown"
                          ? "confirmation unknown"
                          : message.deliveryState}
                    </span>
                    <time>{new Date(message.createdAt).toLocaleString()}</time>
                    {message.deliveryState === "failed" && (
                      <button
                        onClick={async () => {
                          await api(`/api/admin/messages/${message.id}/retry`, {
                            method: "POST",
                          });
                          await load(data.device.id);
                        }}
                      >
                        Retry
                      </button>
                    )}
                  </article>
                ))}
              </div>
            )}
          </section>
        )}

        {tab === "settings" && (
          <>
            <Settings
              key={data.config.deviceId}
              config={data.config}
              onSaved={() => load(data.device.id)}
            />
            <FirmwareUpdatePanel
              deviceId={data.device.id}
              latest={data.latestFirmwareUpdate}
              onUpdated={() => load(data.device.id)}
            />
          </>
        )}

        {tab === "simulator" && (
          <HardwareSimulator
            config={data.config}
            adapter={data.adapter}
            deliveryMode={data.deliveryMode}
            request={api}
            onDataChanged={() => load(data.device.id)}
            onNotice={setNotice}
          />
        )}
      </main>
      <footer>
        LAN only ·{" "}
        {data.adapter === "whatsapp-web"
          ? "WhatsApp Web prototype active"
          : data.adapter === "twilio-whatsapp"
            ? data.deliveryMode === "sandbox-adaptive"
              ? "Twilio Sandbox adaptive delivery active"
              : "Twilio WhatsApp voice active"
            : "Mock messaging active"}{" "}
        · Waiting lamps simulated at 650 ms
      </footer>
    </div>
  );
}

function WhatsAppConnection({ status }: { status: WhatsAppStatus | null }) {
  const ready = status?.state === "ready";
  const needsQr = status?.state === "qr" && status.qrDataUrl;
  return (
    <section
      className={`whatsapp-connection ${ready ? "ready" : ""}`}
      aria-labelledby="whatsapp-heading"
      aria-live="polite"
    >
      <div className="whatsapp-copy">
        <p className="eyebrow">Message connection</p>
        <h2 id="whatsapp-heading">
          {ready
            ? "WhatsApp connected"
            : needsQr
              ? "Link the project phone"
              : "Starting WhatsApp"}
        </h2>
        {ready ? (
          <p>
            Voice notes can now move between the assigned contacts and the
            Family Message Box.
          </p>
        ) : needsQr ? (
          <>
            <p>
              On the dedicated phone, open WhatsApp → Settings → Linked devices
              → Link a device, then scan this code.
            </p>
            <small>
              The linked session is stored only on this Mac. Pairing does not
              send a message.
            </small>
          </>
        ) : status?.lastError ? (
          <p className="connection-error">{status.lastError}</p>
        ) : (
          <p>Opening the local linked-device session…</p>
        )}
      </div>
      {needsQr ? (
        <img
          className="whatsapp-qr"
          src={status.qrDataUrl!}
          alt="WhatsApp linked-device pairing code"
        />
      ) : (
        <div
          className={`connection-mark ${ready ? "ready" : ""}`}
          aria-hidden="true"
        >
          {ready ? "✓" : "…"}
        </div>
      )}
    </section>
  );
}

function Settings({
  config,
  onSaved,
}: {
  config: DeviceConfig;
  onSaved: () => void;
}) {
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [volume, setVolume] = useState(config.settings.volume);
  const [chimeVolume, setChimeVolume] = useState(
    config.settings.chimeVolume,
  );
  const [microphoneGain, setMicrophoneGain] = useState(
    config.settings.microphoneGainPercent,
  );
  const [microphoneNoiseGate, setMicrophoneNoiseGate] = useState(
    config.settings.microphoneNoiseGatePercent,
  );

  useEffect(() => {
    setVolume(config.settings.volume);
    setChimeVolume(config.settings.chimeVolume);
    setMicrophoneGain(config.settings.microphoneGainPercent);
    setMicrophoneNoiseGate(config.settings.microphoneNoiseGatePercent);
  }, [
    config.deviceId,
    config.settings.volume,
    config.settings.chimeVolume,
    config.settings.microphoneGainPercent,
    config.settings.microphoneNoiseGatePercent,
  ]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSaved(false);
    setError("");
    try {
      await api(
        `/api/admin/settings?deviceId=${encodeURIComponent(config.deviceId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            volume,
            chimeVolume,
            microphoneGainPercent: microphoneGain,
            microphoneNoiseGatePercent: microphoneNoiseGate,
            minDurationSeconds: Number(form.get("minimum")),
            maxDurationSeconds: Number(form.get("maximum")),
            quietHoursStart: form.get("quietStart") || null,
            quietHoursEnd: form.get("quietEnd") || null,
          }),
        },
      );
      setSaved(true);
      onSaved();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not save settings.",
      );
    }
  }
  return (
    <section className="list-section settings">
      <div>
        <h2>Sound and recording</h2>
        <p>
          Save once to update the connected ESP32 immediately. The values are
          also kept for its next restart.
        </p>
        <div className="fixed-audio-settings">
          <h3>Fixed by the hardware</h3>
          <dl>
            <div>
              <dt>Audio format</dt>
              <dd>16 kHz, mono</dd>
            </div>
            <div>
              <dt>Amplifier gain</dt>
              <dd>9 dB</dd>
            </div>
            <div>
              <dt>Microphone channel</dt>
              <dd>Left</dd>
            </div>
          </dl>
          <small>
            These require a firmware or wiring change, so they cannot be
            adjusted remotely.
          </small>
        </div>
      </div>
      <form onSubmit={submit}>
        <fieldset>
          <legend>Speaker</legend>
          <label>
            Playback volume <output>{volume}%</output>
            <input
              name="volume"
              type="range"
              min="0"
              max="100"
              value={volume}
              onChange={(event) => {
                setVolume(Number(event.currentTarget.value));
                setSaved(false);
              }}
            />
          </label>
          <small>
            The default is 60%. You can raise this to full digital scale;
            louder recordings may distort near 100%.
          </small>
          <label>
            Arrival chime volume <output>{chimeVolume}%</output>
            <input
              name="chimeVolume"
              type="range"
              min="0"
              max="100"
              value={chimeVolume}
              onChange={(event) => {
                setChimeVolume(Number(event.currentTarget.value));
                setSaved(false);
              }}
            />
          </label>
          <small>
            The default is 60%. Set this to 0% to mute new-message chimes
            without changing voice-note playback.
          </small>
        </fieldset>
        <fieldset>
          <legend>Microphone</legend>
          <label>
            Input gain <output>{microphoneGain}%</output>
            <input
              name="microphoneGain"
              type="range"
              min="25"
              max="400"
              step="25"
              value={microphoneGain}
              onChange={(event) => {
                setMicrophoneGain(Number(event.currentTarget.value));
                setSaved(false);
              }}
            />
          </label>
          <small>
            200% matches the current microphone level. Lower it if recordings
            distort; raise it if voices are too quiet.
          </small>
          <label>
            Noise gate{" "}
            <output>
              {microphoneNoiseGate === 0 ? "Off" : `${microphoneNoiseGate}%`}
            </output>
            <input
              name="microphoneNoiseGate"
              type="range"
              min="0"
              max="20"
              step="1"
              value={microphoneNoiseGate}
              onChange={(event) => {
                setMicrophoneNoiseGate(Number(event.currentTarget.value));
                setSaved(false);
              }}
            />
          </label>
          <small>
            Leave this off unless steady background hiss is a problem. Too high
            can cut off quiet speech.
          </small>
        </fieldset>
        <fieldset>
          <legend>Recording</legend>
          <div className="field-pair">
            <label>
              Minimum recording
              <input
                name="minimum"
                type="number"
                min="1"
                max="30"
                defaultValue={config.settings.minDurationSeconds}
              />{" "}
              seconds
            </label>
            <label>
              Maximum recording
              <input
                name="maximum"
                type="number"
                min="3"
                max="120"
                defaultValue={config.settings.maxDurationSeconds}
              />{" "}
              seconds
            </label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Delivery</legend>
          <small>
            Quiet hours hold outgoing messages in the queue. Nothing is
            discarded.
          </small>
          <div className="field-pair">
            <label>
              Quiet hours start
              <input
                name="quietStart"
                type="time"
                defaultValue={config.settings.quietHoursStart ?? ""}
              />
            </label>
            <label>
              Quiet hours end
              <input
                name="quietEnd"
                type="time"
                defaultValue={config.settings.quietHoursEnd ?? ""}
              />
            </label>
          </div>
        </fieldset>
        {error && <p className="form-error">{error}</p>}
        <button type="submit">
          {saved ? "Saved and sent to device" : "Save and update device"}
        </button>
      </form>
    </section>
  );
}
