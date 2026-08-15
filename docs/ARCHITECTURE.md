# Architecture

The ESP32-S3 is a thin authenticated device client. It records and plays PCM
audio, reports button actions, retains failed uploads in PSRAM, and receives
typed WebSocket events. The Node.js server owns recipient assignments, queue
ordering, audio normalization, persistence, messaging adapters, and OTA package
validation. The browser admin uses the same server and includes a mock hardware
simulator.

SQLite and audio files live together under the configured data directory. The
messaging boundary is an adapter: mock mode is deterministic for development,
WhatsApp Web is an unofficial prototype, and Twilio uses signed webhooks and
authenticated media requests.

The physical and software contracts assume eight buttons, an ESP32-S3 N16R8,
16 kHz mono audio, active-high external lamp drivers, and authenticated device
requests. Changes to those contracts should update shared types, server tests,
native firmware tests, hardware documentation, and physical verification.
