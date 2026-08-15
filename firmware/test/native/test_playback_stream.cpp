#include <assert.h>
#include <stddef.h>
#include <stdint.h>

#include <vector>

#include "playback_stream.h"

namespace {

struct SinkState {
  std::vector<uint8_t> bytes;
  size_t sourceBytesAtFirstWrite = 0;
  size_t sourceBytesRead = 0;
};

bool collect(const uint8_t *data, size_t length, void *context) {
  auto &state = *static_cast<SinkState *>(context);
  if (state.sourceBytesAtFirstWrite == 0) {
    state.sourceBytesAtFirstWrite = state.sourceBytesRead;
  }
  state.bytes.insert(state.bytes.end(), data, data + length);
  return true;
}

}

int main() {
  PlaybackStream::TransferProgress progress(128000, 1000);
  assert(progress.receivedBytes() == 0);
  assert(progress.idleFailure(true, 10999, 10000)
    == PlaybackStream::FailureReason::None);
  assert(progress.idleFailure(true, 11001, 10000)
    == PlaybackStream::FailureReason::StreamStalled);
  assert(progress.idleFailure(false, 1001, 10000)
    == PlaybackStream::FailureReason::StreamDisconnected);
  progress.recordRead(32768, 12000);
  assert(progress.receivedBytes() == 32768);
  assert(progress.idleFailure(true, 21999, 10000)
    == PlaybackStream::FailureReason::None);
  assert(progress.idleFailure(true, 22001, 10000)
    == PlaybackStream::FailureReason::StreamStalled);
  assert(strcmp(
    PlaybackStream::failureReasonName(
      PlaybackStream::FailureReason::StreamDisconnected
    ),
    "stream_disconnected"
  ) == 0);

  constexpr size_t totalBytes = 466240;
  std::vector<uint8_t> input(totalBytes);
  for (size_t index = 0; index < input.size(); index++) {
    input[index] = static_cast<uint8_t>(index % 251);
  }

  PlaybackStream::PcmChunkBuffer buffer;
  SinkState state;
  const size_t networkChunks[] = { 17, 509, 3, 512, 71, 511, 256 };
  size_t offset = 0;
  size_t chunkIndex = 0;
  while (offset < input.size()) {
    const size_t requested = networkChunks[
      chunkIndex++ % (sizeof(networkChunks) / sizeof(networkChunks[0]))
    ];
    const size_t length = requested < input.size() - offset
      ? requested
      : input.size() - offset;
    state.sourceBytesRead += length;
    assert(buffer.append(input.data() + offset, length, collect, &state));
    offset += length;
  }
  assert(buffer.finish(collect, &state));

  assert(state.bytes == input);
  assert(state.sourceBytesAtFirstWrite > 0);
  assert(state.sourceBytesAtFirstWrite < totalBytes);
  assert(state.sourceBytesAtFirstWrite <= PlaybackStream::BUFFER_BYTES + 512);
  assert(PlaybackStream::BUFFER_BYTES <= 4096);

  PlaybackStream::PcmChunkBuffer oddBuffer;
  SinkState oddState;
  const uint8_t oddBytes[] = { 1, 2, 3 };
  oddState.sourceBytesRead = sizeof(oddBytes);
  assert(oddBuffer.append(oddBytes, sizeof(oddBytes), collect, &oddState));
  assert(!oddBuffer.finish(collect, &oddState));

  PlaybackStream::PcmChunkBuffer rejectedBuffer;
  const uint8_t evenBytes[] = { 1, 2 };
  assert(rejectedBuffer.append(
    evenBytes,
    sizeof(evenBytes),
    [](const uint8_t *, size_t, void *) { return false; },
    nullptr
  ));
  assert(!rejectedBuffer.finish(
    [](const uint8_t *, size_t, void *) { return false; },
    nullptr
  ));
}
