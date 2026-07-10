import { dirname, join } from "node:path";
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

-- Legacy audit table. Kept so the one-time migration can read old ledgers; new
-- writes no longer target it (the JSONL log under .vault-sources/ is the source
-- of truth). Safe to leave empty on freshly-projected databases.
CREATE TABLE IF NOT EXISTS events (
  event_id   INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type TEXT NOT NULL,
  timestamp  TEXT NOT NULL,
  payload    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_type ON events (event_type);
CREATE INDEX IF NOT EXISTS idx_events_ts   ON events (timestamp);
`;

/** Apply the projection schema (idempotent). Exposed for the in-memory verify DB. */
export function applySchema(db: DatabaseType): void {
  db.exec(SCHEMA_SQL);
}

/** `.vault-sources/` log dir lives next to the `.vault-sources.sqlite` projection. */
export function deriveLogDir(dbPath: string): string {
  return join(dirname(dbPath), ".vault-sources");
}
