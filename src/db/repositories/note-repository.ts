import type { Note, NoteId } from "../../types.js";
import { EntityNotFoundError } from "../../errors.js";
import type { DatabaseManager } from "../database.js";

export class NoteRepository {
  constructor(private mgr: DatabaseManager) {}

  private get db() {
    return this.mgr.connection;
  }

  register(noteId: NoteId, meta?: Record<string, unknown>): Note {
    this.mgr.commit("NOTE_REGISTERED", { note_id: noteId, meta: meta ?? null });
    return this.getById(noteId);
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
    this.getById(noteId); // throws EntityNotFoundError if the note is unknown
    this.mgr.commit("NOTE_DELETED", { note_id: noteId });
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
