#!/usr/bin/env sh
set -eu

repo_root=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$repo_root"

if [ ! -f .env ]; then
  cp .env.example .env
  echo "Created .env from .env.example. Replace placeholder tokens before LAN or provider use."
fi

npm ci
npm run privacy:scan

cat <<'EOF'

Setup complete.

Try the local mock app:
  npm run dev

Run the full software verification suite:
  npm run verify

Build the firmware when PlatformIO is installed:
  pio run -d firmware -e esp32-s3-wroom-1-n16r8

Rebuild printable enclosure exports after CAD changes:
  ./firmware/enclosure/export.sh
  node firmware/enclosure/validate_exports.mjs
EOF
