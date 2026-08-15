CREATE TABLE button_slots_eight (
  device_id TEXT NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 8),
  recipient_id TEXT REFERENCES recipients(id) ON DELETE SET NULL,
  label TEXT,
  PRIMARY KEY (device_id, slot)
);

INSERT INTO button_slots_eight(device_id, slot, recipient_id, label)
SELECT device_id, slot, recipient_id, label FROM button_slots;

DROP TABLE button_slots;
ALTER TABLE button_slots_eight RENAME TO button_slots;

INSERT OR IGNORE INTO button_slots(device_id, slot)
SELECT id, 7 FROM devices;

INSERT OR IGNORE INTO button_slots(device_id, slot)
SELECT id, 8 FROM devices;
