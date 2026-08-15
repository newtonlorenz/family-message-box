#pragma once

#include <cstdint>

namespace FirmwareIdentity {
constexpr char VERSION[] = "1.5.1-reliable-playback";
constexpr uint32_t BUILD = 10501;
constexpr char TARGET[] = "esp32-s3-wroom-1-n16r8";
constexpr char MARKER[] =
  "FAMILY_MESSAGE_BOX_OTA_V1|target=esp32-s3-wroom-1-n16r8|version=1.5.1-reliable-playback|build=10501|END";
}
