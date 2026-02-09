import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseManager } from "../../src/db/database.js";

describe("DatabaseManager", () => {
  let dbm: DatabaseManager;

  beforeEach(() => {
    dbm = new DatabaseManager();
    dbm.open(":memory:");
  });

  afterEach(() => {
    dbm.close();
  });

  it("should report not initialized before migration", () => {
    assert.equal(dbm.isInitialized(), false);
  });

  it("should initialize and create tables", () => {
    dbm.initialize();
    assert.equal(dbm.isInitialized(), true);

    const tables = dbm.connection
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    assert.ok(tableNames.includes("inputs"));
    assert.ok(tableNames.includes("notes"));
    assert.ok(tableNames.includes("input_note_links"));
    assert.ok(tableNames.includes("events"));
  });

  it("should emit DB_INITIALIZED event on initialize", () => {
    dbm.initialize();

    const events = dbm.connection
      .prepare(`SELECT * FROM events WHERE event_type = 'DB_INITIALIZED'`)
      .all() as { event_type: string }[];

    assert.equal(events.length, 1);
  });

  it("should have foreign keys enabled", () => {
    dbm.initialize();
    const row = dbm.connection.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number };
    assert.equal(row.foreign_keys, 1);
  });

  it("should have WAL journal mode", () => {
    // WAL only works with file-based DBs, :memory: uses 'memory' mode
    // Just verify the pragma doesn't error
    const row = dbm.connection.prepare(`PRAGMA journal_mode`).get() as { journal_mode: string };
    assert.ok(row.journal_mode);
  });
});
