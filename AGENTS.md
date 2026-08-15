# Repository guidance

These rules apply to humans and coding agents working in this repository.

## Workflow

- Keep `main` reproducible and use focused pull requests.
- Use Conventional Commit subjects.
- Preserve compatibility for persisted device IDs, SQLite data, and firmware
  protocol fields unless a documented migration is included.
- Treat tests, builds, containers, deployed software, and physical hardware as
  distinct evidence.

## Required verification

- Run `npm ci`, `npm run verify`, and `npm audit --audit-level=high`.
- Firmware changes require
  `pio run -d firmware -e esp32-s3-wroom-1-n16r8`.
- CAD changes require `./firmware/enclosure/export.sh` and
  `node firmware/enclosure/validate_exports.mjs`.

## Security and privacy

- Validate inputs at system boundaries and use parameterized database queries.
- Never commit credentials, phone numbers, Wi-Fi settings, `.env`, live data,
  message audio, WhatsApp sessions, private keys, faces, or private topology.
- Keep OTA private signing keys off the device and server; only the public key
  and signed packages may be deployed.
- The admin/API listener is private-LAN only until authentication is added. Do
  not document or add router port-forwarding for it.
- Never replace a live database, erase a Docker volume, or prune live resources
  as part of a routine deployment.

## Generated artifacts

- Commit CAD source, documented STL exports, Cura profiles, previews, and a
  freshness manifest.
- Do not commit machine/material-specific G-code.
- Do not commit generated firmware packages or build directories.
