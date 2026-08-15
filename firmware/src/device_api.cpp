#include "device_api.h"

#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <Preferences.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_ota_ops.h>
#include <esp_heap_caps.h>
#include <mbedtls/base64.h>
#include <mbedtls/pk.h>
#include <mbedtls/sha256.h>
#include <time.h>

#include "audio_io.h"
#include "firmware_identity.h"
#include "network_tuning.h"
#include "ota_policy.h"
#include "playback_stream.h"
#include "runtime_config.h"

namespace {
constexpr unsigned long WIFI_CONNECT_TIMEOUT_MS = 20000;
constexpr unsigned long RECONNECT_INTERVAL_MS = 10000;
constexpr unsigned long HEARTBEAT_INTERVAL_MS = 30000;
constexpr unsigned long CONFIG_REFRESH_INTERVAL_MS = 60000;
constexpr unsigned long CLOCK_SYNC_TIMEOUT_MS = 5000;
constexpr size_t MAX_PLAYBACK_PCM_BYTES = 4000000;
constexpr time_t TRUSTED_CLOCK_AFTER = 1704067200;
constexpr const char *FAMILY_BOX_NVS_NAMESPACE = "messagebox";

class HttpConnection {
 public:
  bool begin(const String &url) {
    http.setConnectTimeout(10000);
    http.setTimeout(20000);
    if (DeviceConfig::API_TLS) {
      if (DeviceConfig::ROOT_CA_PEM[0] == '\0') {
        Serial.println("TLS is enabled but ROOT_CA_PEM is empty.");
        return false;
      }
      secure.setCACert(DeviceConfig::ROOT_CA_PEM);
      return http.begin(secure, url);
    }
    return http.begin(plain, url);
  }

  HTTPClient http;

 private:
  WiFiClient plain;
  WiFiClientSecure secure;
};

struct PlaybackSinkContext {
  AudioIO *audio = nullptr;
  void (*pump)() = nullptr;
};

struct PlaybackStreamOutcome {
  bool completed = false;
  PlaybackStream::FailureReason failure = PlaybackStream::FailureReason::None;
  size_t expectedBytes = 0;
  size_t receivedBytes = 0;
  int httpStatus = 0;
};

bool writePlaybackChunk(const uint8_t *data, size_t length, void *context) {
  auto *sink = static_cast<PlaybackSinkContext *>(context);
  if (sink == nullptr || sink->audio == nullptr) return false;
  const bool written = sink->audio->writeMonoPcmChunk(data, length);
  if (written && sink->pump != nullptr) sink->pump();
  return written;
}

PlaybackStreamOutcome streamPcmResponse(
  HttpConnection &connection,
  int status,
  AudioIO &audio,
  uint8_t volumePercent,
  void (*pump)()
) {
  PlaybackStreamOutcome outcome;
  outcome.httpStatus = status;
  const int contentLength = connection.http.getSize();
  if (status != 200 || contentLength <= 0
      || static_cast<size_t>(contentLength) > MAX_PLAYBACK_PCM_BYTES
      || contentLength % 2 != 0) {
    connection.http.end();
    outcome.failure = PlaybackStream::FailureReason::InvalidResponse;
    return outcome;
  }
  outcome.expectedBytes = static_cast<size_t>(contentLength);
  if (!audio.beginMonoPcmPlayback(volumePercent)) {
    connection.http.end();
    outcome.failure = PlaybackStream::FailureReason::AudioStartFailed;
    return outcome;
  }

  WiFiClient *stream = connection.http.getStreamPtr();
  PlaybackStream::PcmChunkBuffer pcmBuffer;
  PlaybackSinkContext sink;
  sink.audio = &audio;
  sink.pump = pump;
  uint8_t networkChunk[NetworkTuning::PLAYBACK_NETWORK_CHUNK_BYTES];
  PlaybackStream::TransferProgress progress(outcome.expectedBytes, millis());
  while (!progress.complete()) {
    const size_t available = stream->available();
    bool madeProgress = false;
    if (available > 0) {
      const size_t chunk = min(
        min(available, sizeof(networkChunk)),
        outcome.expectedBytes - progress.receivedBytes()
      );
      const int read = stream->readBytes(networkChunk, chunk);
      if (read > 0) {
        madeProgress = true;
        progress.recordRead(static_cast<size_t>(read), millis());
        if (!pcmBuffer.append(
              networkChunk,
              static_cast<size_t>(read),
              writePlaybackChunk,
              &sink
            )) {
          outcome.failure = PlaybackStream::FailureReason::SinkWriteFailed;
          break;
        }
      }
    }
    if (!madeProgress) {
      const PlaybackStream::FailureReason idleFailure = progress.idleFailure(
        stream->connected(),
        millis(),
        NetworkTuning::PLAYBACK_STALL_TIMEOUT_MS
      );
      if (idleFailure != PlaybackStream::FailureReason::None) {
        outcome.failure = idleFailure;
        break;
      }
    }
    if (pump != nullptr) pump();
    delay(1);
  }
  connection.http.end();
  outcome.receivedBytes = progress.receivedBytes();
  if (outcome.failure == PlaybackStream::FailureReason::None
      && (!progress.complete()
          || !pcmBuffer.finish(writePlaybackChunk, &sink))) {
    outcome.failure = PlaybackStream::FailureReason::InvalidPcm;
  }
  const bool audioFinished = audio.finishMonoPcmPlayback(
    outcome.failure == PlaybackStream::FailureReason::None,
    pump
  );
  if (outcome.failure == PlaybackStream::FailureReason::None
      && !audioFinished) {
    outcome.failure = PlaybackStream::FailureReason::AudioFinishFailed;
  }
  outcome.completed = outcome.failure == PlaybackStream::FailureReason::None;
  return outcome;
}

bool isPlaceholder(const char *value) {
  return value == nullptr
    || value[0] == '\0'
    || String(value).startsWith("replace-");
}

String jsonBody(JsonDocument &document) {
  String body;
  serializeJson(document, body);
  return body;
}

String canonicalFirmwareManifest(const FirmwareUpdateRef &update) {
  String value = "message-box-firmware-v1\n";
  value += update.updateId + "\n";
  value += update.deviceId + "\n";
  value += update.target + "\n";
  value += update.version + "\n";
  value += String(update.build) + "\n";
  value += String(update.sizeBytes) + "\n";
  value += update.sha256 + "\n";
  char expires[24];
  snprintf(expires, sizeof(expires), "%llu", static_cast<unsigned long long>(update.expiresAt));
  value += expires;
  value += "\n";
  return value;
}

bool verifyFirmwareSignature(const FirmwareUpdateRef &update) {
  if (DeviceConfig::FIRMWARE_SIGNING_PUBLIC_KEY_PEM[0] == '\0') return false;
  uint8_t signature[192];
  size_t signatureLength = 0;
  if (mbedtls_base64_decode(
        signature,
        sizeof(signature),
        &signatureLength,
        reinterpret_cast<const unsigned char *>(update.signature.c_str()),
        update.signature.length()
      ) != 0) {
    return false;
  }
  const String canonical = canonicalFirmwareManifest(update);
  uint8_t digest[32];
  if (mbedtls_sha256_ret(
        reinterpret_cast<const unsigned char *>(canonical.c_str()),
        canonical.length(),
        digest,
        0
      ) != 0) {
    return false;
  }
  mbedtls_pk_context publicKey;
  mbedtls_pk_init(&publicKey);
  const int parseResult = mbedtls_pk_parse_public_key(
    &publicKey,
    reinterpret_cast<const unsigned char *>(DeviceConfig::FIRMWARE_SIGNING_PUBLIC_KEY_PEM),
    strlen(DeviceConfig::FIRMWARE_SIGNING_PUBLIC_KEY_PEM) + 1
  );
  const int verifyResult = parseResult == 0
    ? mbedtls_pk_verify(
        &publicKey,
        MBEDTLS_MD_SHA256,
        digest,
        sizeof(digest),
        signature,
        signatureLength
      )
    : parseResult;
  mbedtls_pk_free(&publicKey);
  return verifyResult == 0;
}

String sha256Hex(const uint8_t digest[32]) {
  static constexpr char HEX_DIGITS[] = "0123456789abcdef";
  char encoded[65];
  for (size_t index = 0; index < 32; index++) {
    encoded[index * 2] = HEX_DIGITS[digest[index] >> 4];
    encoded[index * 2 + 1] = HEX_DIGITS[digest[index] & 0x0f];
  }
  encoded[64] = '\0';
  return String(encoded);
}

bool waitForTrustedClock(void (*pump)()) {
  if (time(nullptr) >= TRUSTED_CLOCK_AFTER) return true;
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  const unsigned long startedMs = millis();
  while (millis() - startedMs < CLOCK_SYNC_TIMEOUT_MS) {
    if (time(nullptr) >= TRUSTED_CLOCK_AFTER) return true;
    if (pump != nullptr) pump();
    delay(100);
  }
  return time(nullptr) >= TRUSTED_CLOCK_AFTER;
}

bool parseFirmwareUpdate(const String &payload, FirmwareUpdateRef &update) {
  JsonDocument document;
  if (deserializeJson(document, payload) != DeserializationError::Ok) return false;
  JsonVariantConst source = document["update"].isNull()
    ? document.as<JsonVariantConst>()
    : document["update"].as<JsonVariantConst>();
  update.updateId = String(source["updateId"] | "");
  update.deviceId = String(source["deviceId"] | "");
  update.target = String(source["target"] | "");
  update.version = String(source["version"] | "");
  update.build = source["build"] | 0U;
  update.sizeBytes = source["sizeBytes"] | 0U;
  update.sha256 = String(source["sha256"] | "");
  update.expiresAt = source["expiresAt"] | 0ULL;
  update.signature = String(source["signature"] | "");
  return !update.updateId.isEmpty();
}
}

void DeviceApi::begin(EventHandler eventHandler) {
  eventHandler_ = eventHandler;
  Serial.printf(
    "Compiled device recovery credential: %s (%u characters).\n",
    DeviceConfig::DEVICE_CREDENTIAL[0] == '\0' ? "absent" : "present",
    static_cast<unsigned int>(strlen(DeviceConfig::DEVICE_CREDENTIAL))
  );
  credential_ = String(DeviceConfig::DEVICE_CREDENTIAL);
  bool loadedFromNvs = false;
  Preferences preferences;
  if (preferences.begin(FAMILY_BOX_NVS_NAMESPACE, true)) {
    const String storedCredential = preferences.getString("credential", "");
    const String storedDeviceId = preferences.getString("deviceId", "");
    const String storedApiHost = preferences.getString("apiHost", "");
    if (!storedCredential.isEmpty()
        && storedDeviceId == DeviceConfig::DEVICE_ID
        && storedApiHost == DeviceConfig::API_HOST) {
      credential_ = storedCredential;
      loadedFromNvs = true;
    } else if (!storedCredential.isEmpty()) {
      Serial.println("Ignoring credential stored for a different device or API host.");
    }
    preferences.end();
  }
  if (!loadedFromNvs && !credential_.isEmpty()) {
    if (preferences.begin(FAMILY_BOX_NVS_NAMESPACE, false)) {
      const bool stored = preferences.putString("credential", credential_) > 0;
      preferences.end();
      Serial.println(stored
        ? "Device recovery credential loaded and stored in NVS."
        : "Device recovery credential loaded; NVS write failed.");
    }
  }
  if (ensureConnected()) {
    fetchConfig();
  }
}

bool DeviceApi::ready() const {
  return WiFi.status() == WL_CONNECTED && !credential_.isEmpty();
}

String DeviceApi::apiUrl(const String &path) const {
  String url = DeviceConfig::API_TLS ? "https://" : "http://";
  url += DeviceConfig::API_HOST;
  url += ":";
  url += DeviceConfig::API_PORT;
  url += path;
  return url;
}

bool DeviceApi::connectWifi() {
  if (isPlaceholder(DeviceConfig::WIFI_SSID)
      || isPlaceholder(DeviceConfig::API_HOST)
      || DeviceConfig::API_PORT == 0) {
    Serial.println("Copy device_config.example.h to device_config.h and configure Wi-Fi/API.");
    return false;
  }

  Serial.printf("Connecting to Wi-Fi %s", DeviceConfig::WIFI_SSID);
  WiFi.mode(WIFI_STA);
  if (NetworkTuning::DISABLE_WIFI_POWER_SAVE) {
    WiFi.setSleep(false);
    if (WiFi.getSleep() != WIFI_PS_NONE) {
      Serial.println("Wi-Fi power-save disable request was not applied.");
    }
  }
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(DeviceConfig::WIFI_SSID, DeviceConfig::WIFI_PASSWORD);
  const unsigned long startedAt = millis();
  while (WiFi.status() != WL_CONNECTED
         && millis() - startedAt < WIFI_CONNECT_TIMEOUT_MS) {
    delay(250);
    Serial.print(".");
  }
  Serial.println();
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Wi-Fi connection timed out.");
    return false;
  }
  Serial.printf("Wi-Fi connected: %s\n", WiFi.localIP().toString().c_str());
  return true;
}

bool DeviceApi::registerIfNeeded() {
  if (credential_.isEmpty() && DeviceConfig::DEVICE_CREDENTIAL[0] != '\0') {
    credential_ = String(DeviceConfig::DEVICE_CREDENTIAL);
    Serial.println("Using compiled device recovery credential.");
  }
  if (!credential_.isEmpty()) return true;
  if (isPlaceholder(DeviceConfig::BOOTSTRAP_TOKEN)) {
    Serial.printf(
      "No device credential in NVS and no usable bootstrap token; compiled recovery length=%u.\n",
      static_cast<unsigned int>(strlen(DeviceConfig::DEVICE_CREDENTIAL))
    );
    return false;
  }

  HttpConnection connection;
  if (!connection.begin(apiUrl("/api/devices/register"))) return false;
  JsonDocument request;
  request["deviceId"] = DeviceConfig::DEVICE_ID;
  request["name"] = "Family Message Box";
  request["bootstrapToken"] = DeviceConfig::BOOTSTRAP_TOKEN;
  const String body = jsonBody(request);
  connection.http.addHeader("Content-Type", "application/json");
  const int status = connection.http.POST(body);
  const String response = connection.http.getString();
  connection.http.end();
  if (status != 200) {
    Serial.printf("Device registration failed (%d): %s\n", status, response.c_str());
    return false;
  }

  JsonDocument document;
  if (deserializeJson(document, response) != DeserializationError::Ok) return false;
  credential_ = document["credential"] | "";
  if (credential_.isEmpty()) return false;

  Preferences preferences;
  if (!preferences.begin(FAMILY_BOX_NVS_NAMESPACE, false)) return false;
  const bool stored = preferences.putString("credential", credential_) > 0
    && preferences.putString("deviceId", DeviceConfig::DEVICE_ID) > 0
    && preferences.putString("apiHost", DeviceConfig::API_HOST) > 0;
  preferences.end();
  if (!stored) {
    credential_ = "";
    Serial.println("Device credential could not be stored in NVS.");
    return false;
  }
  Serial.println("Device registered and credential stored in NVS.");
  return true;
}

void DeviceApi::addDeviceHeaders(HTTPClient &http) {
  http.addHeader("X-Device-Id", DeviceConfig::DEVICE_ID);
  http.addHeader("X-Device-Credential", credential_);
}

bool DeviceApi::startWebSocket() {
  if (websocketStarted_ || credential_.isEmpty()) return websocketStarted_;
  webSocketHeaders_ = "X-Device-Id: ";
  webSocketHeaders_ += DeviceConfig::DEVICE_ID;
  webSocketHeaders_ += "\r\nX-Device-Credential: ";
  webSocketHeaders_ += credential_;
  webSocket_.setExtraHeaders(webSocketHeaders_.c_str());
  webSocket_.setReconnectInterval(5000);
  webSocket_.enableHeartbeat(15000, 3000, 2);
  webSocket_.onEvent([this](WStype_t type, uint8_t *payload, size_t length) {
    if (type == WStype_CONNECTED) {
      JsonDocument hello;
      hello["type"] = "device.hello";
      hello["deviceId"] = DeviceConfig::DEVICE_ID;
      hello["firmwareVersion"] = FirmwareIdentity::VERSION;
      String body = jsonBody(hello);
      webSocket_.sendTXT(body);
      return;
    }
    if (type == WStype_TEXT && eventHandler_ != nullptr) {
      String event;
      event.reserve(length + 1);
      for (size_t index = 0; index < length; index++) {
        event += static_cast<char>(payload[index]);
      }
      eventHandler_(event.c_str());
    }
  });

  if (DeviceConfig::API_TLS) {
    if (DeviceConfig::ROOT_CA_PEM[0] == '\0') return false;
    webSocket_.beginSslWithCA(
      DeviceConfig::API_HOST,
      DeviceConfig::API_PORT,
      "/api/device/events",
      DeviceConfig::ROOT_CA_PEM,
      ""
    );
  } else {
    webSocket_.begin(
      DeviceConfig::API_HOST,
      DeviceConfig::API_PORT,
      "/api/device/events",
      ""
    );
  }
  websocketStarted_ = true;
  return true;
}

bool DeviceApi::ensureConnected() {
  if (WiFi.status() != WL_CONNECTED && !connectWifi()) return false;
  if (!registerIfNeeded()) return false;
  if (!websocketStarted_) startWebSocket();
  return ready();
}

bool DeviceApi::applyConfigResponse(const String &payload) {
  JsonDocument document;
  if (deserializeJson(document, payload) != DeserializationError::Ok) return false;
  JsonVariantConst config = document["config"].isNull()
    ? document.as<JsonVariantConst>()
    : document["config"].as<JsonVariantConst>();
  JsonDocument event;
  event["type"] = "config.updated";
  event["config"].set(config);
  String serialized = jsonBody(event);
  if (eventHandler_ != nullptr) eventHandler_(serialized.c_str());
  return true;
}

void DeviceApi::pumpRealtime() {
  if (WiFi.status() == WL_CONNECTED && websocketStarted_) {
    webSocket_.loop();
  }
}

bool DeviceApi::fetchConfig() {
  if (!ready()) return false;
  HttpConnection connection;
  if (!connection.begin(apiUrl("/api/device/config"))) return false;
  addDeviceHeaders(connection.http);
  const int status = connection.http.GET();
  const String response = connection.http.getString();
  connection.http.end();
  return status == 200 && applyConfigResponse(response);
}

bool DeviceApi::fetchPendingFirmware(FirmwareUpdateRef &update) {
  update = {};
  if (!ready()) return false;
  HttpConnection connection;
  if (!connection.begin(apiUrl("/api/device/firmware/pending"))) return false;
  addDeviceHeaders(connection.http);
  const int status = connection.http.GET();
  if (status == 204) {
    connection.http.end();
    return false;
  }
  const String response = connection.http.getString();
  connection.http.end();
  return status == 200 && parseFirmwareUpdate(response, update);
}

bool DeviceApi::reportFirmwareUpdateStatus(
  const String &updateId,
  const char *state,
  const String &error
) {
  if (!ready() || updateId.isEmpty() || state == nullptr) return false;
  HttpConnection connection;
  if (!connection.begin(
        apiUrl("/api/device/firmware/" + updateId + "/status")
      )) return false;
  addDeviceHeaders(connection.http);
  connection.http.addHeader("Content-Type", "application/json");
  JsonDocument request;
  request["state"] = state;
  if (!error.isEmpty()) request["error"] = error;
  const int status = connection.http.POST(jsonBody(request));
  connection.http.end();
  return status == 200;
}

bool DeviceApi::installFirmwareUpdate(
  const FirmwareUpdateRef &update,
  void (*pump)()
) {
  if (!ready()) return false;
  if (!DeviceConfig::API_TLS && !DeviceConfig::ALLOW_INSECURE_LAN_OTA) {
    reportFirmwareUpdateStatus(
      update.updateId,
      "failed",
      "Plaintext LAN OTA is disabled in device configuration."
    );
    return false;
  }
  Preferences preferences;
  uint32_t acceptedBuild = FirmwareIdentity::BUILD;
  if (preferences.begin(FAMILY_BOX_NVS_NAMESPACE, true)) {
    acceptedBuild = max(
      acceptedBuild,
      preferences.getUInt("fwBuild", FirmwareIdentity::BUILD)
    );
    preferences.end();
  }
  const OtaPolicy::Manifest policyManifest = {
    update.updateId.c_str(),
    update.deviceId.c_str(),
    update.target.c_str(),
    update.version.c_str(),
    update.build,
    update.sizeBytes,
    update.sha256.c_str(),
    update.expiresAt,
    update.signature.c_str(),
  };
  if (!waitForTrustedClock(pump)) {
    reportFirmwareUpdateStatus(
      update.updateId,
      "failed",
      "The device clock could not be verified for firmware expiry checks."
    );
    return false;
  }
  const uint64_t trustedNow = static_cast<uint64_t>(time(nullptr));
  if (!OtaPolicy::isAcceptable(
        policyManifest,
        DeviceConfig::DEVICE_ID,
        acceptedBuild,
        trustedNow
      ) || !verifyFirmwareSignature(update)) {
    reportFirmwareUpdateStatus(
      update.updateId,
      "failed",
      "Firmware manifest validation failed."
    );
    return false;
  }
  if (!reportFirmwareUpdateStatus(update.updateId, "downloading")) return false;

  HttpConnection connection;
  if (!connection.begin(apiUrl("/api/device/firmware/" + update.updateId))) {
    reportFirmwareUpdateStatus(update.updateId, "failed", "Firmware download could not start.");
    return false;
  }
  addDeviceHeaders(connection.http);
  const int status = connection.http.GET();
  const int contentLength = connection.http.getSize();
  if (status != 200 || contentLength <= 0
      || static_cast<size_t>(contentLength) != update.sizeBytes) {
    connection.http.end();
    reportFirmwareUpdateStatus(update.updateId, "failed", "Firmware download size was invalid.");
    return false;
  }

  const esp_partition_t *partition = esp_ota_get_next_update_partition(nullptr);
  esp_ota_handle_t otaHandle = 0;
  bool otaStarted = partition != nullptr
    && esp_ota_begin(partition, update.sizeBytes, &otaHandle) == ESP_OK;
  if (!otaStarted) {
    connection.http.end();
    reportFirmwareUpdateStatus(update.updateId, "failed", "The inactive OTA partition was unavailable.");
    return false;
  }

  mbedtls_sha256_context sha;
  mbedtls_sha256_init(&sha);
  bool successful = mbedtls_sha256_starts_ret(&sha, 0) == 0;
  WiFiClient *stream = connection.http.getStreamPtr();
  constexpr size_t OTA_CHUNK_BYTES = 2048;
  auto *buffer = static_cast<uint8_t *>(
    heap_caps_malloc(OTA_CHUNK_BYTES, MALLOC_CAP_8BIT)
  );
  if (buffer == nullptr) successful = false;
  size_t received = 0;
  unsigned long lastProgressMs = millis();
  while (successful && received < update.sizeBytes) {
    const size_t available = stream->available();
    if (available > 0) {
      const size_t chunkSize = min(
        min(available, OTA_CHUNK_BYTES),
        update.sizeBytes - received
      );
      const int bytesRead = stream->readBytes(buffer, chunkSize);
      if (bytesRead > 0) {
        if ((received == 0 && buffer[0] != 0xe9)
            || mbedtls_sha256_update_ret(&sha, buffer, bytesRead) != 0
            || esp_ota_write(otaHandle, buffer, bytesRead) != ESP_OK) {
          successful = false;
          break;
        }
        received += static_cast<size_t>(bytesRead);
        lastProgressMs = millis();
      }
    } else if (!stream->connected() || millis() - lastProgressMs > 10000) {
      successful = false;
      break;
    }
    if (pump != nullptr) pump();
    delay(1);
  }
  uint8_t digest[32];
  successful = successful
    && received == update.sizeBytes
    && mbedtls_sha256_finish_ret(&sha, digest) == 0
    && sha256Hex(digest) == update.sha256;
  mbedtls_sha256_free(&sha);
  if (buffer != nullptr) heap_caps_free(buffer);
  connection.http.end();

  if (!successful) {
    esp_ota_abort(otaHandle);
    reportFirmwareUpdateStatus(update.updateId, "failed", "Firmware download or digest validation failed.");
    return false;
  }
  if (!reportFirmwareUpdateStatus(update.updateId, "installing")) {
    esp_ota_abort(otaHandle);
    return false;
  }
  if (esp_ota_end(otaHandle) != ESP_OK) {
    reportFirmwareUpdateStatus(update.updateId, "failed", "ESP image validation failed.");
    return false;
  }

  if (!preferences.begin(FAMILY_BOX_NVS_NAMESPACE, false)) {
    reportFirmwareUpdateStatus(update.updateId, "failed", "OTA recovery state could not be stored.");
    return false;
  }
  const bool contextStored =
    preferences.putString("otaUpdateId", update.updateId) > 0
    && preferences.putString("otaVersion", update.version) > 0
    && preferences.putUInt("otaBuild", update.build) > 0;
  preferences.end();
  if (!contextStored) {
    reportFirmwareUpdateStatus(update.updateId, "failed", "OTA recovery state could not be stored.");
    return false;
  }
  const esp_partition_t *runningPartition = esp_ota_get_running_partition();
  if (esp_ota_set_boot_partition(partition) != ESP_OK) {
    reportFirmwareUpdateStatus(update.updateId, "failed", "The new boot partition could not be selected.");
    return false;
  }
  if (!reportFirmwareUpdateStatus(update.updateId, "rebooting")) {
    if (runningPartition != nullptr) {
      esp_ota_set_boot_partition(runningPartition);
    }
    if (preferences.begin(FAMILY_BOX_NVS_NAMESPACE, false)) {
      preferences.remove("otaUpdateId");
      preferences.remove("otaVersion");
      preferences.remove("otaBuild");
      preferences.end();
    }
    reportFirmwareUpdateStatus(update.updateId, "failed", "The reboot state could not be confirmed.");
    return false;
  }
  delay(300);
  ESP.restart();
  return true;
}

bool DeviceApi::confirmRunningFirmware(bool hardwareHealthy) {
  Preferences preferences;
  if (!preferences.begin(FAMILY_BOX_NVS_NAMESPACE, true)) return false;
  const String updateId = preferences.isKey("otaUpdateId")
    ? preferences.getString("otaUpdateId", "")
    : "";
  const String expectedVersion = preferences.isKey("otaVersion")
    ? preferences.getString("otaVersion", "")
    : "";
  const uint32_t expectedBuild = preferences.getUInt("otaBuild", 0);
  preferences.end();
  if (updateId.isEmpty()) return true;

  const bool identityMatches = OtaPolicy::runningIdentityMatches(
    expectedVersion.c_str(),
    expectedBuild,
    FirmwareIdentity::VERSION,
    FirmwareIdentity::BUILD
  );
  if (!identityMatches) {
    const bool reported = reportFirmwareUpdateStatus(
      updateId,
      "rolled_back",
      "Bootloader restored the previous firmware."
    );
    if (reported && preferences.begin(FAMILY_BOX_NVS_NAMESPACE, false)) {
      preferences.remove("otaUpdateId");
      preferences.remove("otaVersion");
      preferences.remove("otaBuild");
      preferences.end();
    }
    return reported;
  }

  const esp_partition_t *running = esp_ota_get_running_partition();
  esp_ota_img_states_t state = ESP_OTA_IMG_UNDEFINED;
  const bool pendingVerify = running != nullptr
    && esp_ota_get_state_partition(running, &state) == ESP_OK
    && state == ESP_OTA_IMG_PENDING_VERIFY;
  const bool serverAuthenticated = hardwareHealthy && ready() && fetchConfig();
  if (!OtaPolicy::canConfirmRunning(
        hardwareHealthy,
        ready(),
        identityMatches,
        serverAuthenticated
      )) {
    if (pendingVerify) esp_ota_mark_app_invalid_rollback_and_reboot();
    return false;
  }
  if (pendingVerify && esp_ota_mark_app_valid_cancel_rollback() != ESP_OK) {
    esp_ota_mark_app_invalid_rollback_and_reboot();
    return false;
  }
  if (preferences.begin(FAMILY_BOX_NVS_NAMESPACE, false)) {
    preferences.putUInt("fwBuild", expectedBuild);
    preferences.end();
  }
  const bool reported = reportFirmwareUpdateStatus(updateId, "succeeded");
  if (reported && preferences.begin(FAMILY_BOX_NVS_NAMESPACE, false)) {
    preferences.remove("otaUpdateId");
    preferences.remove("otaVersion");
    preferences.remove("otaBuild");
    preferences.end();
  }
  return reported;
}

void DeviceApi::loop() {
  const unsigned long now = millis();
  if (WiFi.status() != WL_CONNECTED || credential_.isEmpty()) {
    if (now - lastConnectionAttemptMs_ >= RECONNECT_INTERVAL_MS) {
      lastConnectionAttemptMs_ = now;
      websocketStarted_ = false;
      ensureConnected();
    }
    return;
  }

  webSocket_.loop();
  if (now - lastHeartbeatMs_ >= HEARTBEAT_INTERVAL_MS) {
    lastHeartbeatMs_ = now;
    if (webSocket_.isConnected()) {
      JsonDocument heartbeat;
      heartbeat["type"] = "device.heartbeat";
      heartbeat["deviceId"] = DeviceConfig::DEVICE_ID;
      String body = jsonBody(heartbeat);
      webSocket_.sendTXT(body);
    }
  }
  if (now - lastConfigRefreshMs_ >= CONFIG_REFRESH_INTERVAL_MS) {
    lastConfigRefreshMs_ = now;
    fetchConfig();
    FirmwareUpdateRef update;
    if (fetchPendingFirmware(update) && eventHandler_ != nullptr) {
      JsonDocument event;
      event["type"] = "firmware.update.available";
      JsonObject offered = event["update"].to<JsonObject>();
      offered["updateId"] = update.updateId;
      offered["deviceId"] = update.deviceId;
      offered["target"] = update.target;
      offered["version"] = update.version;
      offered["build"] = update.build;
      offered["sizeBytes"] = update.sizeBytes;
      offered["sha256"] = update.sha256;
      offered["expiresAt"] = update.expiresAt;
      offered["signature"] = update.signature;
      String serialized = jsonBody(event);
      eventHandler_(serialized.c_str());
    }
  }
}

bool DeviceApi::uploadRecording(
  const String &recipientKey,
  const String &idempotencyKey,
  const uint8_t *pcm,
  size_t length,
  String &deliveryState
) {
  if (!ready() || pcm == nullptr || length == 0) return false;
  const String boundary = "----family-message-box-esp32";
  String prefix = "--" + boundary + "\r\n";
  prefix += "Content-Disposition: form-data; name=\"audio\"; filename=\"recording.pcm\"\r\n";
  prefix += "Content-Type: application/octet-stream\r\n\r\n";
  const String suffix = "\r\n--" + boundary + "--\r\n";
  const size_t bodyLength = prefix.length() + length + suffix.length();
  auto *body = static_cast<uint8_t *>(
    heap_caps_malloc(bodyLength, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)
  );
  if (body == nullptr) return false;
  memcpy(body, prefix.c_str(), prefix.length());
  memcpy(body + prefix.length(), pcm, length);
  memcpy(body + prefix.length() + length, suffix.c_str(), suffix.length());

  HttpConnection connection;
  if (!connection.begin(apiUrl("/api/device/messages/upload"))) {
    heap_caps_free(body);
    return false;
  }
  addDeviceHeaders(connection.http);
  connection.http.addHeader("X-Recipient-Key", recipientKey);
  connection.http.addHeader("Idempotency-Key", idempotencyKey);
  connection.http.addHeader("X-Audio-Sample-Rate", "16000");
  connection.http.addHeader("X-Audio-Channels", "1");
  connection.http.addHeader("Content-Type", "multipart/form-data; boundary=" + boundary);
  const int status = connection.http.sendRequest("POST", body, bodyLength);
  heap_caps_free(body);
  const String response = connection.http.getString();
  connection.http.end();
  if (status != 200 && status != 201) {
    Serial.printf("Recording upload failed (%d): %s\n", status, response.c_str());
    return false;
  }
  JsonDocument document;
  if (deserializeJson(document, response) != DeserializationError::Ok) return false;
  deliveryState = String(document["deliveryState"] | "");
  return !deliveryState.isEmpty();
}

bool DeviceApi::fetchOldest(const String &recipientKey, IncomingMessageRef &message) {
  if (!ready() || recipientKey.isEmpty()) return false;
  HttpConnection connection;
  if (!connection.begin(
    apiUrl("/api/device/messages/next?recipientKey=" + recipientKey)
  )) return false;
  addDeviceHeaders(connection.http);
  const int status = connection.http.GET();
  if (status == 204) {
    connection.http.end();
    return false;
  }
  const String response = connection.http.getString();
  connection.http.end();
  if (status != 200) return false;
  JsonDocument document;
  if (deserializeJson(document, response) != DeserializationError::Ok) return false;
  message.id = String(document["id"] | "");
  message.durationMs = document["duration_ms"] | 0UL;
  return !message.id.isEmpty();
}

bool DeviceApi::downloadPlaybackPcm(
  const String &messageId,
  DownloadedPcm &pcm,
  void (*pump)()
) {
  pcm = {};
  if (!ready() || messageId.isEmpty()) return false;
  HttpConnection connection;
  if (!connection.begin(
    apiUrl("/api/device/messages/" + messageId + "/audio?format=pcm_s16le")
  )) return false;
  addDeviceHeaders(connection.http);
  const int status = connection.http.GET();
  const int contentLength = connection.http.getSize();
  if (status != 200 || contentLength <= 0
      || static_cast<size_t>(contentLength) > MAX_PLAYBACK_PCM_BYTES
      || contentLength % 2 != 0) {
    connection.http.end();
    return false;
  }
  pcm.data = static_cast<uint8_t *>(
    heap_caps_malloc(contentLength, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)
  );
  if (pcm.data == nullptr) {
    connection.http.end();
    return false;
  }

  WiFiClient *stream = connection.http.getStreamPtr();
  size_t received = 0;
  unsigned long lastProgressMs = millis();
  while (received < static_cast<size_t>(contentLength)) {
    const size_t available = stream->available();
    if (available > 0) {
      const size_t chunk = min(
        available,
        static_cast<size_t>(contentLength) - received
      );
      const int read = stream->readBytes(pcm.data + received, chunk);
      if (read > 0) {
        received += static_cast<size_t>(read);
        lastProgressMs = millis();
      }
    } else if (!stream->connected() || millis() - lastProgressMs > 10000) {
      break;
    }
    if (pump != nullptr) pump();
    delay(1);
  }
  connection.http.end();
  if (received != static_cast<size_t>(contentLength)) {
    heap_caps_free(pcm.data);
    pcm = {};
    return false;
  }
  pcm.length = received;
  return true;
}

bool DeviceApi::streamPlaybackPcm(
  const String &messageId,
  AudioIO &audio,
  uint8_t volumePercent,
  void (*pump)()
) {
  if (!ready() || messageId.isEmpty()) return false;
  HttpConnection connection;
  if (!connection.begin(
    apiUrl("/api/device/messages/" + messageId + "/audio?format=pcm_s16le")
  )) return false;
  addDeviceHeaders(connection.http);
  const int status = connection.http.GET();
  const PlaybackStreamOutcome outcome = streamPcmResponse(
    connection,
    status,
    audio,
    volumePercent,
    pump
  );
  if (!outcome.completed) {
    const char *reason = PlaybackStream::failureReasonName(outcome.failure);
    Serial.printf(
      "Playback failed phase=fallback_stream reason=%s bytes=%u/%u status=%d.\n",
      reason,
      static_cast<unsigned int>(outcome.receivedBytes),
      static_cast<unsigned int>(outcome.expectedBytes),
      outcome.httpStatus
    );
    reportPlaybackFailure(
      messageId,
      "fallback_stream",
      reason,
      outcome.receivedBytes,
      outcome.expectedBytes,
      outcome.httpStatus
    );
  }
  return outcome.completed;
}

FusedPlaybackResult DeviceApi::streamOldestPlaybackPcm(
  const String &recipientKey,
  IncomingMessageRef &message,
  AudioIO &audio,
  uint8_t volumePercent,
  void (*pump)()
) {
  message = {};
  if (!ready() || recipientKey.isEmpty()) return FusedPlaybackResult::Failed;
  HttpConnection connection;
  if (!connection.begin(
    apiUrl(
      "/api/device/messages/next/audio?recipientKey="
      + recipientKey
      + "&format=pcm_s16le"
    )
  )) return FusedPlaybackResult::Failed;
  const char *responseHeaders[] = {
    "x-message-id",
    "x-message-duration-ms"
  };
  connection.http.collectHeaders(responseHeaders, 2);
  addDeviceHeaders(connection.http);
  const int status = connection.http.GET();
  if (status == 204) {
    connection.http.end();
    return FusedPlaybackResult::NoMessage;
  }
  if (status == 404 || status == 405) {
    connection.http.end();
    return FusedPlaybackResult::Unsupported;
  }
  if (status != 200) {
    connection.http.end();
    return FusedPlaybackResult::Failed;
  }
  message.id = connection.http.header("x-message-id");
  message.durationMs = static_cast<unsigned long>(
    connection.http.header("x-message-duration-ms").toInt()
  );
  if (message.id.isEmpty()) {
    connection.http.end();
    return FusedPlaybackResult::Failed;
  }
  const PlaybackStreamOutcome outcome = streamPcmResponse(
    connection,
    status,
    audio,
    volumePercent,
    pump
  );
  if (outcome.completed) return FusedPlaybackResult::Completed;
  const char *reason = PlaybackStream::failureReasonName(outcome.failure);
  Serial.printf(
    "Playback failed phase=fused_stream reason=%s bytes=%u/%u status=%d.\n",
    reason,
    static_cast<unsigned int>(outcome.receivedBytes),
    static_cast<unsigned int>(outcome.expectedBytes),
    outcome.httpStatus
  );
  reportPlaybackFailure(
    message.id,
    "fused_stream",
    reason,
    outcome.receivedBytes,
    outcome.expectedBytes,
    outcome.httpStatus
  );
  return FusedPlaybackResult::Failed;
}

bool DeviceApi::reportPlaybackFailure(
  const String &messageId,
  const char *phase,
  const char *reason,
  size_t bytesReceived,
  size_t contentLength,
  int httpStatus
) {
  if (!ready() || messageId.isEmpty()) return false;
  HttpConnection connection;
  if (!connection.begin(apiUrl("/api/device/playback/failures"))) return false;
  addDeviceHeaders(connection.http);
  connection.http.addHeader("Content-Type", "application/json");
  JsonDocument request;
  request["messageId"] = messageId;
  request["phase"] = phase;
  request["reason"] = reason;
  request["bytesReceived"] = bytesReceived;
  request["contentLength"] = contentLength;
  request["httpStatus"] = httpStatus;
  const int status = connection.http.POST(jsonBody(request));
  connection.http.end();
  if (status != 200 && status != 201) {
    Serial.printf("Playback failure telemetry was not accepted (%d).\n", status);
  }
  return status == 200 || status == 201;
}

bool DeviceApi::acknowledgePlayback(
  const String &messageId,
  const String &idempotencyKey
) {
  if (!ready()) return false;
  HttpConnection connection;
  if (!connection.begin(
    apiUrl("/api/device/messages/" + messageId + "/played")
  )) return false;
  addDeviceHeaders(connection.http);
  connection.http.addHeader("Content-Type", "application/json");
  JsonDocument request;
  request["idempotencyKey"] = idempotencyKey;
  const int status = connection.http.POST(jsonBody(request));
  connection.http.end();
  return status == 200;
}
