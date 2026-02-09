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

// ---- Events ----

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

// ---- Constants ----

export const FRONTMATTER_KEY = "vault_sources_mcp_id";
