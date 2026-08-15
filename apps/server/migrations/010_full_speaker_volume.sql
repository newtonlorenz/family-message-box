CREATE TABLE settings_full_speaker_volume (
  device_id TEXT PRIMARY KEY REFERENCES devices(id) ON DELETE CASCADE,
  volume INTEGER NOT NULL DEFAULT 60 CHECK (volume BETWEEN 0 AND 100),
  min_duration_seconds INTEGER NOT NULL DEFAULT 3,
  max_duration_seconds INTEGER NOT NULL DEFAULT 30,
  quiet_hours_start TEXT,
  quiet_hours_end TEXT,
  timezone TEXT NOT NULL DEFAULT 'Europe/Madrid',
  updated_at TEXT NOT NULL,
  microphone_gain_percent INTEGER NOT NULL DEFAULT 200
    CHECK (microphone_gain_percent BETWEEN 25 AND 400),
  microphone_noise_gate_percent INTEGER NOT NULL DEFAULT 0
    CHECK (microphone_noise_gate_percent BETWEEN 0 AND 20),
  chime_volume INTEGER NOT NULL DEFAULT 60
    CHECK (chime_volume BETWEEN 0 AND 100)
);

INSERT INTO settings_full_speaker_volume(
  device_id,
  volume,
  min_duration_seconds,
  max_duration_seconds,
  quiet_hours_start,
  quiet_hours_end,
  timezone,
  updated_at,
  microphone_gain_percent,
  microphone_noise_gate_percent,
  chime_volume
)
SELECT
  device_id,
  volume,
  min_duration_seconds,
  max_duration_seconds,
  quiet_hours_start,
  quiet_hours_end,
  timezone,
  updated_at,
  microphone_gain_percent,
  microphone_noise_gate_percent,
  chime_volume
FROM settings;

DROP TABLE settings;
ALTER TABLE settings_full_speaker_volume RENAME TO settings;
