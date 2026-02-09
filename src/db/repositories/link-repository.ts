import type { Database as DatabaseType } from "better-sqlite3";
import type { InputNoteLink, InputId, NoteId, Input, Note } from "../../types.js";
import { EntityNotFoundError } from "../../errors.js";
import { EventRepository } from "./event-repository.js";

export class LinkRepository {
  private events: EventRepository;

  constructor(private db: DatabaseType) {
    this.events = new EventRepository(db);
  }

  add(inputId: InputId, noteId: NoteId): { link: InputNoteLink; created: boolean } {
    // Verify both entities exist
    this.requireInput(inputId);
    this.requireNote(noteId);

    const existing = this.db
      .prepare(`SELECT * FROM input_note_links WHERE input_id = ? AND note_id = ?`)
      .get(inputId, noteId) as InputNoteLink | undefined;

    if (existing) {
      return { link: existing, created: false };
    }

    const now = new Date().toISOString();
    this.db
      .prepare(`INSERT INTO input_note_links (input_id, note_id, created_at) VALUES (?, ?, ?)`)
      .run(inputId, noteId, now);

    const link: InputNoteLink = { input_id: inputId, note_id: noteId, created_at: now };

    this.events.append("LINK_ADDED", { input_id: inputId, note_id: noteId });

    return { link, created: true };
  }

  remove(inputId: InputId, noteId: NoteId): boolean {
    const result = this.db
      .prepare(`DELETE FROM input_note_links WHERE input_id = ? AND note_id = ?`)
      .run(inputId, noteId);

    if (result.changes > 0) {
      this.events.append("LINK_REMOVED", { input_id: inputId, note_id: noteId });
      return true;
    }
    return false;
  }

  getSourcesForNote(noteId: NoteId): Input[] {
    return this.db
      .prepare(
        `SELECT i.* FROM inputs i
         JOIN input_note_links l ON i.input_id = l.input_id
         WHERE l.note_id = ?
         ORDER BY l.created_at ASC`,
      )
      .all(noteId) as Input[];
  }

  getNotesForInput(inputId: InputId): Note[] {
    return this.db
      .prepare(
        `SELECT n.* FROM notes n
         JOIN input_note_links l ON n.note_id = l.note_id
         WHERE l.input_id = ?
         ORDER BY l.created_at ASC`,
      )
      .all(inputId) as Note[];
  }

  findOrphanedInputs(): Input[] {
    return this.db
      .prepare(
        `SELECT i.* FROM inputs i
         LEFT JOIN input_note_links l ON i.input_id = l.input_id
         WHERE l.note_id IS NULL
         ORDER BY i.created_at ASC`,
      )
      .all() as Input[];
  }

  private requireInput(inputId: InputId): void {
    const row = this.db.prepare(`SELECT input_id FROM inputs WHERE input_id = ?`).get(inputId);
    if (!row) throw new EntityNotFoundError("Input", inputId);
  }

  private requireNote(noteId: NoteId): void {
    const row = this.db.prepare(`SELECT note_id FROM notes WHERE note_id = ?`).get(noteId);
    if (!row) throw new EntityNotFoundError("Note", noteId);
  }
}
