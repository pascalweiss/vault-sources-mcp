// ---- Identifiers ----

export type InputId = string; // UUIDv7
export type NoteId = string; // UUIDv7

// ---- Input ----

export type InputState = "active" | "redacted";

export interface Input {
  input_id: InputId;
  content: string | null;
  content_sha256: string;
  state: InputState;
  created_at: string;
  meta_json: string | null;
}

// ---- Note ----

export interface Note {
  note_id: NoteId;
  created_at: string;
  last_seen_at: string;
  meta_json: string | null;
}

// ---- Input–Note Link ----

export interface InputNoteLink {
  input_id: InputId;
  note_id: NoteId;
  created_at: string;
}

// ---- Legacy events (SQLite `events` table, pre git-sync) ----
//
// Kept only so the one-time migration can read old ledgers. New writes go to the
// git-synced JSONL log (CanonicalEvent) instead. See src/log/.

export type EventType =
  | "DB_INITIALIZED"
  | "INPUT_STORED"
  | "INPUT_REDACTED"
  | "NOTE_SEEN"
  | "NOTE_MARKED_DELETED"
  | "NOTES_MERGED"
  | "LINK_ADDED"
  | "LINK_REMOVED";

export interface VaultEvent {
  event_id: number;
  event_type: EventType;
  timestamp: string;
  payload: string; // JSON
}

// ---- Canonical events (git-synced JSONL log, the source of truth) ----
//
// One JSON object per line in `.vault-sources/events/<node-id>.jsonl`. The SQLite
// DB is a rebuildable projection of these events. `uid` is a UUIDv7 (globally
// unique + time-ordered); rebuild sorts by (ts, uid) so replay is deterministic
// regardless of how git interleaves shards from different environments.

export type CanonicalEventType =
  | "INPUT_STORED"
  | "INPUT_REDACTED"
  | "NOTE_REGISTERED"
  | "NOTE_DELETED"
  | "LINK_ADDED"
  | "LINK_REMOVED";

export interface CanonicalEvent {
  uid: string; // UUIDv7
  type: CanonicalEventType;
  ts: string; // ISO 8601
  payload: Record<string, unknown>;
}

// ---- Constants ----

export const FRONTMATTER_KEY = "vault_sources_mcp_id";
