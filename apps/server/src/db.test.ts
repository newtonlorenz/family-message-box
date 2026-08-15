import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDatabase, seedDevice, type Db } from "./db.js";

let db: Db;

function applyMigrationsBeforeVolumeDefault(database: Db): void {
  const migrationDir = path.resolve(import.meta.dirname, "../migrations");
  const files = fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql") && name < "007_")
    .sort();

  for (const file of files) {
    database.exec(fs.readFileSync(path.join(migrationDir, file), "utf8"));
    database
      .prepare(
        "INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)",
      )
      .run(file, "2026-08-07T00:00:00.000Z");
  }
}

function applyMigrationsBeforeChimeVolume(database: Db): void {
  const migrationDir = path.resolve(import.meta.dirname, "../migrations");
  const files = fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql") && name < "009_")
    .sort();

  for (const file of files) {
    database.exec(fs.readFileSync(path.join(migrationDir, file), "utf8"));
    database
      .prepare(
        "INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)",
      )
      .run(file, "2026-08-07T00:00:00.000Z");
  }
}

function applyMigrationsBeforeFullVolume(database: Db): void {
  const migrationDir = path.resolve(import.meta.dirname, "../migrations");
  const files = fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql") && name < "010_")
    .sort();

  for (const file of files) {
    database.exec(fs.readFileSync(path.join(migrationDir, file), "utf8"));
    database
      .prepare(
        "INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)",
      )
      .run(file, "2026-08-07T00:00:00.000Z");
  }
}

function applyMigrationsBeforeConfirmationUnknown(database: Db): void {
  const migrationDir = path.resolve(import.meta.dirname, "../migrations");
  const files = fs
    .readdirSync(migrationDir)
    .filter((name) => name.endsWith(".sql") && name < "011_")
    .sort();

  for (const file of files) {
    database.exec(fs.readFileSync(path.join(migrationDir, file), "utf8"));
    database
      .prepare(
        "INSERT INTO schema_migrations(version,applied_at) VALUES (?,?)",
      )
      .run(file, "2026-08-14T00:00:00.000Z");
  }
}

beforeEach(() => {
  db = openDatabase(":memory:");
});

afterEach(() => {
  db.close();
});

describe("playback volume default migration", () => {
  it("sets sixty as the database default without overwriting a saved seventy", () => {
    applyMigrationsBeforeVolumeDefault(db);
    db.prepare(
      "INSERT INTO devices(id,name,credential_hash,created_at) VALUES (?,?,?,?)",
    ).run("untouched", "Untouched", "hash-1", "created-at");
    db.prepare(
      "INSERT INTO devices(id,name,credential_hash,created_at) VALUES (?,?,?,?)",
    ).run("saved", "Saved", "hash-2", "created-at");
    db.prepare(
      "INSERT INTO settings(device_id,volume,updated_at) VALUES (?,?,?)",
    ).run("untouched", 70, "created-at");
    db.prepare(
      "INSERT INTO settings(device_id,volume,updated_at) VALUES (?,?,?)",
    ).run("saved", 70, "saved-later");

    migrate(db);

    expect(
      db.prepare("SELECT volume FROM settings WHERE device_id=?").get(
        "untouched",
      ),
    ).toEqual({ volume: 60 });
    expect(
      db.prepare("SELECT volume FROM settings WHERE device_id=?").get("saved"),
    ).toEqual({ volume: 70 });
    const volumeColumn = (
      db.pragma("table_info(settings)") as Array<{
        name: string;
        dflt_value: string | null;
      }>
    ).find(({ name }) => name === "volume");
    expect(volumeColumn?.dflt_value).toBe("60");
    expect(db.pragma("foreign_key_check")).toEqual([]);

    migrate(db);
    seedDevice(db, "new-device", "new-device-secret");
    expect(
      db.prepare("SELECT volume FROM settings WHERE device_id=?").get(
        "new-device",
      ),
    ).toEqual({ volume: 60 });
  });
});

describe("chime volume migration", () => {
  it("adds an independent sixty-percent default without changing live playback settings", () => {
    applyMigrationsBeforeChimeVolume(db);
    seedDevice(db, "existing", "existing-secret");
    db.prepare("UPDATE settings SET volume=80 WHERE device_id=?").run(
      "existing",
    );

    migrate(db);

    expect(
      db.prepare(
        "SELECT volume,chime_volume FROM settings WHERE device_id=?",
      ).get("existing"),
    ).toEqual({ volume: 80, chime_volume: 60 });
    const chimeColumn = (
      db.pragma("table_info(settings)") as Array<{
        name: string;
        dflt_value: string | null;
      }>
    ).find(({ name }) => name === "chime_volume");
    expect(chimeColumn?.dflt_value).toBe("60");
    expect(db.pragma("foreign_key_check")).toEqual([]);

    migrate(db);
    seedDevice(db, "new-device", "new-device-secret");
    expect(
      db.prepare("SELECT chime_volume FROM settings WHERE device_id=?").get(
        "new-device",
      ),
    ).toEqual({ chime_volume: 60 });
  });
});

describe("full speaker volume migration", () => {
  it("allows both speaker settings to reach one hundred without changing saved values", () => {
    applyMigrationsBeforeFullVolume(db);
    seedDevice(db, "existing", "existing-secret");
    db.prepare(
      `UPDATE settings SET
        volume=80,
        chime_volume=60,
        microphone_gain_percent=350,
        microphone_noise_gate_percent=12,
        min_duration_seconds=2,
        max_duration_seconds=90,
        quiet_hours_start='22:00',
        quiet_hours_end='07:00',
        timezone='UTC',
        updated_at='saved-later'
      WHERE device_id=?`,
    ).run("existing");

    migrate(db);
    db.prepare(
      "UPDATE settings SET volume=100,chime_volume=100 WHERE device_id=?",
    ).run("existing");

    expect(
      db.prepare(
        `SELECT
          volume,
          chime_volume,
          microphone_gain_percent,
          microphone_noise_gate_percent,
          min_duration_seconds,
          max_duration_seconds,
          quiet_hours_start,
          quiet_hours_end,
          timezone,
          updated_at
        FROM settings WHERE device_id=?`,
      ).get("existing"),
    ).toEqual({
      volume: 100,
      chime_volume: 100,
      microphone_gain_percent: 350,
      microphone_noise_gate_percent: 12,
      min_duration_seconds: 2,
      max_duration_seconds: 90,
      quiet_hours_start: "22:00",
      quiet_hours_end: "07:00",
      timezone: "UTC",
      updated_at: "saved-later",
    });
    const columns = db.pragma("table_info(settings)") as Array<{
      name: string;
      dflt_value: string | null;
    }>;
    expect(columns.find(({ name }) => name === "volume")?.dflt_value).toBe(
      "60",
    );
    expect(
      columns.find(({ name }) => name === "chime_volume")?.dflt_value,
    ).toBe("60");
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});

describe("unknown delivery confirmation migration", () => {
  it("reclassifies only the known ambiguous WhatsApp result", () => {
    applyMigrationsBeforeConfirmationUnknown(db);
    seedDevice(db, "existing", "existing-secret");
    const timestamp = "2026-08-14T00:00:00.000Z";
    db.prepare(
      "INSERT INTO recipients(id,recipient_key,display_name,created_at,updated_at) VALUES (?,?,?,?,?)",
    ).run("recipient-1", "gran", "Gran", timestamp, timestamp);
    const insert = db.prepare(
      `INSERT INTO messages(
        id,device_id,recipient_id,direction,audio_path,original_mime,duration_ms,
        delivery_state,playback_state,available_after,error,created_at,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    );
    insert.run(
      "ambiguous",
      "existing",
      "recipient-1",
      "outgoing",
      "/audio/ambiguous.ogg",
      "audio/ogg",
      4_000,
      "failed",
      "not_applicable",
      timestamp,
      "WhatsApp did not return a sent-message confirmation.",
      timestamp,
      timestamp,
    );
    insert.run(
      "definite-failure",
      "existing",
      "recipient-1",
      "outgoing",
      "/audio/failed.ogg",
      "audio/ogg",
      4_000,
      "failed",
      "not_applicable",
      timestamp,
      "WhatsApp is not connected.",
      timestamp,
      timestamp,
    );

    migrate(db);

    expect(
      db
        .prepare("SELECT id,delivery_state FROM messages ORDER BY id")
        .all(),
    ).toEqual([
      { id: "ambiguous", delivery_state: "confirmation_unknown" },
      { id: "definite-failure", delivery_state: "failed" },
    ]);
    expect(db.pragma("foreign_key_check")).toEqual([]);
  });
});
