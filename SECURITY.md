# Security policy

## Reporting a vulnerability

Please do not open a public issue for a vulnerability. Use GitHub's private
vulnerability reporting feature when available, or contact a maintainer
privately through their public GitHub profile. Include affected versions,
reproduction steps, impact, and any suggested mitigation.

Do not include real credentials, phone numbers, message audio, private network
details, or live database content in a report. Use synthetic fixtures.

## Deployment boundary

The admin and device API are designed for loopback or a trusted private LAN and
do not provide general user authentication. Do not expose them to the internet.
Only a messaging provider's narrowly scoped webhook may be placed behind a
public HTTPS endpoint.

Keep `.env`, Wi-Fi settings, device credentials, WhatsApp sessions, live data,
TLS private keys, and OTA private signing keys outside Git. OTA private keys
belong on a trusted build machine; devices and servers receive only the public
key and signed packages.
