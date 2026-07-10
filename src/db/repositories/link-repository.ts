import type { InputNoteLink, InputId, NoteId, Input, Note } from "../../types.js";
import { EntityNotFoundError } from "../../errors.js";
import type { DatabaseManager } from "../database.js";

export class LinkRepository {
  constructor(private mgr: DatabaseManager) {}

  private get db() {
    return this.mgr.connection;
  }

  add(inputId: InputId, noteId: NoteId): { link: InputNoteLink; created: boolean } {
    // Verify both entities exist
    this.requireInput(inputId);
    this.requireNote(noteId);

    const existing = this.find(inputId, noteId);
    if (existing) {
      return { link: existing, created: false };
    }

    this.mgr.commit("LINK_ADDED", { input_id: inputId, note_id: noteId });

    return { link: this.find(inputId, noteId)!, created: true };
  }

  remove(inputId: InputId, noteId: NoteId): boolean {
    if (!this.find(inputId, noteId)) return false;
    this.mgr.commit("LINK_REMOVED", { input_id: inputId, note_id: noteId });
    return true;
  }

  private find(inputId: InputId, noteId: NoteId): InputNoteLink | undefined {
    return this.db
      .prepare(`SELECT * FROM input_note_links WHERE input_id = ? AND note_id = ?`)
      .get(inputId, noteId) as InputNoteLink | undefined;
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
