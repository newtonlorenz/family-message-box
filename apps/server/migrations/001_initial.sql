PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version TEXT PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  credential_hash TEXT NOT NULL,
  firmware_version TEXT,
  last_seen_at TEXT,
  battery_percent INTEGER,
  created_at TEXT NOT NULL
);

CREATE TABLE recipients (
  id TEXT PRIMARY KEY,
  recipient_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE chat_mappings (
  id TEXT PRIMARY KEY,
  recipient_id TEXT NOT NULL UNIQUE REFERENCES recipients(id) ON DELETE CASCADE,
  adapter TEXT NOT NULL DEFAULT 'mock',
  chat_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE button_slots (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 6),
  recipient_id TEXT REFERENCES recipients(id) ON DELETE SET NULL,
  label TEXT,
  PRIMARY KEY (device_id, slot)
);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  recipient_id TEXT NOT NULL REFERENCES recipients(id),
  direction TEXT NOT NULL CHECK (direction IN ('outgoing', 'incoming')),
  source_message_id TEXT,
  audio_path TEXT NOT NULL,
  original_mime TEXT NOT NULL,
  duration_ms INTEGER NOT NULL,
  delivery_state TEXT NOT NULL,
  playback_state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  available_after TEXT NOT NULL,
  delivered_at TEXT,
  played_at TEXT,
  error TEXT,
  idempotency_key TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(device_id, idempotency_key)
);

CREATE INDEX messages_queue ON messages(device_id, recipient_id, direction, playback_state, created_at);
CREATE INDEX messages_delivery ON messages(delivery_state, available_after);

CREATE TABLE settings (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  volume INTEGER NOT NULL DEFAULT 70 CHECK (volume BETWEEN 0 AND 100),
  min_duration_seconds INTEGER NOT NULL DEFAULT 3,
  max_duration_seconds INTEGER NOT NULL DEFAULT 30,
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  id TEXT PRIMARY KEY,
  device_id TEXT REFERENCES devices(id) ON DELETE SET NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  action TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE idempotency_actions (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL,
  action TEXT NOT NULL,
  response_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (device_id, idempotency_key, action)
);
