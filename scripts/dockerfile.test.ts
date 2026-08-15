import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

describe("production Dockerfile", () => {
  it("bootstraps HTTPS package sources with bounded download retries", () => {
    const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

    expect(dockerfile).toContain("apt-get -o Acquire::Retries=5 install -y --no-install-recommends ca-certificates");
    expect(dockerfile).toContain('sed -i "s|http://deb.debian.org|https://deb.debian.org|g"');
    expect(dockerfile).toContain("apt-get -o Acquire::Retries=5 install -y --no-install-recommends");
  });

  it("does not copy development dependencies into the runtime image", () => {
    const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");

    expect(dockerfile).toContain("RUN npm prune --omit=dev");
  });
});
