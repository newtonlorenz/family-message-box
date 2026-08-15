#pragma once

#if __has_include("device_config.h")
#include "device_config.h"
#define CHATTER_BOX_HAS_DEVICE_CONFIG 1
#else
#define CHATTER_BOX_HAS_DEVICE_CONFIG 0
namespace DeviceConfig {
constexpr char WIFI_SSID[] = "";
constexpr char WIFI_PASSWORD[] = "";
constexpr char API_HOST[] = "";
constexpr unsigned short API_PORT = 0;
constexpr bool API_TLS = false;
constexpr char DEVICE_ID[] = "family-box-01";
constexpr char BOOTSTRAP_TOKEN[] = "";
constexpr char DEVICE_CREDENTIAL[] = "";
constexpr char ROOT_CA_PEM[] = "";
constexpr bool ALLOW_INSECURE_LAN_OTA = false;
constexpr char FIRMWARE_SIGNING_PUBLIC_KEY_PEM[] = "";
}
#endif
