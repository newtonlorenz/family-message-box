import { useEffect, useState } from "react";
import type { DeviceConfig } from "@family-box/contracts";
import { HardwareSimulator } from "./HardwareSimulator.tsx";

interface BoxDashboard {
  config: DeviceConfig;
  adapter: string;
  deliveryMode: "sandbox-adaptive" | "voice-media" | "whatsapp-web";
}

interface BoxConnection {
  state: "starting" | "qr" | "authenticated" | "ready" | "disconnected" | "auth_failure" | "stopped";
}

async function boxRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const isMultipart = init?.body instanceof FormData;
  const hasJsonBody = init?.body !== undefined && !isMultipart;
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(hasJsonBody ? { "content-type": "application/json" } : {}),
      ...init?.headers
    }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export function BoxApp() {
  const [dashboard, setDashboard] = useState<BoxDashboard | null>(null);
  const [connection, setConnection] = useState<BoxConnection["state"]>("starting");
  const [notice, setNotice] = useState("Tap a button once to record. Tap it again to send.");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      setDashboard(await boxRequest<BoxDashboard>("/box-api/dashboard"));
      setError("");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The box is unavailable.");
    }
  };

  useEffect(() => {
    void load();
    const dashboardTimer = window.setInterval(load, 5_000);
    const connectionTimer = window.setInterval(() => {
      void boxRequest<BoxConnection>("/box-api/whatsapp-status")
        .then((status) => setConnection(status.state))
        .catch(() => setConnection("disconnected"));
    }, 2_000);
    void boxRequest<BoxConnection>("/box-api/whatsapp-status")
      .then((status) => setConnection(status.state))
      .catch(() => setConnection("disconnected"));
    return () => {
      window.clearInterval(dashboardTimer);
      window.clearInterval(connectionTimer);
    };
  }, []);

  if (!dashboard) {
    return (
      <main className="box-pwa-loading">
        <span className="box-pwa-orbit" aria-hidden="true" />
        <p>{error || "Opening Family Message Box…"}</p>
      </main>
    );
  }

  const ready = connection === "ready";
  const waiting = dashboard.config.buttons.reduce((total, button) => total + button.waitingCount, 0);

  return (
    <div className="box-pwa-shell">
      <header className="box-pwa-header">
        <div>
          <p>Family</p>
          <h1>Message Box</h1>
        </div>
        <div className={`box-pwa-connection ${ready ? "ready" : ""}`}>
          <span aria-hidden="true" />
          {ready ? "Connected" : "Reconnecting"}
        </div>
      </header>

      <main>
        <HardwareSimulator
          compact
          apiPrefix="/box-api"
          config={dashboard.config}
          adapter={dashboard.adapter}
          deliveryMode={dashboard.deliveryMode}
          request={boxRequest}
          onDataChanged={load}
          onNotice={setNotice}
        />
      </main>

      <footer className="box-pwa-footer" aria-live="polite">
        <p>{error || notice}</p>
        <span>{waiting > 0 ? `${waiting} message${waiting === 1 ? "" : "s"} waiting` : "No messages waiting"}</span>
      </footer>
    </div>
  );
}
