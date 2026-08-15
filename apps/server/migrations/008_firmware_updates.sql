CREATE TABLE firmware_updates (
  id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target = 'esp32-s3-wroom-1-n16r8'),
  version TEXT NOT NULL,
  build INTEGER NOT NULL CHECK (build > 0),
  size_bytes INTEGER NOT NULL CHECK (size_bytes BETWEEN 24 AND 6553600),
  sha256 TEXT NOT NULL,
  signature TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (
    state IN (
      'staged', 'downloading', 'installing', 'rebooting',
      'succeeded', 'failed', 'rolled_back', 'superseded'
    )
  ),
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX firmware_updates_device_created
  ON firmware_updates(device_id, created_at DESC);

CREATE UNIQUE INDEX firmware_updates_one_active_per_device
  ON firmware_updates(device_id)
  WHERE state IN ('staged', 'downloading', 'installing', 'rebooting');
