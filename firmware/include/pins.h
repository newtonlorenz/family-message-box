#pragma once

// Verified-safe logical allocation for the supported ESP32-S3
// DevKitC-1 N16R8 (Amazon ASIN B0CLD4QKT1).
// It avoids boot strapping pins (0, 3, 45, 46), native USB (19, 20),
// flash/PSRAM pins (26-37), UART0 (43, 44), and the RGB LED pin used by
// either DevKitC-1 board revision (38 or 48). GPIO39-42 are repurposed from
// external JTAG for buttons 7/8 and their ULN2803A lamp-control inputs.
namespace Pins {
constexpr size_t BUTTON_COUNT = 8;
constexpr int BUTTONS[BUTTON_COUNT] = {4, 5, 6, 7, 15, 16, 39, 40};
constexpr int LAMPS[BUTTON_COUNT] = {8, 9, 10, 11, 12, 13, 41, 42};

// INMP441 on I2S0 RX. Tie the microphone L/R pin to GND for the left slot.
constexpr int MIC_BCLK = 17;
constexpr int MIC_WS = 18;
constexpr int MIC_SD = 21;

// MAX98357A on I2S1 TX. Firmware duplicates mono samples into both slots.
constexpr int AMP_BCLK = 14;
constexpr int AMP_LRC = 47;
constexpr int AMP_DIN = 2;
constexpr int AMP_SD = 1;

// Built-in WS2812 status LED on the supported ESP32-S3 N16R8 board.
constexpr int BUILTIN_STATUS_RGB = 48;

// High enables a 3.3 V-compatible low-side driver for a 12 V button lamp.
// It does not power the lamp and must never connect to a lamp terminal.
constexpr bool LAMP_ACTIVE_HIGH = true;
}
