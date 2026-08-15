#pragma once

// Alternate-pin template. The checked-in pins.h targets the supported ESP32-S3
// ESP32-S3-DevKitC-1 N16R8 with octal PSRAM.

namespace Pins {
constexpr size_t BUTTON_COUNT = 8;
constexpr int BUTTONS[BUTTON_COUNT] = {-1, -1, -1, -1, -1, -1, -1, -1};
constexpr int LAMPS[BUTTON_COUNT] = {-1, -1, -1, -1, -1, -1, -1, -1};
constexpr int MIC_BCLK = -1;
constexpr int MIC_WS = -1;
constexpr int MIC_SD = -1;
constexpr int AMP_BCLK = -1;
constexpr int AMP_LRC = -1;
constexpr int AMP_DIN = -1;
constexpr int AMP_SD = -1;
constexpr bool LAMP_ACTIVE_HIGH = true;
}

// Never connect an arcade lamp directly to these pins. LAMPS drive only the
// 3.3 V logic inputs of a verified low-side MOSFET/driver stage.
