CREATE TABLE whatsapp_sessions (
  chat_id TEXT PRIMARY KEY,
  last_inbound_at TEXT NOT NULL
);

ALTER TABLE messages ADD COLUMN transport_mode TEXT;
