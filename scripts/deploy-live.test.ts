import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("live deployment script", () => {
  it("does not require Node.js on the deployment host", () => {
    const script = readFileSync(new URL("./deploy-live.sh", import.meta.url), "utf8");

    expect(script).not.toMatch(/^node -e /m);
    expect(script.match(/docker exec -i "\$container" node -e/g)).toHaveLength(3);
  });

  it("verifies the immutable image tag instead of the running container image", () => {
    const script = readFileSync(new URL("./deploy-live.sh", import.meta.url), "utf8");

    expect(script).toContain('built_image="message-box-family-box:${expected_sha}"');
    expect(script).not.toContain("docker compose images -q family-box");
  });

  it("discovers the Compose container and uses a configurable health URL", () => {
    const script = readFileSync(new URL("./deploy-live.sh", import.meta.url), "utf8");

    expect(script).toContain("docker compose ps -q family-box");
    expect(script).toContain("FAMILY_BOX_HEALTH_URL");
    expect(script).not.toMatch(/192\.168\.4\.34|message-box-family-box-1/);
  });
});
