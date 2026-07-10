import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { openTestDb, type TestDb } from "../helpers.js";

describe("DatabaseManager", () => {
  let ctx: TestDb;

  beforeEach(() => {
    ctx = openTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should be initialized right after open (schema auto-applied)", () => {
    assert.equal(ctx.dbm.isInitialized(), true);
  });

  it("should create the projection tables", () => {
    const tables = ctx.dbm.connection
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all() as { name: string }[];

    const tableNames = tables.map((t) => t.name);
    assert.ok(tableNames.includes("inputs"));
    assert.ok(tableNames.includes("notes"));
    assert.ok(tableNames.includes("input_note_links"));
  });

  it("should expose an event store rooted at .vault-sources", () => {
    assert.ok(ctx.dbm.events.eventsDirPath.endsWith(".vault-sources/events"));
    // Fresh vault: no events yet.
    assert.equal(ctx.dbm.events.readAll().length, 0);
  });

  it("should have foreign keys enabled", () => {
    const row = ctx.dbm.connection.prepare(`PRAGMA foreign_keys`).get() as { foreign_keys: number };
    assert.equal(row.foreign_keys, 1);
  });

  it("should use WAL journal mode on a file-backed projection", () => {
    const row = ctx.dbm.connection.prepare(`PRAGMA journal_mode`).get() as { journal_mode: string };
    assert.equal(row.journal_mode, "wal");
  });
});
