const MARKER_PREFIX = "FAMILY_MESSAGE_BOX_OTA_V1";

export function parseFirmwareIdentity(source) {
  const version = source.match(/VERSION\[\]\s*=\s*"([^"]+)"/)?.[1];
  const build = Number(source.match(/BUILD\s*=\s*(\d+)/)?.[1]);
  const target = source.match(/TARGET\[\]\s*=\s*"([^"]+)"/)?.[1];
  if (!version || !Number.isSafeInteger(build) || build < 1 || !target) {
    throw new Error("Firmware identity is missing a valid target/version/build.");
  }
  return { version, build, target };
}

export function firmwareIdentityMarker(identity) {
  return `${MARKER_PREFIX}|target=${identity.target}|version=${identity.version}|build=${identity.build}|END`;
}

export function assertImageIdentity(image, identity) {
  const expected = Buffer.from(firmwareIdentityMarker(identity));
  if (image.indexOf(expected) < 0) {
    throw new Error(
      "The compiled firmware identity does not match the signed manifest identity.",
    );
  }
}

export function assertSecureFirmwareUrl(baseUrl, allowInsecureHttp) {
  const parsed = new URL(baseUrl);
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
  if (parsed.protocol === "https:" || (parsed.protocol === "http:" && loopback)) {
    return;
  }
  if (parsed.protocol === "http:" && allowInsecureHttp) return;
  throw new Error(
    "Refusing insecure firmware administration URL. Use HTTPS or explicitly opt in to private-LAN HTTP.",
  );
}
