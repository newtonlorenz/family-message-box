#pragma once

#include <Arduino.h>
#include <WebSocketsClient.h>

class AudioIO;

struct IncomingMessageRef {
  String id;
  unsigned long durationMs = 0;
};

struct DownloadedPcm {
  uint8_t *data = nullptr;
  size_t length = 0;
};

enum class FusedPlaybackResult {
  Completed,
  NoMessage,
  Unsupported,
  Failed
};

struct FirmwareUpdateRef {
  String updateId;
  String deviceId;
  String target;
  String version;
  uint32_t build = 0;
  size_t sizeBytes = 0;
  String sha256;
  uint64_t expiresAt = 0;
  String signature;
};

class DeviceApi {
 public:
  using EventHandler = void (*)(const char *payload);

  void begin(EventHandler eventHandler);
  void loop();
  void pumpRealtime();
  bool ready() const;
  bool fetchConfig();
  bool fetchPendingFirmware(FirmwareUpdateRef &update);
  bool installFirmwareUpdate(const FirmwareUpdateRef &update, void (*pump)());
  bool confirmRunningFirmware(bool hardwareHealthy);
  bool reportFirmwareUpdateStatus(
    const String &updateId,
    const char *state,
    const String &error = ""
  );

  bool uploadRecording(
    const String &recipientKey,
    const String &idempotencyKey,
    const uint8_t *pcm,
    size_t length,
    String &deliveryState
  );
  bool fetchOldest(const String &recipientKey, IncomingMessageRef &message);
  bool downloadPlaybackPcm(
    const String &messageId,
    DownloadedPcm &pcm,
    void (*pump)()
  );
  bool streamPlaybackPcm(
    const String &messageId,
    AudioIO &audio,
    uint8_t volumePercent,
    void (*pump)()
  );
  FusedPlaybackResult streamOldestPlaybackPcm(
    const String &recipientKey,
    IncomingMessageRef &message,
    AudioIO &audio,
    uint8_t volumePercent,
    void (*pump)()
  );
  bool acknowledgePlayback(const String &messageId, const String &idempotencyKey);

 private:
  bool ensureConnected();
  bool connectWifi();
  bool registerIfNeeded();
  bool startWebSocket();
  bool applyConfigResponse(const String &payload);
  bool reportPlaybackFailure(
    const String &messageId,
    const char *phase,
    const char *reason,
    size_t bytesReceived,
    size_t contentLength,
    int httpStatus
  );
  void addDeviceHeaders(class HTTPClient &http);
  String apiUrl(const String &path) const;

  EventHandler eventHandler_ = nullptr;
  WebSocketsClient webSocket_;
  String credential_;
  String webSocketHeaders_;
  bool websocketStarted_ = false;
  unsigned long lastConnectionAttemptMs_ = 0;
  unsigned long lastHeartbeatMs_ = 0;
  unsigned long lastConfigRefreshMs_ = 0;
};
