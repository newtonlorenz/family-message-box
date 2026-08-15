#pragma once

#include <Arduino.h>

// Bench-only controls. Keep production behaviour conservative: the server's
// Settings screen owns the live digital playback volume.
namespace AudioTuning {

constexpr uint8_t DEFAULT_PLAYBACK_VOLUME_PERCENT = 60;

// Enable only for a supervised bench replay. This never creates or retries a
// WhatsApp delivery; it only consumes a message that is already waiting.
constexpr bool AUTO_PLAY_BUTTON_ONE_ON_BOOT = false;

// Documentation of the physical MAX98357A GAIN pin configuration. This is not
// software-controllable on the current wiring; changing it requires a resistor
// or direct connection at the amplifier breakout.
constexpr uint8_t MAX98357A_HARDWARE_GAIN_DB = 9;

// Full digital range. The live volume remains adjustable in the admin Settings
// screen without reflashing the ESP32; loud source audio can distort at 100%.
constexpr uint8_t MAX_DIGITAL_PLAYBACK_VOLUME_PERCENT = 100;

static_assert(
  DEFAULT_PLAYBACK_VOLUME_PERCENT <= MAX_DIGITAL_PLAYBACK_VOLUME_PERCENT,
  "Default playback volume must not exceed the speaker safety limit."
);

}  // namespace AudioTuning
