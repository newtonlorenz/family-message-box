#include <Arduino.h>
#include <ArduinoJson.h>
#include <esp32-hal-rgb-led.h>
#include <esp_heap_caps.h>
#include <esp_system.h>

#include "audio_io.h"
#include "audio_tuning.h"
#include "contracts.h"
#include "device_api.h"
#include "firmware_identity.h"
#include "notification_chime.h"
#include "ota_policy.h"
#include "pins.h"

namespace {
constexpr unsigned long DEBOUNCE_MS = 45;
constexpr unsigned long RECORDING_CLICK_GUARD_MS = 300;
constexpr unsigned long WAITING_FLASH_INTERVAL_MS = 650;
constexpr unsigned long UPLOAD_RETRY_INTERVAL_MS = 5000;
constexpr unsigned long HARD_RECORDING_LIMIT_MS = 120000;
constexpr size_t REQUIRED_FLASH_BYTES = 16U * 1024U * 1024U;
// ESP.getPsramSize() reports usable capacity and can exclude a small reserved
// region from an 8 MB part. Keep enough tolerance for that bookkeeping while
// still rejecting boards without the supported N16R8-class PSRAM.
constexpr size_t MIN_USABLE_PSRAM_BYTES = (8U * 1024U * 1024U) - (64U * 1024U);
constexpr uint8_t MAX_PLAYBACK_VOLUME = AudioTuning::MAX_DIGITAL_PLAYBACK_VOLUME_PERCENT;

class MosfetLampDriver final : public LampDriver {
 public:
  void begin() {
    for (size_t slot = 0; slot < Pins::BUTTON_COUNT; slot++) {
      pinMode(Pins::LAMPS[slot], OUTPUT);
      setWaiting(slot, false);
    }
  }

  void setWaiting(size_t slot, bool illuminated) override {
    if (slot >= Pins::BUTTON_COUNT) return;
    const bool outputHigh = Pins::LAMP_ACTIVE_HIGH ? illuminated : !illuminated;
    digitalWrite(Pins::LAMPS[slot], outputHigh ? HIGH : LOW);
  }

  void allOff() override {
    for (size_t slot = 0; slot < Pins::BUTTON_COUNT; slot++) setWaiting(slot, false);
  }
};

struct PendingUpload {
  PcmRecording recording;
  String recipientKey;
  String idempotencyKey;
  size_t slot = 0;
  unsigned long nextAttemptMs = 0;
};

ButtonRuntime buttons[Pins::BUTTON_COUNT];
String recipientKeys[Pins::BUTTON_COUNT];
unsigned long minimumRecordingMs = 3000;
unsigned long maximumRecordingMs = 30000;
uint8_t playbackVolume = AudioTuning::DEFAULT_PLAYBACK_VOLUME_PERCENT;
uint8_t chimeVolume = NotificationChimeVolume::DEFAULT_PERCENT;
uint16_t microphoneGainPercent = 200;
uint8_t microphoneNoiseGatePercent = 0;
int activeAudioSlot = -1;
bool hardwareReady = false;
bool pendingAutomaticPlayback = AudioTuning::AUTO_PLAY_BUTTON_ONE_ON_BOOT;
PendingUpload pendingUpload;
FirmwareUpdateRef pendingFirmwareUpdate;
bool otaInProgress = false;
MosfetLampDriver physicalLamps;
AudioIO audio;
DeviceApi api;
NotificationChimeQueue notificationChimes;

void updateLamps(unsigned long now) {
  const bool flashOn = ((now / WAITING_FLASH_INTERVAL_MS) % 2) == 0;
  for (size_t slot = 0; slot < Pins::BUTTON_COUNT; slot++) {
    const bool recording = buttons[slot].mode == ButtonMode::Recording;
    const bool waiting = buttons[slot].waitingCount > 0;
    physicalLamps.setWaiting(slot, recording || (waiting && flashOn));
  }
}

void pumpRealtimeAndLamps() {
  api.pumpRealtime();
  updateLamps(millis());
  yield();
}

void pumpPlaybackAndLamps() {
  // Keep the active audio HTTP stream isolated from websocket heartbeat and
  // reconnect work. Buffered realtime events are processed after playback.
  updateLamps(millis());
  yield();
}

String actionId(const char *prefix, size_t slot) {
  char value[80];
  snprintf(
    value,
    sizeof(value),
    "%s:%u:%08lx:%08lx",
    prefix,
    static_cast<unsigned int>(slot + 1),
    static_cast<unsigned long>(esp_random()),
    millis()
  );
  return String(value);
}

void applyQueueUpdate(size_t slot, unsigned int waitingCount) {
  if (slot >= Pins::BUTTON_COUNT) return;
  ButtonRuntime &button = buttons[slot];
  button.waitingCount = waitingCount;
  if (button.mode != ButtonMode::Recording
      && button.mode != ButtonMode::Playing
      && !(pendingUpload.recording.data != nullptr && pendingUpload.slot == slot)) {
    button.mode = waitingCount > 0 ? ButtonMode::Waiting : ButtonMode::Idle;
  }
}

void applySettings(JsonVariantConst settings) {
  const int volume = settings["volume"] | static_cast<int>(playbackVolume);
  const int configuredChimeVolume = settings["chimeVolume"]
    | static_cast<int>(chimeVolume);
  const int microphoneGain = settings["microphoneGainPercent"]
    | static_cast<int>(microphoneGainPercent);
  const int microphoneNoiseGate = settings["microphoneNoiseGatePercent"]
    | static_cast<int>(microphoneNoiseGatePercent);
  const int minimumSeconds = settings["minDurationSeconds"]
    | static_cast<int>(minimumRecordingMs / 1000);
  const int maximumSeconds = settings["maxDurationSeconds"]
    | static_cast<int>(maximumRecordingMs / 1000);
  playbackVolume = static_cast<uint8_t>(
    constrain(volume, 0, static_cast<int>(MAX_PLAYBACK_VOLUME))
  );
  chimeVolume = NotificationChimeVolume::clampPercent(configuredChimeVolume);
  microphoneGainPercent = static_cast<uint16_t>(constrain(microphoneGain, 25, 400));
  microphoneNoiseGatePercent = static_cast<uint8_t>(constrain(microphoneNoiseGate, 0, 20));
  audio.setMicrophoneProcessing(microphoneGainPercent, microphoneNoiseGatePercent);
  minimumRecordingMs = static_cast<unsigned long>(
    constrain(minimumSeconds, 1, 30)
  ) * 1000;
  maximumRecordingMs = static_cast<unsigned long>(
    constrain(maximumSeconds, 1, 120)
  ) * 1000;
  if (minimumRecordingMs > maximumRecordingMs) {
    minimumRecordingMs = maximumRecordingMs;
  }
}

void handleServerEvent(const char *payload) {
  JsonDocument document;
  if (deserializeJson(document, payload) != DeserializationError::Ok) {
    Serial.println("Ignored malformed server event.");
    return;
  }
  const char *type = document["type"] | "";

  if (strcmp(type, "queue.updated") == 0) {
    const int oneBasedSlot = document["slot"] | 0;
    const int waitingCount = document["waitingCount"] | 0;
    if (oneBasedSlot >= 1 && oneBasedSlot <= static_cast<int>(Pins::BUTTON_COUNT)) {
      applyQueueUpdate(
        static_cast<size_t>(oneBasedSlot - 1),
        static_cast<unsigned int>(max(0, waitingCount))
      );
    }
    return;
  }

  if (strcmp(type, "message.available") == 0) {
    const int oneBasedSlot = document["slot"] | 0;
    const char *messageId = document["messageId"] | "";
    if (oneBasedSlot >= 1
        && oneBasedSlot <= static_cast<int>(Pins::BUTTON_COUNT)
        && notificationChimes.messageReceived(messageId)) {
      Serial.printf("Queued arrival chime for button %d.\n", oneBasedSlot);
    }
    return;
  }

  if (strcmp(type, "firmware.update.available") == 0) {
    JsonVariantConst update = document["update"];
    const String updateId = String(update["updateId"] | "");
    if (updateId.isEmpty()
        || updateId == pendingFirmwareUpdate.updateId
        || otaInProgress) {
      return;
    }
    pendingFirmwareUpdate.updateId = updateId;
    pendingFirmwareUpdate.deviceId = String(update["deviceId"] | "");
    pendingFirmwareUpdate.target = String(update["target"] | "");
    pendingFirmwareUpdate.version = String(update["version"] | "");
    pendingFirmwareUpdate.build = update["build"] | 0U;
    pendingFirmwareUpdate.sizeBytes = update["sizeBytes"] | 0U;
    pendingFirmwareUpdate.sha256 = String(update["sha256"] | "");
    pendingFirmwareUpdate.expiresAt = update["expiresAt"] | 0ULL;
    pendingFirmwareUpdate.signature = String(update["signature"] | "");
    Serial.printf(
      "Signed firmware update %s (%s) is waiting for an idle moment.\n",
      pendingFirmwareUpdate.updateId.c_str(),
      pendingFirmwareUpdate.version.c_str()
    );
    return;
  }

  if (strcmp(type, "settings.updated") == 0) {
    applySettings(document["settings"].as<JsonVariantConst>());
    return;
  }

  if (strcmp(type, "config.updated") == 0) {
    JsonVariantConst config = document["config"];
    applySettings(config["settings"]);
    bool seen[Pins::BUTTON_COUNT] = {};
    for (JsonObjectConst button : config["buttons"].as<JsonArrayConst>()) {
      const int oneBasedSlot = button["slot"] | 0;
      if (oneBasedSlot < 1 || oneBasedSlot > static_cast<int>(Pins::BUTTON_COUNT)) continue;
      const size_t slot = static_cast<size_t>(oneBasedSlot - 1);
      seen[slot] = true;
      recipientKeys[slot] = String(button["recipientKey"] | "");
      applyQueueUpdate(
        slot,
        static_cast<unsigned int>(max(0, button["waitingCount"] | 0))
      );
    }
    for (size_t slot = 0; slot < Pins::BUTTON_COUNT; slot++) {
      if (!seen[slot]) {
        recipientKeys[slot] = "";
        applyQueueUpdate(slot, 0);
      }
    }
    return;
  }

  if (strcmp(type, "server.error") == 0) {
    Serial.printf(
      "Server event error %s: %s\n",
      document["code"] | "unknown",
      document["message"] | "unknown"
    );
  }
}

bool pinsAreUnique() {
  const int fixedPins[] = {
    Pins::MIC_BCLK, Pins::MIC_WS, Pins::MIC_SD,
    Pins::AMP_BCLK, Pins::AMP_LRC, Pins::AMP_DIN, Pins::AMP_SD,
    Pins::BUILTIN_STATUS_RGB
  };
  constexpr size_t fixedPinCount = sizeof(fixedPins) / sizeof(fixedPins[0]);
  int pins[(Pins::BUTTON_COUNT * 2) + fixedPinCount];
  size_t pinCount = 0;
  for (size_t slot = 0; slot < Pins::BUTTON_COUNT; slot++) {
    pins[pinCount++] = Pins::BUTTONS[slot];
  }
  for (size_t slot = 0; slot < Pins::BUTTON_COUNT; slot++) {
    pins[pinCount++] = Pins::LAMPS[slot];
  }
  for (const int pin : fixedPins) pins[pinCount++] = pin;

  for (size_t first = 0; first < pinCount; first++) {
    if (pins[first] < 0) return false;
    for (size_t second = first + 1; second < pinCount; second++) {
      if (pins[first] == pins[second]) return false;
    }
  }
  return true;
}

void finishPlayback(size_t slot, bool completedSuccessfully) {
  if (slot >= Pins::BUTTON_COUNT) return;
  ButtonRuntime &button = buttons[slot];
  if (button.mode != ButtonMode::Playing) return;
  button.mode = completedSuccessfully
    ? (button.waitingCount > 0 ? ButtonMode::Waiting : ButtonMode::Idle)
    : ButtonMode::Waiting;
}

void playOldestMessage(size_t slot) {
  if (activeAudioSlot >= 0 || recipientKeys[slot].isEmpty() || !api.ready()) return;
  activeAudioSlot = static_cast<int>(slot);
  buttons[slot].mode = ButtonMode::Playing;

  // Play the batch that was waiting when the user pressed the button. Each
  // note is acknowledged before the next one is fetched, so a failure leaves
  // the failed note and everything after it safely waiting on the server.
  const unsigned int messagesToPlay = max(1U, buttons[slot].waitingCount);
  bool completed = true;
  unsigned int playedCount = 0;
  for (unsigned int index = 0; index < messagesToPlay; index++) {
    IncomingMessageRef message;
    const FusedPlaybackResult fusedResult = api.streamOldestPlaybackPcm(
      recipientKeys[slot],
      message,
      audio,
      playbackVolume,
      pumpPlaybackAndLamps
    );
    bool messageCompleted = fusedResult == FusedPlaybackResult::Completed;
    if (fusedResult == FusedPlaybackResult::Unsupported) {
      messageCompleted = api.fetchOldest(recipientKeys[slot], message)
        && api.streamPlaybackPcm(
        message.id,
        audio,
        playbackVolume,
        pumpPlaybackAndLamps
      );
    }
    if (messageCompleted) {
      messageCompleted = api.acknowledgePlayback(message.id, "played:" + message.id);
    }
    if (!messageCompleted) {
      completed = false;
      break;
    }
    playedCount++;
    api.pumpRealtime();
  }

  // Refresh after the whole batch so the lamp reflects any messages that
  // arrived while playback was in progress.
  api.fetchConfig();
  finishPlayback(slot, completed);
  activeAudioSlot = -1;
  if (completed) {
    Serial.printf(
      "Played %u queued message(s) for button %u.\n",
      playedCount,
      slot + 1
    );
  } else {
    Serial.printf(
      "Playback stopped after %u message(s) for button %u; remaining messages stay waiting.\n",
      playedCount,
      slot + 1
    );
  }
}

void attemptPendingUpload() {
  if (pendingUpload.recording.data == nullptr
      || millis() < pendingUpload.nextAttemptMs
      || !api.ready()) {
    return;
  }
  String deliveryState;
  const bool accepted = api.uploadRecording(
    pendingUpload.recipientKey,
    pendingUpload.idempotencyKey,
    pendingUpload.recording.data,
    pendingUpload.recording.length,
    deliveryState
  );
  if (!accepted) {
    pendingUpload.nextAttemptMs = millis() + UPLOAD_RETRY_INTERVAL_MS;
    Serial.println("Upload not accepted; retaining recording in PSRAM for retry.");
    return;
  }

  Serial.printf("Recording accepted with delivery state: %s\n", deliveryState.c_str());
  heap_caps_free(pendingUpload.recording.data);
  const size_t slot = pendingUpload.slot;
  pendingUpload = {};
  buttons[slot].mode = buttons[slot].waitingCount > 0
    ? ButtonMode::Waiting
    : ButtonMode::Idle;
}

void queueFinishedRecording(size_t slot) {
  pendingUpload.recording = audio.finishRecording();
  pendingUpload.recipientKey = recipientKeys[slot];
  pendingUpload.idempotencyKey = actionId("recording", slot);
  pendingUpload.slot = slot;
  pendingUpload.nextAttemptMs = millis();
  activeAudioSlot = -1;
  buttons[slot].mode = ButtonMode::Error;
  attemptPendingUpload();
}

void startRecording(size_t slot, unsigned long now) {
  if (activeAudioSlot >= 0
      || pendingUpload.recording.data != nullptr
      || recipientKeys[slot].isEmpty()
      || !api.ready()) {
    return;
  }
  if (!audio.startRecording(maximumRecordingMs)) {
    buttons[slot].mode = ButtonMode::Error;
    Serial.println("Could not allocate PSRAM recording buffer.");
    return;
  }
  activeAudioSlot = static_cast<int>(slot);
  buttons[slot].mode = ButtonMode::Recording;
  buttons[slot].recordingStartedMs = now;
  Serial.printf("Recording started for button %u.\n", slot + 1);
}

void handleButtonPressed(size_t slot, unsigned long now) {
  if (otaInProgress) return;
  ButtonRuntime &button = buttons[slot];
  if (button.mode == ButtonMode::Waiting && button.waitingCount > 0) {
    playOldestMessage(slot);
    return;
  }
  if (button.mode == ButtonMode::Idle) {
    startRecording(slot, now);
    return;
  }
}

void handleButtonReleased(size_t slot, unsigned long now) {
  ButtonRuntime &button = buttons[slot];
  if (button.mode != ButtonMode::Recording || activeAudioSlot != static_cast<int>(slot)) {
    return;
  }
  const unsigned long heldMs = now - button.recordingStartedMs;
  if (heldMs < minimumRecordingMs + RECORDING_CLICK_GUARD_MS) {
    audio.cancelRecording();
    activeAudioSlot = -1;
    button.mode = ButtonMode::Idle;
    Serial.printf("Recording cancelled for button %u: hold for at least %lu ms.\n",
      slot + 1, minimumRecordingMs + RECORDING_CLICK_GUARD_MS);
    return;
  }
  queueFinishedRecording(slot);
}

void sampleButton(size_t slot, bool rawPressed, unsigned long now) {
  ButtonRuntime &button = buttons[slot];
  if (rawPressed != button.rawPressed) {
    button.rawPressed = rawPressed;
    button.rawChangedMs = now;
    return;
  }
  if (rawPressed == button.stablePressed
      || now - button.rawChangedMs < DEBOUNCE_MS) {
    return;
  }
  button.stablePressed = rawPressed;
  if (button.stablePressed) {
    handleButtonPressed(slot, now);
  } else {
    handleButtonReleased(slot, now);
  }
}

bool playPendingNotificationChime(bool userInputActive) {
  if (otaInProgress) return false;
  if (!notificationChimes.takeIfIdle(activeAudioSlot >= 0 || userInputActive)) {
    return false;
  }
  if (!audio.playNotificationChime(chimeVolume, pumpRealtimeAndLamps)) {
    Serial.println("Arrival chime playback failed.");
  }
  return true;
}

bool attemptPendingFirmwareUpdate(bool userInputActive) {
  if (pendingFirmwareUpdate.updateId.isEmpty()
      || otaInProgress
      || !OtaPolicy::canStart(
        hardwareReady,
        activeAudioSlot >= 0,
        pendingUpload.recording.data != nullptr,
        userInputActive
      )) {
    return false;
  }
  otaInProgress = true;
  physicalLamps.allOff();
  Serial.printf(
    "Installing signed firmware update %s.\n",
    pendingFirmwareUpdate.updateId.c_str()
  );
  const bool installed = api.installFirmwareUpdate(
    pendingFirmwareUpdate,
    pumpRealtimeAndLamps
  );
  if (!installed) {
    Serial.println("Firmware update failed; continuing on the current image.");
    pendingFirmwareUpdate = {};
    otaInProgress = false;
  }
  return true;
}
}

extern "C" bool verifyRollbackLater() {
  return true;
}

void setup() {
  Serial.begin(115200);
  delay(250);
  physicalLamps.begin();
  // The fitted 12 V button lamps now carry all queue and recording status.
  // Keep the development board's RGB indicator dark during normal operation.
  neopixelWrite(Pins::BUILTIN_STATUS_RGB, 0, 0, 0);

  if (!pinsAreUnique()) {
    Serial.println("Fatal: pin map contains an unset or duplicate GPIO.");
    api.confirmRunningFirmware(false);
    return;
  }
  for (size_t slot = 0; slot < Pins::BUTTON_COUNT; slot++) {
    pinMode(Pins::BUTTONS[slot], INPUT_PULLUP);
    const bool pressed = digitalRead(Pins::BUTTONS[slot]) == LOW;
    buttons[slot].rawPressed = pressed;
    buttons[slot].stablePressed = pressed;
    buttons[slot].rawChangedMs = millis();
  }
  if (ESP.getFlashChipSize() < REQUIRED_FLASH_BYTES) {
    Serial.printf(
      "Fatal: expected the reference 16 MB N16R8 board; detected %u flash bytes.\n",
      static_cast<unsigned int>(ESP.getFlashChipSize())
    );
    api.confirmRunningFirmware(false);
    return;
  }
  if (!psramFound() || ESP.getPsramSize() < MIN_USABLE_PSRAM_BYTES) {
    Serial.printf(
      "Fatal: expected N16R8-class octal PSRAM; detected %u usable bytes.\n",
      static_cast<unsigned int>(ESP.getPsramSize())
    );
    api.confirmRunningFirmware(false);
    return;
  }
  if (!audio.begin()) {
    Serial.println("Fatal: I2S microphone/amplifier initialization failed.");
    api.confirmRunningFirmware(false);
    return;
  }
  hardwareReady = true;
  api.begin(handleServerEvent);
  api.confirmRunningFirmware(hardwareReady);
  Serial.printf(
    "Family Message Box ready. Flash: %u bytes; PSRAM: %u bytes; volume cap: %u%%; mic gain: %u%%; noise gate: %u%%.\n",
    static_cast<unsigned int>(ESP.getFlashChipSize()),
    static_cast<unsigned int>(ESP.getPsramSize()),
    static_cast<unsigned int>(MAX_PLAYBACK_VOLUME),
    static_cast<unsigned int>(microphoneGainPercent),
    static_cast<unsigned int>(microphoneNoiseGatePercent)
  );
  Serial.printf("Firmware identity: %s\n", FirmwareIdentity::MARKER);
}

void loop() {
  api.loop();
  const unsigned long now = millis();
  updateLamps(now);
  attemptPendingUpload();
  if (!hardwareReady) {
    delay(250);
    return;
  }

  if (pendingAutomaticPlayback && api.ready() && !recipientKeys[0].isEmpty()) {
    pendingAutomaticPlayback = false;
    Serial.println("Audio diagnostic: automatically playing the queued Button 1 message.");
    playOldestMessage(0);
    return;
  }

  bool userInputActive = false;
  for (size_t slot = 0; slot < Pins::BUTTON_COUNT; slot++) {
    const bool pressed = digitalRead(Pins::BUTTONS[slot]) == LOW;
    userInputActive = userInputActive || pressed;
    sampleButton(slot, pressed, now);
  }

  if (playPendingNotificationChime(userInputActive)) return;
  if (attemptPendingFirmwareUpdate(userInputActive)) return;

  if (activeAudioSlot >= 0
      && buttons[activeAudioSlot].mode == ButtonMode::Recording) {
    const unsigned long recordingElapsedMs =
      now - buttons[activeAudioSlot].recordingStartedMs;
    const bool bufferAvailable = recordingElapsedMs < RECORDING_CLICK_GUARD_MS
      ? audio.discardRecordingChunk()
      : audio.captureRecordingChunk();
    if (!bufferAvailable
        || recordingElapsedMs >= maximumRecordingMs + RECORDING_CLICK_GUARD_MS
        || recordingElapsedMs >= HARD_RECORDING_LIMIT_MS + RECORDING_CLICK_GUARD_MS) {
      queueFinishedRecording(static_cast<size_t>(activeAudioSlot));
    }
  }
}
