import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { applySchema } from "../../src/db/schema.js";
import { sha256 } from "../../src/log/hash.js";
import { DatabaseManager } from "../../src/db/database.js";

/**
 * Build a legacy-style SQLite ledger (data in the state tables, plus a couple of
 * rows in the old `events` audit table that migration must ignore). Written in
 * the default rollback-journal mode so every row is in the main file for the
 * pre-migration backup copy.
 */
function buildLegacyDb(dbPath: string): void {
  const db = new Database(dbPath);
  applySchema(db);

  const shaHello = sha256("hello world");
  const shaSecret = sha256("secret transcript");

  db.prepare(
    `INSERT INTO inputs (input_id, content, content_sha256, state, created_at, meta_json) VALUES (?,?,?,?,?,?)`,
  ).run("i1", "hello world", shaHello, "active", "2026-01-01T00:00:00.000Z", JSON.stringify({ source: "youtube" }));

  // A redacted input: content already nulled in the legacy ledger.
  db.prepare(
    `INSERT INTO inputs (input_id, content, content_sha256, state, created_at, meta_json) VALUES (?,?,?,?,?,?)`,
  ).run("i2", null, shaSecret, "redacted", "2026-01-01T00:01:00.000Z", null);

  db.prepare(`INSERT INTO notes (note_id, created_at, last_seen_at, meta_json) VALUES (?,?,?,?)`).run(
    "n1",
    "2026-01-02T00:00:00.000Z",
    "2026-01-03T00:00:00.000Z",
    JSON.stringify({ title: "N1" }),
  );

  // A note marked deleted in the legacy ledger.
  db.prepare(`INSERT INTO notes (note_id, created_at, last_seen_at, meta_json) VALUES (?,?,?,?)`).run(
    "n2",
    "2026-01-02T00:05:00.000Z",
    "2026-01-02T00:05:00.000Z",
    JSON.stringify({ title: "N2", deleted: true, deleted_at: "2026-01-04T00:00:00.000Z" }),
  );

  db.prepare(`INSERT INTO input_note_links (input_id, note_id, created_at) VALUES (?,?,?)`).run(
    "i1",
    "n1",
    "2026-01-03T00:00:00.000Z",
  );

  // Legacy audit rows — must be ignored by state-synthesis migration.
  db.prepare(`INSERT INTO events (event_type, timestamp, payload) VALUES (?,?,?)`).run(
    "DB_INITIALIZED",
    "2026-01-01T00:00:00.000Z",
    "{}",
  );

  db.close();
}

describe("Legacy migration", () => {
  let dir: string;
  let dbPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vs-mig-"));
    dbPath = join(dir, ".vault-sources.sqlite");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("migrates a legacy ledger faithfully, backs it up, and builds the log", () => {
    buildLegacyDb(dbPath);

    const dbm = new DatabaseManager();
    dbm.open(dbPath);
    try {
      // Backup taken.
      assert.ok(existsSync(`${dbPath}.pre-migration`), "pre-migration backup should exist");

      // Log now holds synthesized events.
      const types = dbm.events.readAll().map((e) => e.type);
      assert.ok(types.includes("INPUT_STORED"));
      assert.ok(types.includes("INPUT_REDACTED"));
      assert.ok(types.includes("NOTE_REGISTERED"));
      assert.ok(types.includes("LINK_ADDED"));

      // Projection faithful to the legacy state.
      const i1 = dbm.connection.prepare(`SELECT * FROM inputs WHERE input_id='i1'`).get() as {
        content: string;
        state: string;
        content_sha256: string;
      };
      assert.equal(i1.state, "active");
      assert.equal(i1.content, "hello world"); // body hydrated from content-addressed store

      const i2 = dbm.connection.prepare(`SELECT * FROM inputs WHERE input_id='i2'`).get() as {
        content: string | null;
        state: string;
      };
      assert.equal(i2.state, "redacted");
      assert.equal(i2.content, null);

      const n2 = dbm.connection.prepare(`SELECT meta_json FROM notes WHERE note_id='n2'`).get() as {
        meta_json: string;
      };
      assert.equal(JSON.parse(n2.meta_json).deleted, true);

      const link = dbm.connection.prepare(`SELECT * FROM input_note_links WHERE input_id='i1' AND note_id='n1'`).get();
      assert.ok(link);

      // Active input body is retrievable; redacted input has no body.
      assert.equal(dbm.getInput(i1.content_sha256), "hello world");
    } finally {
      dbm.close();
    }
  });

  it("does not re-migrate on a second open", () => {
    buildLegacyDb(dbPath);

    const first = new DatabaseManager();
    first.open(dbPath);
    const eventCountAfterFirst = first.events.readAll().length;
    first.close();

    const second = new DatabaseManager();
    second.open(dbPath);
    try {
      // Log unchanged: migration guarded by shard emptiness.
      assert.equal(second.events.readAll().length, eventCountAfterFirst);
      // Projection still intact.
      const count = second.connection.prepare(`SELECT COUNT(*) c FROM inputs`).get() as { c: number };
      assert.equal(count.c, 2);
    } finally {
      second.close();
    }
  });
});
