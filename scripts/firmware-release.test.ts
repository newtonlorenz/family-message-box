import { describe, expect, it } from "vitest";

import {
  assertImageIdentity,
  assertSecureFirmwareUrl,
  parseFirmwareIdentity,
} from "./firmware-release.mjs";

describe("firmware release safety", () => {
  const source = `
    constexpr char VERSION[] = "1.4.6-full-volume";
    constexpr uint32_t BUILD = 10406;
    constexpr char TARGET[] = "esp32-s3-wroom-1-n16r8";
  `;

  it("reads the authoritative identity from the firmware header", () => {
    expect(parseFirmwareIdentity(source)).toEqual({
      version: "1.4.6-full-volume",
      build: 10406,
      target: "esp32-s3-wroom-1-n16r8",
    });
  });

  it("rejects a binary whose embedded marker does not match the manifest", () => {
    const stale = Buffer.concat([
      Buffer.from([0xe9]),
      Buffer.from(
        "FAMILY_MESSAGE_BOX_OTA_V1|target=esp32-s3-wroom-1-n16r8|version=1.4.5|build=10405|END",
      ),
      Buffer.alloc(32),
    ]);
    expect(() =>
      assertImageIdentity(stale, parseFirmwareIdentity(source)),
    ).toThrow(/does not match/i);
  });

  it("accepts a matching embedded identity marker", () => {
    const current = Buffer.concat([
      Buffer.from([0xe9]),
      Buffer.from(
        "FAMILY_MESSAGE_BOX_OTA_V1|target=esp32-s3-wroom-1-n16r8|version=1.4.6-full-volume|build=10406|END",
      ),
      Buffer.alloc(32),
    ]);
    expect(() =>
      assertImageIdentity(current, parseFirmwareIdentity(source)),
    ).not.toThrow();
  });

  it("refuses non-loopback HTTP unless the operator explicitly opts in", () => {
    expect(() =>
      assertSecureFirmwareUrl("http://192.168.1.50:8787", false),
    ).toThrow(/insecure/i);
    expect(() =>
      assertSecureFirmwareUrl("http://192.168.1.50:8787", true),
    ).not.toThrow();
    expect(() =>
      assertSecureFirmwareUrl("http://127.0.0.1:8787", false),
    ).not.toThrow();
    expect(() =>
      assertSecureFirmwareUrl("https://box.internal", false),
    ).not.toThrow();
  });
});
