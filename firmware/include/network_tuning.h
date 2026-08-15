#pragma once

#include <stddef.h>

namespace NetworkTuning {

// The message box is mains powered. Keeping the station radio awake avoids
// modem wake-up latency when a button initiates an audio request.
constexpr bool DISABLE_WIFI_POWER_SAVE = true;
constexpr size_t PLAYBACK_NETWORK_CHUNK_BYTES = 512;
constexpr unsigned long PLAYBACK_STALL_TIMEOUT_MS = 10000;

}
