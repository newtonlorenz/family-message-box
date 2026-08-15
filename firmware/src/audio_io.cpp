#include "audio_io.h"

#include <driver/i2s.h>
#include <esp_heap_caps.h>

#include "pins.h"

namespace {
constexpr i2s_port_t MIC_PORT = I2S_NUM_0;
constexpr i2s_port_t AMP_PORT = I2S_NUM_1;
constexpr uint32_t SAMPLE_RATE = 16000;
constexpr size_t MIC_DMA_SAMPLES = 256;
constexpr size_t PLAYER_MONO_SAMPLES = 256;
constexpr size_t CHIME_ATTACK_SAMPLES = SAMPLE_RATE * 25 / 1000;
constexpr size_t CHIME_RELEASE_SAMPLES = SAMPLE_RATE * 70 / 1000;

int16_t micSampleToPcm(int32_t sample, uint16_t gainPercent, uint8_t noiseGatePercent) {
  // INMP441 supplies a signed 24-bit sample in a 32-bit I2S slot. Convert its
  // most significant 16 bits, apply the optional gate, then scale and clamp.
  const int32_t pcm = sample >> 16;
  const int32_t gateThreshold = (static_cast<int32_t>(INT16_MAX) * noiseGatePercent) / 100;
  if (pcm >= -gateThreshold && pcm <= gateThreshold) return 0;
  int32_t scaled = (pcm * gainPercent) / 100;
  if (scaled > INT16_MAX) return INT16_MAX;
  if (scaled < INT16_MIN) return INT16_MIN;
  return static_cast<int16_t>(scaled);
}

float chimeEnvelope(size_t sampleOffset, size_t sampleCount) {
  float envelope = 1.0F;
  if (sampleOffset < CHIME_ATTACK_SAMPLES) {
    envelope = static_cast<float>(sampleOffset) / CHIME_ATTACK_SAMPLES;
  }
  const size_t remainingSamples = sampleCount - sampleOffset - 1;
  if (remainingSamples < CHIME_RELEASE_SAMPLES) {
    const float release = static_cast<float>(remainingSamples) / CHIME_RELEASE_SAMPLES;
    if (release < envelope) envelope = release;
  }
  return envelope;
}

bool writeChimeSegment(
  uint16_t frequencyHz,
  unsigned long durationMs,
  uint8_t volumePercent,
  void (*pump)()
) {
  const size_t sampleCount = static_cast<size_t>(SAMPLE_RATE) * durationMs / 1000;
  int16_t stereo[PLAYER_MONO_SAMPLES * 2];
  size_t sampleOffset = 0;
  while (sampleOffset < sampleCount) {
    const size_t chunkSamples = min(PLAYER_MONO_SAMPLES, sampleCount - sampleOffset);
    for (size_t index = 0; index < chunkSamples; index++) {
      const size_t noteSample = sampleOffset + index;
      const float phase = 2.0F * PI * frequencyHz * noteSample / SAMPLE_RATE;
      const float envelope = frequencyHz == 0
        ? 0.0F
        : chimeEnvelope(noteSample, sampleCount);
      const int16_t sample = static_cast<int16_t>(
        sinf(phase) * 12000.0F * volumePercent * envelope / 100.0F
      );
      stereo[index * 2] = sample;
      stereo[index * 2 + 1] = sample;
    }
    size_t bytesWritten = 0;
    const size_t bytesToWrite = chunkSamples * sizeof(stereo[0]) * 2;
    if (i2s_write(
      AMP_PORT,
      stereo,
      bytesToWrite,
      &bytesWritten,
      pdMS_TO_TICKS(1000)
    ) != ESP_OK
        || bytesWritten != bytesToWrite) {
      return false;
    }
    sampleOffset += chunkSamples;
    if (pump != nullptr) pump();
  }
  return true;
}

}

void AudioIO::setMicrophoneProcessing(uint16_t gainPercent, uint8_t noiseGatePercent) {
  microphoneGainPercent_ = static_cast<uint16_t>(constrain(gainPercent, 25, 400));
  microphoneNoiseGatePercent_ = static_cast<uint8_t>(constrain(noiseGatePercent, 0, 20));
}

bool AudioIO::begin() {
  pinMode(Pins::AMP_SD, OUTPUT);
  digitalWrite(Pins::AMP_SD, LOW);

  i2s_config_t micConfig = {};
  micConfig.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_RX);
  micConfig.sample_rate = SAMPLE_RATE;
  micConfig.bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT;
  micConfig.channel_format = I2S_CHANNEL_FMT_ONLY_LEFT;
  micConfig.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  micConfig.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  micConfig.dma_buf_count = 8;
  micConfig.dma_buf_len = MIC_DMA_SAMPLES;
  micConfig.use_apll = false;
  micConfig.tx_desc_auto_clear = false;
  micConfig.fixed_mclk = 0;

  i2s_pin_config_t micPins = {};
  micPins.mck_io_num = I2S_PIN_NO_CHANGE;
  micPins.bck_io_num = Pins::MIC_BCLK;
  micPins.ws_io_num = Pins::MIC_WS;
  micPins.data_out_num = I2S_PIN_NO_CHANGE;
  micPins.data_in_num = Pins::MIC_SD;

  if (i2s_driver_install(MIC_PORT, &micConfig, 0, nullptr) != ESP_OK) return false;
  if (i2s_set_pin(MIC_PORT, &micPins) != ESP_OK) return false;

  i2s_config_t ampConfig = {};
  ampConfig.mode = static_cast<i2s_mode_t>(I2S_MODE_MASTER | I2S_MODE_TX);
  ampConfig.sample_rate = SAMPLE_RATE;
  ampConfig.bits_per_sample = I2S_BITS_PER_SAMPLE_16BIT;
  ampConfig.channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT;
  ampConfig.communication_format = I2S_COMM_FORMAT_STAND_I2S;
  ampConfig.intr_alloc_flags = ESP_INTR_FLAG_LEVEL1;
  ampConfig.dma_buf_count = 8;
  ampConfig.dma_buf_len = PLAYER_MONO_SAMPLES;
  ampConfig.use_apll = false;
  ampConfig.tx_desc_auto_clear = true;
  ampConfig.fixed_mclk = 0;

  i2s_pin_config_t ampPins = {};
  ampPins.mck_io_num = I2S_PIN_NO_CHANGE;
  ampPins.bck_io_num = Pins::AMP_BCLK;
  ampPins.ws_io_num = Pins::AMP_LRC;
  ampPins.data_out_num = Pins::AMP_DIN;
  ampPins.data_in_num = I2S_PIN_NO_CHANGE;

  if (i2s_driver_install(AMP_PORT, &ampConfig, 0, nullptr) != ESP_OK) return false;
  if (i2s_set_pin(AMP_PORT, &ampPins) != ESP_OK) return false;
  i2s_zero_dma_buffer(AMP_PORT);
  return true;
}

bool AudioIO::startRecording(unsigned long maximumDurationMs) {
  cancelRecording();
  const size_t capacity = static_cast<size_t>(
    (static_cast<uint64_t>(SAMPLE_RATE) * 2 * maximumDurationMs) / 1000
  );
  recording_.data = static_cast<uint8_t *>(
    heap_caps_malloc(capacity, MALLOC_CAP_SPIRAM | MALLOC_CAP_8BIT)
  );
  if (recording_.data == nullptr) return false;
  recording_.capacity = capacity;
  recording_.length = 0;
  i2s_stop(MIC_PORT);
  i2s_start(MIC_PORT);
  return true;
}

bool AudioIO::discardRecordingChunk() {
  if (recording_.data == nullptr) return false;
  int32_t input[MIC_DMA_SAMPLES];
  size_t bytesRead = 0;
  const esp_err_t result = i2s_read(
    MIC_PORT,
    input,
    sizeof(input),
    &bytesRead,
    pdMS_TO_TICKS(20)
  );
  return result == ESP_OK || result == ESP_ERR_TIMEOUT;
}

bool AudioIO::captureRecordingChunk() {
  if (recording_.data == nullptr) return false;
  int32_t input[MIC_DMA_SAMPLES];
  size_t bytesRead = 0;
  const esp_err_t result = i2s_read(
    MIC_PORT,
    input,
    sizeof(input),
    &bytesRead,
    pdMS_TO_TICKS(20)
  );
  if (result != ESP_OK && result != ESP_ERR_TIMEOUT) return false;

  const size_t sampleCount = bytesRead / sizeof(int32_t);
  const size_t availableSamples = (recording_.capacity - recording_.length) / 2;
  const size_t samplesToCopy = min(sampleCount, availableSamples);
  auto *output = reinterpret_cast<int16_t *>(recording_.data + recording_.length);
  for (size_t index = 0; index < samplesToCopy; index++) {
    output[index] = micSampleToPcm(
      input[index],
      microphoneGainPercent_,
      microphoneNoiseGatePercent_
    );
  }
  recording_.length += samplesToCopy * 2;
  return sampleCount <= availableSamples;
}

PcmRecording AudioIO::finishRecording() {
  i2s_stop(MIC_PORT);
  PcmRecording result = recording_;
  recording_ = {};
  return result;
}

void AudioIO::cancelRecording() {
  if (recording_.data != nullptr) {
    heap_caps_free(recording_.data);
  }
  recording_ = {};
}

bool AudioIO::playMonoPcm(
  const uint8_t *data,
  size_t length,
  uint8_t volumePercent,
  void (*pump)()
) {
  if (!beginMonoPcmPlayback(volumePercent)) return false;
  const bool success = writeMonoPcmChunk(data, length);
  return finishMonoPcmPlayback(success, pump);
}

bool AudioIO::beginMonoPcmPlayback(uint8_t volumePercent) {
  if (playbackActive_) return false;
  i2s_zero_dma_buffer(AMP_PORT);
  digitalWrite(Pins::AMP_SD, HIGH);
  playbackVolumePercent_ = static_cast<uint8_t>(constrain(volumePercent, 0, 100));
  playbackActive_ = true;
  return true;
}

bool AudioIO::writeMonoPcmChunk(const uint8_t *data, size_t length) {
  if (!playbackActive_ || data == nullptr || length == 0 || length % 2 != 0) {
    return false;
  }
  int16_t stereo[PLAYER_MONO_SAMPLES * 2];
  const auto *mono = reinterpret_cast<const int16_t *>(data);
  const size_t totalSamples = length / 2;
  size_t sampleOffset = 0;

  while (sampleOffset < totalSamples) {
    const size_t chunkSamples = min(PLAYER_MONO_SAMPLES, totalSamples - sampleOffset);
    for (size_t index = 0; index < chunkSamples; index++) {
      const int32_t scaled = (
        static_cast<int32_t>(mono[sampleOffset + index]) * playbackVolumePercent_
      ) / 100;
      stereo[index * 2] = static_cast<int16_t>(scaled);
      stereo[index * 2 + 1] = static_cast<int16_t>(scaled);
    }
    size_t bytesWritten = 0;
    const size_t bytesToWrite = chunkSamples * 2 * sizeof(int16_t);
    if (i2s_write(
      AMP_PORT,
      stereo,
      bytesToWrite,
      &bytesWritten,
      pdMS_TO_TICKS(1000)
    ) != ESP_OK || bytesWritten != bytesToWrite) {
      return false;
    }
    sampleOffset += chunkSamples;
  }
  return true;
}

bool AudioIO::finishMonoPcmPlayback(
  bool completedSuccessfully,
  void (*pump)()
) {
  if (!playbackActive_) return false;
  // i2s_write returns once data is copied into DMA, not necessarily after the
  // final sample reaches the amplifier. Let the bounded DMA queue drain before
  // muting so the end of a message is never clipped.
  const unsigned long drainStartedMs = millis();
  while (completedSuccessfully && millis() - drainStartedMs < 200) {
    if (pump != nullptr) pump();
    delay(10);
  }
  i2s_zero_dma_buffer(AMP_PORT);
  digitalWrite(Pins::AMP_SD, LOW);
  playbackActive_ = false;
  playbackVolumePercent_ = 0;
  return completedSuccessfully;
}

bool AudioIO::playNotificationChime(uint8_t volumePercent, void (*pump)()) {
  if (volumePercent == 0) return true;
  i2s_zero_dma_buffer(AMP_PORT);
  digitalWrite(Pins::AMP_SD, HIGH);
  const bool success = writeChimeSegment(587, 140, volumePercent, pump)
    && writeChimeSegment(0, 35, volumePercent, pump)
    && writeChimeSegment(784, 210, volumePercent, pump);

  const unsigned long drainStartedMs = millis();
  while (success && millis() - drainStartedMs < 100) {
    if (pump != nullptr) pump();
    delay(10);
  }
  i2s_zero_dma_buffer(AMP_PORT);
  digitalWrite(Pins::AMP_SD, LOW);
  return success;
}

bool AudioIO::playTestTone(
  uint16_t frequencyHz,
  unsigned long durationMs,
  uint8_t volumePercent
) {
  if (frequencyHz == 0 || durationMs == 0) return false;
  const size_t sampleCount = static_cast<size_t>(SAMPLE_RATE) * durationMs / 1000;
  int16_t stereo[PLAYER_MONO_SAMPLES * 2];
  size_t sampleOffset = 0;
  i2s_zero_dma_buffer(AMP_PORT);
  digitalWrite(Pins::AMP_SD, HIGH);

  while (sampleOffset < sampleCount) {
    const size_t chunkSamples = min(PLAYER_MONO_SAMPLES, sampleCount - sampleOffset);
    for (size_t index = 0; index < chunkSamples; index++) {
      const float phase = 2.0F * PI * frequencyHz * (sampleOffset + index) / SAMPLE_RATE;
      const int16_t sample = static_cast<int16_t>(sinf(phase) * 12000.0F * volumePercent / 100.0F);
      stereo[index * 2] = sample;
      stereo[index * 2 + 1] = sample;
    }
    size_t bytesWritten = 0;
    const size_t bytesToWrite = chunkSamples * sizeof(stereo[0]) * 2;
    if (i2s_write(AMP_PORT, stereo, bytesToWrite, &bytesWritten, pdMS_TO_TICKS(1000)) != ESP_OK
        || bytesWritten != bytesToWrite) {
      i2s_zero_dma_buffer(AMP_PORT);
      digitalWrite(Pins::AMP_SD, LOW);
      return false;
    }
    sampleOffset += chunkSamples;
  }
  delay(200);
  i2s_zero_dma_buffer(AMP_PORT);
  digitalWrite(Pins::AMP_SD, LOW);
  return true;
}
