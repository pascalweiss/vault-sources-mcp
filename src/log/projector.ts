import type { Database as DatabaseType } from "better-sqlite3";
import type { CanonicalEvent } from "../types.js";
import type { EventStore } from "./event-store.js";

/**
 * Applies canonical events to the SQLite projection. Every apply is idempotent
 * and a pure function of (event, current state), so replaying the same event
 * twice — or replaying the whole log in (ts, uid) order — yields the same state.
 *
 * created_at / last_seen_at come from the event `ts`, never `Date.now()`, so a
 * rebuild reproduces deterministic timestamps.
 */
export class Projector {
  constructor(private readonly store: EventStore) {}

  apply(event: CanonicalEvent, db: DatabaseType): void {
    switch (event.type) {
      case "INPUT_STORED":
        this.applyInputStored(event, db);
        break;
      case "INPUT_REDACTED":
        this.applyInputRedacted(event, db);
        break;
      case "NOTE_REGISTERED":
        this.applyNoteRegistered(event, db);
        break;
      case "NOTE_DELETED":
        this.applyNoteDeleted(event, db);
        break;
      case "LINK_ADDED":
        this.applyLinkAdded(event, db);
        break;
      case "LINK_REMOVED":
        this.applyLinkRemoved(event, db);
        break;
      default:
        // Unknown/legacy event type: skip rather than crash a rebuild.
        console.error(`[projector] skipping unknown event type: ${(event as CanonicalEvent).type}`);
    }
  }

  private applyInputStored(event: CanonicalEvent, db: DatabaseType): void {
    const inputId = String(event.payload["input_id"]);
    const sha = String(event.payload["content_sha256"]);
    const meta = event.payload["meta"];
    const metaJson = meta == null ? null : JSON.stringify(meta);
    // Hydrate the body from the content-addressed store (source of truth is the file).
    const content = this.store.getInput(sha);

    db.prepare(
      `INSERT OR IGNORE INTO inputs (input_id, content, content_sha256, state, created_at, meta_json)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    ).run(inputId, content, sha, event.ts, metaJson);
  }

  private applyInputRedacted(event: CanonicalEvent, db: DatabaseType): void {
    const inputId = String(event.payload["input_id"]);
    db.prepare(`UPDATE inputs SET content = NULL, state = 'redacted' WHERE input_id = ?`).run(inputId);
  }

  private applyNoteRegistered(event: CanonicalEvent, db: DatabaseType): void {
    const noteId = String(event.payload["note_id"]);
    const meta = event.payload["meta"];
    const metaJson = meta == null ? null : JSON.stringify(meta);

    // Upsert. Applied in ts order, so last_seen_at climbs monotonically; created_at
    // stays the first sighting. A later null meta keeps the existing meta.
    db.prepare(
      `INSERT INTO notes (note_id, created_at, last_seen_at, meta_json)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(note_id) DO UPDATE SET
         last_seen_at = excluded.last_seen_at,
         meta_json    = COALESCE(excluded.meta_json, notes.meta_json)`,
    ).run(noteId, event.ts, event.ts, metaJson);
  }

  private applyNoteDeleted(event: CanonicalEvent, db: DatabaseType): void {
    const noteId = String(event.payload["note_id"]);
    const row = db.prepare(`SELECT meta_json FROM notes WHERE note_id = ?`).get(noteId) as
      | { meta_json: string | null }
      | undefined;
    if (!row) return; // deleting an unknown note is a no-op
    const existing = row.meta_json ? (JSON.parse(row.meta_json) as Record<string, unknown>) : {};
    const merged = JSON.stringify({ ...existing, deleted: true, deleted_at: event.ts });
    db.prepare(`UPDATE notes SET meta_json = ? WHERE note_id = ?`).run(merged, noteId);
  }

  private applyLinkAdded(event: CanonicalEvent, db: DatabaseType): void {
    const inputId = String(event.payload["input_id"]);
    const noteId = String(event.payload["note_id"]);
    db.prepare(
      `INSERT OR IGNORE INTO input_note_links (input_id, note_id, created_at) VALUES (?, ?, ?)`,
    ).run(inputId, noteId, event.ts);
  }

  private applyLinkRemoved(event: CanonicalEvent, db: DatabaseType): void {
    const inputId = String(event.payload["input_id"]);
    const noteId = String(event.payload["note_id"]);
    db.prepare(`DELETE FROM input_note_links WHERE input_id = ? AND note_id = ?`).run(inputId, noteId);
  }
}
