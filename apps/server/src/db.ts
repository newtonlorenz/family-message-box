import fs from "node:fs";
import path from "node:path";
import { createHash, timingSafeEqual } from "node:crypto";
import Database from "better-sqlite3";

export type Db = Database.Database;

const now = () => new Date().toISOString();

export function openDatabase(databasePath: string): Db {
  if (databasePath !== ":memory:") fs.mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
  const db = new Database(databasePath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  return db;
}

export function migrate(db: Db): void {
  const migrationDir = path.resolve(import.meta.dirname, "../migrations");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  for (const file of fs.readdirSync(migrationDir).filter((name) => name.endsWith(".sql")).sort()) {
    const applied = db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?").get(file);
    if (applied) continue;
    const sql = fs.readFileSync(path.join(migrationDir, file), "utf8");
    db.transaction(() => {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(file, now());
    })();
  }
}

export function seedDevice(db: Db, id = "family-box-01", credential = "dev-device-secret"): void {
  const timestamp = now();
  db.prepare(
    "INSERT OR IGNORE INTO devices(id,name,credential_hash,created_at) VALUES (?,?,?,?)"
  ).run(id, "Family Message Box", createHash("sha256").update(credential).digest("hex"), timestamp);
  db.prepare(
    "INSERT OR IGNORE INTO settings(device_id,volume,updated_at) VALUES (?,60,?)"
  ).run(id, timestamp);
  for (let slot = 1; slot <= 8; slot++) {
    db.prepare("INSERT OR IGNORE INTO button_slots(device_id,slot) VALUES (?,?)").run(id, slot);
  }
}

export function audit(
  db: Db,
  action: string,
  entityType: string,
  entityId: string | null,
  deviceId: string | null,
  detail: Record<string, unknown> = {}
): void {
  db.prepare(
    "INSERT INTO audit_events(id,device_id,entity_type,entity_id,action,detail_json,created_at) VALUES (lower(hex(randomblob(16))),?,?,?,?,?,?)"
  ).run(deviceId, entityType, entityId, action, JSON.stringify(detail), now());
}

export function verifyDevice(db: Db, deviceId: string, credential: string): boolean {
  const row = db.prepare("SELECT credential_hash FROM devices WHERE id=?").get(deviceId) as { credential_hash: string } | undefined;
  if (!row) return false;
  return verifySecret(row.credential_hash, createHash("sha256").update(credential).digest("hex"));
}

export function verifySecret(expected: string, actual: string): boolean {
  const expectedBytes = Buffer.from(expected);
  const actualBytes = Buffer.from(actual);
  return expectedBytes.length === actualBytes.length && timingSafeEqual(expectedBytes, actualBytes);
}
