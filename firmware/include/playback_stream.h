#pragma once

#include <stddef.h>
#include <stdint.h>
#include <string.h>

namespace PlaybackStream {

constexpr size_t BUFFER_BYTES = 1024;
using ChunkSink = bool (*)(const uint8_t *data, size_t length, void *context);

enum class FailureReason {
  None,
  InvalidResponse,
  AudioStartFailed,
  SinkWriteFailed,
  StreamDisconnected,
  StreamStalled,
  InvalidPcm,
  AudioFinishFailed
};

inline const char *failureReasonName(FailureReason reason) {
  switch (reason) {
    case FailureReason::None: return "none";
    case FailureReason::InvalidResponse: return "invalid_response";
    case FailureReason::AudioStartFailed: return "audio_start_failed";
    case FailureReason::SinkWriteFailed: return "sink_write_failed";
    case FailureReason::StreamDisconnected: return "stream_disconnected";
    case FailureReason::StreamStalled: return "stream_stalled";
    case FailureReason::InvalidPcm: return "invalid_pcm";
    case FailureReason::AudioFinishFailed: return "audio_finish_failed";
  }
  return "invalid_response";
}

class TransferProgress {
 public:
  TransferProgress(size_t expectedBytes, unsigned long startedMs)
    : expectedBytes_(expectedBytes), lastProgressMs_(startedMs) {}

  void recordRead(size_t bytes, unsigned long nowMs) {
    receivedBytes_ += bytes;
    lastProgressMs_ = nowMs;
  }

  FailureReason idleFailure(
    bool connected,
    unsigned long nowMs,
    unsigned long timeoutMs
  ) const {
    if (!connected) return FailureReason::StreamDisconnected;
    return nowMs - lastProgressMs_ > timeoutMs
      ? FailureReason::StreamStalled
      : FailureReason::None;
  }

  bool complete() const { return receivedBytes_ == expectedBytes_; }
  size_t receivedBytes() const { return receivedBytes_; }

 private:
  const size_t expectedBytes_;
  size_t receivedBytes_ = 0;
  unsigned long lastProgressMs_;
};

class PcmChunkBuffer {
 public:
  bool append(
    const uint8_t *input,
    size_t length,
    ChunkSink sink,
    void *context
  ) {
    if ((input == nullptr && length > 0) || sink == nullptr || failed_) {
      failed_ = true;
      return false;
    }
    size_t offset = 0;
    while (offset < length) {
      const size_t available = BUFFER_BYTES - buffered_;
      const size_t remaining = length - offset;
      const size_t copied = remaining < available ? remaining : available;
      memcpy(buffer_ + buffered_, input + offset, copied);
      buffered_ += copied;
      offset += copied;
      if (buffered_ == BUFFER_BYTES && !flush(sink, context)) return false;
    }
    return true;
  }

  bool finish(ChunkSink sink, void *context) {
    if (sink == nullptr || failed_ || (buffered_ % 2) != 0) {
      failed_ = true;
      return false;
    }
    return buffered_ == 0 || flush(sink, context);
  }

 private:
  bool flush(ChunkSink sink, void *context) {
    if (buffered_ == 0) return true;
    if (!sink(buffer_, buffered_, context)) {
      failed_ = true;
      return false;
    }
    buffered_ = 0;
    return true;
  }

  uint8_t buffer_[BUFFER_BYTES] = {};
  size_t buffered_ = 0;
  bool failed_ = false;
};

}
