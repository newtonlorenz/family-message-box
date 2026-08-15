import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("production Compose configuration", () => {
  it("tags built images with the requested Git revision", () => {
    const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");

    expect(compose).toContain('image: "message-box-family-box:${GIT_REVISION:-development}"');
  });

  it("keeps signed OTA optional for a fresh clone", () => {
    const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");
    const otaOverlay = readFileSync(new URL("../compose.ota.yaml", import.meta.url), "utf8");

    expect(compose).not.toContain("firmware-signing-public.pem");
    expect(compose).not.toContain("FIRMWARE_SIGNING_PUBLIC_KEY_PATH");
    expect(otaOverlay).toContain("firmware-signing-public.pem");
    expect(otaOverlay).toContain("FIRMWARE_SIGNING_PUBLIC_KEY_PATH");
  });

  it("passes the host-side exposure boundary into the container", () => {
    const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");

    expect(compose).toContain('FAMILY_BOX_BIND_IP: "${FAMILY_BOX_BIND_IP:-127.0.0.1}"');
    expect(compose).toContain('"${FAMILY_BOX_BIND_IP:-127.0.0.1}:8787:8787"');
  });
});
