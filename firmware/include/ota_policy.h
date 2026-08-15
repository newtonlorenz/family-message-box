#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>

namespace OtaPolicy {
constexpr size_t MIN_IMAGE_BYTES = 24;
constexpr size_t MAX_IMAGE_BYTES = 0x640000;
constexpr char TARGET[] = "esp32-s3-wroom-1-n16r8";

struct Manifest {
  const char *updateId;
  const char *deviceId;
  const char *target;
  const char *version;
  uint32_t build;
  size_t sizeBytes;
  const char *sha256;
  uint64_t expiresAt;
  const char *signature;
};

inline bool bounded(const char *value, size_t minimum, size_t maximum) {
  if (value == nullptr) return false;
  const size_t length = std::strlen(value);
  return length >= minimum && length <= maximum;
}

inline bool safeIdentifier(const char *value, size_t minimum, size_t maximum) {
  if (!bounded(value, minimum, maximum)) return false;
  for (const char *cursor = value; *cursor != '\0'; cursor++) {
    const char character = *cursor;
    const bool safe =
      (character >= 'a' && character <= 'z') ||
      (character >= 'A' && character <= 'Z') ||
      (character >= '0' && character <= '9') ||
      character == '_' || character == '-';
    if (!safe) return false;
  }
  return true;
}

inline bool safeVersion(const char *value) {
  if (!bounded(value, 1, 64)) return false;
  for (const char *cursor = value; *cursor != '\0'; cursor++) {
    const char character = *cursor;
    const bool safe =
      (character >= 'a' && character <= 'z') ||
      (character >= 'A' && character <= 'Z') ||
      (character >= '0' && character <= '9') ||
      character == '.' || character == '_' || character == '+' || character == '-';
    if (!safe) return false;
  }
  return true;
}

inline bool sha256Hex(const char *value) {
  if (!bounded(value, 64, 64)) return false;
  for (const char *cursor = value; *cursor != '\0'; cursor++) {
    const bool hexadecimal =
      (*cursor >= '0' && *cursor <= '9') ||
      (*cursor >= 'a' && *cursor <= 'f');
    if (!hexadecimal) return false;
  }
  return true;
}

inline bool isAcceptable(
  const Manifest &manifest,
  const char *expectedDeviceId,
  uint32_t currentBuild,
  uint64_t nowSeconds
) {
  return safeIdentifier(manifest.updateId, 16, 64)
    && safeIdentifier(manifest.deviceId, 1, 128)
    && expectedDeviceId != nullptr
    && std::strcmp(manifest.deviceId, expectedDeviceId) == 0
    && manifest.target != nullptr
    && std::strcmp(manifest.target, TARGET) == 0
    && safeVersion(manifest.version)
    && manifest.build > currentBuild
    && manifest.sizeBytes >= MIN_IMAGE_BYTES
    && manifest.sizeBytes <= MAX_IMAGE_BYTES
    && sha256Hex(manifest.sha256)
    && bounded(manifest.signature, 16, 256)
    && manifest.expiresAt > nowSeconds;
}

inline bool canStart(
  bool hardwareReady,
  bool audioActive,
  bool recordingPendingUpload,
  bool userInputActive
) {
  return hardwareReady
    && !audioActive
    && !recordingPendingUpload
    && !userInputActive;
}

inline bool runningIdentityMatches(
  const char *expectedVersion,
  uint32_t expectedBuild,
  const char *runningVersion,
  uint32_t runningBuild
) {
  return expectedVersion != nullptr
    && runningVersion != nullptr
    && std::strcmp(expectedVersion, runningVersion) == 0
    && expectedBuild == runningBuild;
}

inline bool canConfirmRunning(
  bool hardwareHealthy,
  bool deviceReady,
  bool identityMatches,
  bool serverAuthenticated
) {
  return hardwareHealthy
    && deviceReady
    && identityMatches
    && serverAuthenticated;
}
}
