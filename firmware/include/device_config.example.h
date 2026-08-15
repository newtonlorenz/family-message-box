#pragma once

// Copy this file to device_config.h. That file is ignored by Git.
// The server credential is returned once during first registration and is
// persisted in ESP32 NVS. After successful registration, clear
// BOOTSTRAP_TOKEN and reflash; normal uploads preserve NVS.
namespace DeviceConfig {
constexpr char WIFI_SSID[] = "replace-me";
constexpr char WIFI_PASSWORD[] = "replace-me";

// Use the server's private-LAN hostname or a reserved DHCP address.
constexpr char API_HOST[] = "message-box.local";
constexpr unsigned short API_PORT = 8787;
constexpr bool API_TLS = false;

constexpr char DEVICE_ID[] = "family-box-01";
constexpr char BOOTSTRAP_TOKEN[] = "replace-with-long-bootstrap-token";

// Optional recovery path for an already registered device. Prefer leaving this
// empty and allowing first boot to store the returned credential in NVS.
constexpr char DEVICE_CREDENTIAL[] = "";

// Required when API_TLS is true. Paste the PEM root CA, not the server key.
constexpr char ROOT_CA_PEM[] = R"PEM(
)PEM";

// Firmware updates should use the same pinned HTTPS connection. Set this true
// only for an explicitly accepted trusted-LAN development setup.
constexpr bool ALLOW_INSECURE_LAN_OTA = false;

// Public ECDSA P-256 key used to verify signed firmware manifests. The private
// signing key must stay off the ESP32 and out of this repository.
constexpr char FIRMWARE_SIGNING_PUBLIC_KEY_PEM[] = R"PEM(
)PEM";
}
