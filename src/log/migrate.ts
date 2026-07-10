import { copyFileSync, existsSync } from "node:fs";
import Database from "better-sqlite3";
import { v7 as uuidv7 } from "uuid";
import type { Database as DatabaseType } from "better-sqlite3";
import type { CanonicalEvent } from "../types.js";
import { MigrationVerificationError } from "../errors.js";
import type { EventStore } from "./event-store.js";
import type { Projector } from "./projector.js";
import { applySchema } from "../db/schema.js";
import { diffStates, rebuildInto, snapshotState } from "./rebuild.js";

/**
 * One-time, verified migration of a legacy SQLite ledger into the git-synced log.
 *
 * The legacy `events` table carries no `meta`, so we synthesize the canonical log
 * from the *state* tables (inputs / notes / input_note_links) — that reproduces
 * the live provenance faithfully (identity, content, links, redaction/deletion).
 * Pre-migration audit history is collapsed to net state; the untouched
 * `.sqlite.pre-migration` backup retains the original if it is ever needed.
 *
 * Safety: nothing is written to the real log or projection until a throwaway
 * in-memory replay is proven to reproduce the legacy state. On mismatch it throws
 * and leaves the legacy database (and its backup) untouched.
 */
export function migrateLegacy(
  db: DatabaseType,
  store: EventStore,
  projector: Projector,
  dbPath: string,
): void {
  // 0. Durable backup before touching anything.
  const backup = `${dbPath}.pre-migration`;
  if (!existsSync(backup)) copyFileSync(dbPath, backup);

  // 1. Snapshot the legacy state for the verification gate.
  const legacyState = snapshotState(db);

  // 2. Synthesize canonical events + collect input bodies from the state tables.
  const { events, bodies } = synthesizeEvents(db);

  // 3. Materialize content-addressed input bodies (idempotent, content-addressed).
  for (const body of bodies) store.putInput(body);

  // 4. Verification gate: replay into a throwaway in-memory projection and compare.
  const mem = new Database(":memory:");
  applySchema(mem);
  rebuildInto(mem, [...events].sort(byTsThenUid), projector);
  const rebuiltState = snapshotState(mem);
  mem.close();

  const problems = diffStates(legacyState, rebuiltState);
  if (problems.length > 0) {
    throw new MigrationVerificationError(problems);
  }

  // 5. Commit: append the shard, then rebuild the real projection from the log.
  for (const ev of events) store.appendRaw(ev);
  rebuildInto(db, store.readAll(), projector);

  console.error(
    `[migrate] migrated ${events.length} events (${bodies.length} input bodies) from legacy SQLite; ` +
      `backup kept at ${backup}`,
  );
}

interface Synthesis {
  events: CanonicalEvent[];
  bodies: string[];
}

function synthesizeEvents(db: DatabaseType): Synthesis {
  const events: CanonicalEvent[] = [];
  const bodies: string[] = [];

  // --- inputs ---
  const inputRows = db
    .prepare(`SELECT input_id, content, content_sha256, state, created_at, meta_json FROM inputs ORDER BY created_at, input_id`)
    .all() as {
    input_id: string;
    content: string | null;
    content_sha256: string;
    state: string;
    created_at: string;
    meta_json: string | null;
  }[];

  for (const row of inputRows) {
    events.push(mkEvent("INPUT_STORED", row.created_at, {
      input_id: row.input_id,
      content_sha256: row.content_sha256,
      meta: parseMeta(row.meta_json),
    }));
    if (row.content != null) bodies.push(row.content);
    if (row.state === "redacted") {
      // +1ms so the redaction always sorts after its own INPUT_STORED.
      events.push(mkEvent("INPUT_REDACTED", bumpMs(row.created_at, 1), { input_id: row.input_id }));
    }
  }

  // --- notes ---
  const noteRows = db
    .prepare(`SELECT note_id, created_at, last_seen_at, meta_json FROM notes ORDER BY created_at, note_id`)
    .all() as { note_id: string; created_at: string; last_seen_at: string; meta_json: string | null }[];

  for (const row of noteRows) {
    events.push(mkEvent("NOTE_REGISTERED", row.created_at, {
      note_id: row.note_id,
      meta: parseMeta(row.meta_json),
    }));
    // Preserve last_seen_at with a second (meta-less) registration when it differs.
    if (row.last_seen_at && row.last_seen_at !== row.created_at) {
      events.push(mkEvent("NOTE_REGISTERED", row.last_seen_at, { note_id: row.note_id, meta: null }));
    }
  }

  // --- links ---
  const linkRows = db
    .prepare(`SELECT input_id, note_id, created_at FROM input_note_links ORDER BY created_at`)
    .all() as { input_id: string; note_id: string; created_at: string }[];

  for (const row of linkRows) {
    events.push(mkEvent("LINK_ADDED", row.created_at, { input_id: row.input_id, note_id: row.note_id }));
  }

  return { events, bodies };
}

function mkEvent(
  type: CanonicalEvent["type"],
  ts: string,
  payload: Record<string, unknown>,
): CanonicalEvent {
  return { uid: uuidv7(), type, ts, payload };
}

function parseMeta(metaJson: string | null): Record<string, unknown> | null {
  if (!metaJson) return null;
  try {
    return JSON.parse(metaJson) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function bumpMs(iso: string, ms: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  return new Date(t + ms).toISOString();
}

function byTsThenUid(a: CanonicalEvent, b: CanonicalEvent): number {
  if (a.ts < b.ts) return -1;
  if (a.ts > b.ts) return 1;
  return a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0;
}
