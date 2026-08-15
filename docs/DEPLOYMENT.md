# Deployment

## Local Docker demo

```bash
cp .env.example .env
docker compose up --build
```

The service binds to `127.0.0.1:8787` by default and uses the mock messaging
adapter. The named Docker volume retains SQLite data, audio, and adapter state.

## Private-LAN installation

1. Reserve a private address or hostname for the server.
2. Replace `DEVICE_BOOTSTRAP_TOKEN` in `.env` with a long random value.
3. Set `FAMILY_BOX_BIND_IP` and `ADMIN_ORIGIN` to that private address.
4. Keep the host firewall enabled and do not configure router port-forwarding.
5. Register each device once and store its returned credential in ESP32 NVS.
6. Back up the named volume and ignored `.env` separately and securely.

The deployment helper accepts an exact full commit already present on
`origin/main`:

```bash
FAMILY_BOX_HEALTH_URL=http://your-private-host:8787/api/health \
  scripts/deploy-live.sh <full-origin-main-commit-sha>
```

It refuses a dirty or non-`main` checkout, creates a consistent SQLite backup,
checks data invariants, builds an immutable image tag, waits for health, and
verifies that an eight-button device reconnects. Adapt the final hardware-online
gate if you are deploying a server without a physical box.

## Optional signed OTA

Run `node scripts/configure-firmware-ota.mjs` on a trusted build machine. It
creates ignored local keys and configuration without printing the admin token.
The OTA private key must never enter Docker, firmware, Git, or logs.

After `data/firmware-signing-public.pem` exists, enable its read-only mount:

```bash
docker compose -f compose.yaml -f compose.ota.yaml up --build
```

Use HTTPS for normal firmware updates. Plain HTTP requires the explicitly named
`ALLOW_INSECURE_LAN_OTA` override on both server and device and is only suitable
for a knowingly accepted isolated bench setup.
