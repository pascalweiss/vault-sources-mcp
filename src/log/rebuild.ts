import type { Database as DatabaseType } from "better-sqlite3";
import type { CanonicalEvent } from "../types.js";
import type { Projector } from "./projector.js";

/**
 * A comparison-friendly snapshot of the projection's meaningful state. Timestamps
 * are deliberately excluded — only identity, content hash, redaction/deletion, and
 * links matter for correctness, and rebuilt timestamps may drift by construction.
 */
export interface StateSnapshot {
  inputs: Map<string, string>; // input_id -> "<sha>|<state>"
  notes: Map<string, boolean>; // note_id  -> deleted?
  links: Set<string>; // "<input_id>|<note_id>"
}

export function snapshotState(db: DatabaseType): StateSnapshot {
  const inputs = new Map<string, string>();
  for (const row of db
    .prepare(`SELECT input_id, content_sha256, state FROM inputs`)
    .all() as { input_id: string; content_sha256: string; state: string }[]) {
    inputs.set(row.input_id, `${row.content_sha256}|${row.state}`);
  }

  const notes = new Map<string, boolean>();
  for (const row of db.prepare(`SELECT note_id, meta_json FROM notes`).all() as {
    note_id: string;
    meta_json: string | null;
  }[]) {
    const deleted = row.meta_json ? Boolean((JSON.parse(row.meta_json) as Record<string, unknown>)["deleted"]) : false;
    notes.set(row.note_id, deleted);
  }

  const links = new Set<string>();
  for (const row of db.prepare(`SELECT input_id, note_id FROM input_note_links`).all() as {
    input_id: string;
    note_id: string;
  }[]) {
    links.add(`${row.input_id}|${row.note_id}`);
  }

  return { inputs, notes, links };
}

/** Structural equality of two snapshots, with a human-readable diff on mismatch. */
export function diffStates(a: StateSnapshot, b: StateSnapshot): string[] {
  const problems: string[] = [];
  compareMaps("inputs", a.inputs, b.inputs, problems);
  compareMaps("notes", a.notes, b.notes, problems);
  compareSets("links", a.links, b.links, problems);
  return problems;
}

function compareMaps<T>(label: string, a: Map<string, T>, b: Map<string, T>, out: string[]): void {
  for (const [k, v] of a) {
    if (!b.has(k)) out.push(`${label}: ${k} missing after rebuild`);
    else if (b.get(k) !== v) out.push(`${label}: ${k} changed (${String(v)} -> ${String(b.get(k))})`);
  }
  for (const k of b.keys()) {
    if (!a.has(k)) out.push(`${label}: ${k} unexpectedly present after rebuild`);
  }
}

function compareSets(label: string, a: Set<string>, b: Set<string>, out: string[]): void {
  for (const k of a) if (!b.has(k)) out.push(`${label}: ${k} missing after rebuild`);
  for (const k of b) if (!a.has(k)) out.push(`${label}: ${k} unexpectedly present after rebuild`);
}

/**
 * Replay a full event stream into `db`, replacing whatever the projection held.
 * Runs in a single transaction with foreign keys OFF so shard interleaving from
 * different environments can't trip an ordering-dependent FK check; a crash
 * mid-rebuild rolls back and leaves the previous projection intact.
 */
export function rebuildInto(db: DatabaseType, events: CanonicalEvent[], projector: Projector): void {
  const fkWasOn = db.pragma("foreign_keys", { simple: true }) === 1;
  db.pragma("foreign_keys = OFF");
  try {
    const run = db.transaction((evs: CanonicalEvent[]) => {
      db.exec(`DELETE FROM input_note_links; DELETE FROM inputs; DELETE FROM notes;`);
      for (const ev of evs) projector.apply(ev, db);
    });
    run(events);
  } finally {
    if (fkWasOn) db.pragma("foreign_keys = ON");
  }
}
