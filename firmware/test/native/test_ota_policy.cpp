#include <cassert>
#include <cstdint>

#include "ota_policy.h"

namespace {
OtaPolicy::Manifest validManifest() {
  OtaPolicy::Manifest manifest{};
  manifest.updateId = "ota_native_update_01";
  manifest.deviceId = "family-box-01";
  manifest.target = "esp32-s3-wroom-1-n16r8";
  manifest.version = "1.4.0-wifi-ota";
  manifest.build = 10400;
  manifest.sizeBytes = 900000;
  manifest.sha256 =
    "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  manifest.expiresAt = 2000;
  manifest.signature = "MEUCIQDbWk7dfakesignaturematerialforpolicytestingonly";
  return manifest;
}
}

int main() {
  auto manifest = validManifest();
  assert(OtaPolicy::isAcceptable(manifest, "family-box-01", 10300, 1000));

  manifest.target = "esp32";
  assert(!OtaPolicy::isAcceptable(manifest, "family-box-01", 10300, 1000));
  manifest = validManifest();
  manifest.deviceId = "other-box";
  assert(!OtaPolicy::isAcceptable(manifest, "family-box-01", 10300, 1000));
  manifest = validManifest();
  manifest.build = 10300;
  assert(!OtaPolicy::isAcceptable(manifest, "family-box-01", 10300, 1000));
  manifest = validManifest();
  manifest.expiresAt = 1000;
  assert(!OtaPolicy::isAcceptable(manifest, "family-box-01", 10300, 1000));
  manifest = validManifest();
  manifest.sizeBytes = OtaPolicy::MAX_IMAGE_BYTES + 1;
  assert(!OtaPolicy::isAcceptable(manifest, "family-box-01", 10300, 1000));
  manifest = validManifest();
  manifest.sha256 = "not-a-digest";
  assert(!OtaPolicy::isAcceptable(manifest, "family-box-01", 10300, 1000));

  assert(OtaPolicy::canStart(true, false, false, false));
  assert(!OtaPolicy::canStart(false, false, false, false));
  assert(!OtaPolicy::canStart(true, true, false, false));
  assert(!OtaPolicy::canStart(true, false, true, false));
  assert(!OtaPolicy::canStart(true, false, false, true));

  assert(OtaPolicy::runningIdentityMatches(
    "1.4.6-full-volume",
    10406,
    "1.4.6-full-volume",
    10406
  ));
  assert(!OtaPolicy::runningIdentityMatches(
    "1.4.6-full-volume",
    10405,
    "1.4.6-full-volume",
    10406
  ));
  assert(!OtaPolicy::canConfirmRunning(
    true,
    true,
    true,
    false
  ));
  assert(OtaPolicy::canConfirmRunning(
    true,
    true,
    true,
    true
  ));
}
