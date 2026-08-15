import { useState, type FormEvent } from "react";
import type {
  FirmwareUpdateManifest,
  FirmwareUpdateSummary,
} from "@family-box/contracts";

function manifestHeader(manifest: FirmwareUpdateManifest): string {
  const bytes = new TextEncoder().encode(JSON.stringify(manifest));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

export function FirmwareUpdatePanel({
  deviceId,
  latest,
  onUpdated,
}: {
  deviceId: string;
  latest: FirmwareUpdateSummary | null;
  onUpdated: () => void;
}) {
  const [token, setToken] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const binary = form.get("firmware");
    const manifestFile = form.get("manifest");
    if (!(binary instanceof File) || !(manifestFile instanceof File)) return;
    setUploading(true);
    setError("");
    setNotice("");
    try {
      const manifest = JSON.parse(
        await manifestFile.text(),
      ) as FirmwareUpdateManifest;
      if (manifest.deviceId !== deviceId)
        throw new Error("This signed package belongs to a different Family Message Box.");
      const response = await fetch(
        `/api/admin/firmware?deviceId=${encodeURIComponent(deviceId)}`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "x-ota-csrf": "1",
            "x-firmware-manifest": manifestHeader(manifest),
            "content-type": "application/octet-stream",
          },
          body: await binary.arrayBuffer(),
        },
      );
      const body = (await response.json()) as
        | FirmwareUpdateSummary
        | { error?: string };
      if (!response.ok)
        throw new Error(
          "error" in body && body.error
            ? body.error
            : `Upload failed (${response.status}).`,
        );
      setNotice(
        "Signed update staged. The box will install it when no button, recording, or playback is active.",
      );
      event.currentTarget.reset();
      onUpdated();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "The firmware could not be staged.",
      );
    } finally {
      setUploading(false);
    }
  }

  return (
    <section className="list-section firmware-update" aria-labelledby="firmware-heading">
      <div>
        <p className="eyebrow">Wi-Fi maintenance</p>
        <h2 id="firmware-heading">Firmware update</h2>
        <p>
          Upload the matching signed manifest and firmware binary from Files.
          The update is device-scoped and the current firmware remains available
          for automatic rollback.
        </p>
        {latest && (
          <dl className="firmware-status">
            <div>
              <dt>Latest version</dt>
              <dd>{latest.version}</dd>
            </div>
            <div>
              <dt>Build</dt>
              <dd>{latest.build}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{latest.state.replace("_", " ")}</dd>
            </div>
          </dl>
        )}
      </div>
      <form onSubmit={submit}>
        <label>
          Signed manifest
          <input name="manifest" type="file" accept="application/json,.json" required />
        </label>
        <label>
          Firmware binary
          <input name="firmware" type="file" accept="application/octet-stream,.bin" required />
        </label>
        <label>
          Firmware update password
          <input
            name="token"
            type="password"
            autoComplete="current-password"
            value={token}
            onChange={(event) => setToken(event.currentTarget.value)}
            required
          />
        </label>
        <small>The password stays in this page only and is never put in a URL.</small>
        {error && <p className="form-error" role="alert">{error}</p>}
        {notice && <p className="notice" role="status">{notice}</p>}
        <button type="submit" disabled={uploading}>
          {uploading ? "Checking and staging…" : "Verify and update over Wi-Fi"}
        </button>
      </form>
    </section>
  );
}
