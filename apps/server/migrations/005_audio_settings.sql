ALTER TABLE settings ADD COLUMN microphone_gain_percent INTEGER NOT NULL DEFAULT 200
  CHECK (microphone_gain_percent BETWEEN 25 AND 400);

ALTER TABLE settings ADD COLUMN microphone_noise_gate_percent INTEGER NOT NULL DEFAULT 0
  CHECK (microphone_noise_gate_percent BETWEEN 0 AND 20);
