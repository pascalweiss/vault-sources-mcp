import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS inputs (
  input_id       TEXT PRIMARY KEY,
  content        TEXT,
  content_sha256 TEXT NOT NULL,
  state          TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'redacted')),
  created_at     TEXT NOT NULL,
  meta_json      TEXT
);

CREATE INDEX IF NOT EXISTS idx_inputs_sha256 ON inputs (content_sha256);
CREATE INDEX IF NOT EXISTS idx_inputs_state  ON inputs (state);

CREATE TABLE IF NOT EXISTS notes (
  note_id      TEXT PRIMARY KEY,
  created_at   TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  meta_json    TEXT
);

CREATE TABLE IF NOT EXISTS input_note_links (
  input_id   TEXT NOT NULL REFERENCES inputs (input_id),
  note_id    TEXT NOT NULL REFERENCES notes  (note_id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (input_id, note_id)
);

CREATE INDEX IF NOT EXISTS idx_links_note  ON input_note_links (note_id);
CREATE INDEX IF NOT EXISTS idx_links_input ON input_note_links (input_id);

CREATE TABLE IF NOT EXISTS events (
  event_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  timestamp  TEXT NOT NULL,
  payload    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_ts   ON events (timestamp);
`;

export class DatabaseManager {
  private db: DatabaseType | null = null;

  get connection(): DatabaseType {
    if (!this.db) {
      throw new Error("Database not opened. Call open() first.");
    }
    return this.db;
  }

  open(path: string): void {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
  }

  initialize(): void {
    const db = this.connection;
    db.exec(SCHEMA_SQL);

    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO events (event_type, timestamp, payload) VALUES (?, ?, ?)`,
    ).run("DB_INITIALIZED", now, JSON.stringify({ initialized_at: now }));
  }

  isInitialized(): boolean {
    if (!this.db) return false;
    try {
      const row = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='events'`)
        .get() as { name: string } | undefined;
      return row !== undefined;
    } catch {
      return false;
    }
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}
