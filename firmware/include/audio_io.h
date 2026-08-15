#pragma once

#include <Arduino.h>

struct PcmRecording {
  uint8_t *data = nullptr;
  size_t length = 0;
  size_t capacity = 0;
};

class AudioIO {
 public:
  bool begin();
  void setMicrophoneProcessing(uint16_t gainPercent, uint8_t noiseGatePercent);
  bool startRecording(unsigned long maximumDurationMs);
  bool discardRecordingChunk();
  bool captureRecordingChunk();
  PcmRecording finishRecording();
  void cancelRecording();
  bool isRecording() const { return recording_.data != nullptr; }

  bool beginMonoPcmPlayback(uint8_t volumePercent);
  bool writeMonoPcmChunk(const uint8_t *data, size_t length);
  bool finishMonoPcmPlayback(bool completedSuccessfully, void (*pump)());
  bool playMonoPcm(
    const uint8_t *data,
    size_t length,
    uint8_t volumePercent,
    void (*pump)()
  );
  bool playNotificationChime(uint8_t volumePercent, void (*pump)());
  bool playTestTone(uint16_t frequencyHz, unsigned long durationMs, uint8_t volumePercent);

 private:
  PcmRecording recording_;
  uint16_t microphoneGainPercent_ = 200;
  uint8_t microphoneNoiseGatePercent_ = 0;
  uint8_t playbackVolumePercent_ = 0;
  bool playbackActive_ = false;
};
