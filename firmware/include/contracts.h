#pragma once

// Wire contracts mirror packages/contracts/src/index.ts.
// JSON messages received over /api/device/events:
// config.updated, queue.updated, message.available, settings.updated, server.error
// HTTP and WebSocket upgrade headers on every device connection/action:
// X-Device-Id, X-Device-Credential, Idempotency-Key

enum class ButtonMode { Idle, Recording, Waiting, Playing, Error };

struct ButtonRuntime {
  ButtonMode mode = ButtonMode::Idle;
  unsigned long recordingStartedMs = 0;
  unsigned long rawChangedMs = 0;
  unsigned int waitingCount = 0;
  bool rawPressed = false;
  bool stablePressed = false;
};

// Required V1 behaviour: the matching physical button flashes while one or
// more messages from that person are waiting. It stops only when that person's
// waiting count reaches zero. The reference B01N549IDL buttons have
// confirmed, electrically separate 12 V LED terminals; this boundary controls
// external 3.3 V-compatible low-side driver inputs only. It never drives an LED
// load from an ESP32 pin.
class LampDriver {
 public:
  virtual void setWaiting(size_t slot, bool illuminated) = 0;
  virtual void allOff() = 0;
  virtual ~LampDriver() = default;
};
