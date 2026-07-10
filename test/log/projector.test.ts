import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { EventStore } from "../../src/log/event-store.js";
import { Projector } from "../../src/log/projector.js";
import { rebuildInto, snapshotState, diffStates } from "../../src/log/rebuild.js";
import { applySchema } from "../../src/db/schema.js";
import type { CanonicalEvent } from "../../src/types.js";

describe("Projector / rebuild", () => {
  let dir: string;
  let store: EventStore;
  let projector: Projector;
  let db: DatabaseType;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vs-proj-"));
    store = new EventStore(join(dir, ".vault-sources"), "test-node");
    projector = new Projector(store);
    db = new Database(join(dir, "p.sqlite"));
    applySchema(db);
  });

  afterEach(() => {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  function ev(uid: string, type: CanonicalEvent["type"], ts: string, payload: Record<string, unknown>): CanonicalEvent {
    return { uid, type, ts, payload };
  }

  it("applies a full event set to the expected state", () => {
    const shaA = store.putInput("body A");
    const events: CanonicalEvent[] = [
      ev("a", "INPUT_STORED", "2026-01-01T00:00:00.000Z", { input_id: "i1", content_sha256: shaA, meta: { s: 1 } }),
      ev("b", "NOTE_REGISTERED", "2026-01-01T00:00:01.000Z", { note_id: "n1", meta: { title: "N1" } }),
      ev("c", "LINK_ADDED", "2026-01-01T00:00:02.000Z", { input_id: "i1", note_id: "n1" }),
    ];
    rebuildInto(db, events, projector);

    const s = snapshotState(db);
    assert.equal(s.inputs.get("i1"), `${shaA}|active`);
    assert.equal(s.notes.get("n1"), false);
    assert.ok(s.links.has("i1|n1"));

    // Content hydrated from the addressed body.
    const row = db.prepare(`SELECT content FROM inputs WHERE input_id = 'i1'`).get() as { content: string };
    assert.equal(row.content, "body A");
  });

  it("is deterministic and idempotent across repeated rebuilds", () => {
    const sha = store.putInput("x");
    const events: CanonicalEvent[] = [
      ev("a", "INPUT_STORED", "2026-01-01T00:00:00.000Z", { input_id: "i1", content_sha256: sha, meta: null }),
      ev("b", "NOTE_REGISTERED", "2026-01-01T00:00:01.000Z", { note_id: "n1", meta: null }),
      ev("c", "LINK_ADDED", "2026-01-01T00:00:02.000Z", { input_id: "i1", note_id: "n1" }),
      ev("d", "LINK_REMOVED", "2026-01-01T00:00:03.000Z", { input_id: "i1", note_id: "n1" }),
    ];
    rebuildInto(db, events, projector);
    const first = snapshotState(db);
    rebuildInto(db, events, projector);
    const second = snapshotState(db);
    assert.deepEqual(diffStates(first, second), []);
    assert.equal(first.links.size, 0); // link added then removed
  });

  it("orders INPUT_STORED before INPUT_REDACTED across split shards via readAll", () => {
    // Two environments: node-a stored the input, node-b redacted it later.
    const nodeA = new EventStore(join(dir, ".vault-sources"), "node-a");
    const nodeB = new EventStore(join(dir, ".vault-sources"), "node-b");
    const sha = nodeA.putInput("secret");
    nodeA.appendRaw(ev("s", "INPUT_STORED", "2026-01-01T00:00:00.000Z", { input_id: "i1", content_sha256: sha, meta: null }));
    nodeB.appendRaw(ev("r", "INPUT_REDACTED", "2026-01-02T00:00:00.000Z", { input_id: "i1" }));

    // readAll from any store instance sees both shards, sorted by (ts, uid).
    rebuildInto(db, nodeA.readAll(), projector);
    const s = snapshotState(db);
    assert.equal(s.inputs.get("i1"), `${sha}|redacted`);
  });

  it("readAll dedups by uid and sorts by ts", () => {
    store.appendRaw(ev("dup", "NOTE_REGISTERED", "2026-01-01T00:00:05.000Z", { note_id: "n2", meta: null }));
    store.appendRaw(ev("dup", "NOTE_REGISTERED", "2026-01-01T00:00:05.000Z", { note_id: "n2", meta: null }));
    store.appendRaw(ev("early", "NOTE_REGISTERED", "2026-01-01T00:00:01.000Z", { note_id: "n1", meta: null }));

    const all = store.readAll();
    assert.equal(all.length, 2); // deduped
    assert.equal(all[0].uid, "early"); // sorted by ts
    assert.equal(all[1].uid, "dup");
  });
});
