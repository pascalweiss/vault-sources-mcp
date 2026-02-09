import type { Database as DatabaseType } from "better-sqlite3";
import type { Note, NoteId } from "../../types.js";
import { EntityNotFoundError } from "../../errors.js";
import { EventRepository } from "./event-repository.js";

export class NoteRepository {
  private events: EventRepository;

  constructor(private db: DatabaseType) {
    this.events = new EventRepository(db);
  }

  register(noteId: NoteId, meta?: Record<string, unknown>): Note {
    const now = new Date().toISOString();
    const metaJson = meta ? JSON.stringify(meta) : null;

    const existing = this.findById(noteId);

    if (existing) {
      this.db
        .prepare(`UPDATE notes SET last_seen_at = ?, meta_json = COALESCE(?, meta_json) WHERE note_id = ?`)
        .run(now, metaJson, noteId);

      this.events.append("NOTE_SEEN", { note_id: noteId });

      return { ...existing, last_seen_at: now, meta_json: metaJson ?? existing.meta_json };
    }

    this.db
      .prepare(
        `INSERT INTO notes (note_id, created_at, last_seen_at, meta_json) VALUES (?, ?, ?, ?)`,
      )
      .run(noteId, now, now, metaJson);

    this.events.append("NOTE_SEEN", { note_id: noteId, first_seen: true });

    return { note_id: noteId, created_at: now, last_seen_at: now, meta_json: metaJson };
  }

  getById(noteId: NoteId): Note {
    const row = this.findById(noteId);
    if (!row) throw new EntityNotFoundError("Note", noteId);
    return row;
  }

  findById(noteId: NoteId): Note | null {
    const row = this.db.prepare(`SELECT * FROM notes WHERE note_id = ?`).get(noteId) as Note | undefined;
    return row ?? null;
  }

  markDeleted(noteId: NoteId): void {
    const note = this.getById(noteId);
    const existingMeta = note.meta_json ? JSON.parse(note.meta_json) : {};
    const updatedMeta = JSON.stringify({ ...existingMeta, deleted: true, deleted_at: new Date().toISOString() });

    this.db
      .prepare(`UPDATE notes SET meta_json = ? WHERE note_id = ?`)
      .run(updatedMeta, noteId);

    this.events.append("NOTE_MARKED_DELETED", { note_id: noteId });
  }

  findStale(notSeenSince: string): Note[] {
    return this.db
      .prepare(`SELECT * FROM notes WHERE last_seen_at < ? ORDER BY last_seen_at ASC`)
      .all(notSeenSince) as Note[];
  }

  findUnlinked(): Note[] {
    return this.db
      .prepare(
        `SELECT n.* FROM notes n
         LEFT JOIN input_note_links l ON n.note_id = l.note_id
         WHERE l.input_id IS NULL
         ORDER BY n.created_at ASC`,
      )
      .all() as Note[];
  }
}
