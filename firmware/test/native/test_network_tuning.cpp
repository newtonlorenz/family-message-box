#include <assert.h>

#include "network_tuning.h"

int main() {
  assert(NetworkTuning::DISABLE_WIFI_POWER_SAVE);
  assert(NetworkTuning::PLAYBACK_NETWORK_CHUNK_BYTES == 512);
  assert(NetworkTuning::PLAYBACK_STALL_TIMEOUT_MS == 10000);
}
