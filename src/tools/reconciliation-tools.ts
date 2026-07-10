import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatabaseManager } from "../db/database.js";
import { NoteRepository } from "../db/repositories/note-repository.js";
import { LinkRepository } from "../db/repositories/link-repository.js";
import { DatabaseNotInitializedError } from "../errors.js";
import type { CanonicalEventType } from "../types.js";

export function registerReconciliationTools(server: McpServer, dbManager: DatabaseManager): void {
  function requireDb() {
    if (!dbManager.isInitialized()) throw new DatabaseNotInitializedError();
    return dbManager.connection;
  }

  server.registerTool(
    "find_stale_notes",
    {
      description:
        "Find notes that have not been seen since a given date. " +
        "The agent should check if these files still exist in the vault.",
      inputSchema: {
        not_seen_since: z
          .string()
          .describe("ISO 8601 date threshold. Notes last seen before this date are returned."),
      },
    },
    async ({ not_seen_since }) => {
      requireDb();
      const repo = new NoteRepository(dbManager);
      const notes = repo.findStale(not_seen_since);

      const summary = notes.map((n) => ({
        note_id: n.note_id,
        last_seen_at: n.last_seen_at,
        meta: n.meta_json ? JSON.parse(n.meta_json) : null,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    },
  );

  server.registerTool(
    "find_orphaned_inputs",
    {
      description:
        "Find inputs that have no provenance links to any note. " +
        "These inputs were stored but never linked, or all their links were removed.",
    },
    async () => {
      requireDb();
      const repo = new LinkRepository(dbManager);
      const orphaned = repo.findOrphanedInputs();

      const summary = orphaned.map((i) => ({
        input_id: i.input_id,
        content_sha256: i.content_sha256,
        state: i.state,
        created_at: i.created_at,
        meta: i.meta_json ? JSON.parse(i.meta_json) : null,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    },
  );

  server.registerTool(
    "find_unlinked_notes",
    {
      description:
        "Find notes that have no provenance links to any input. " +
        "These notes have no known source tracked in the database.",
    },
    async () => {
      requireDb();
      const repo = new NoteRepository(dbManager);
      const unlinked = repo.findUnlinked();

      const summary = unlinked.map((n) => ({
        note_id: n.note_id,
        created_at: n.created_at,
        last_seen_at: n.last_seen_at,
        meta: n.meta_json ? JSON.parse(n.meta_json) : null,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_event_log",
    {
      description:
        "Query the append-only event log (the git-synced JSONL log across all environments). " +
        "Supports filtering by event type and time range.",
      inputSchema: {
        event_type: z
          .enum([
            "INPUT_STORED",
            "INPUT_REDACTED",
            "NOTE_REGISTERED",
            "NOTE_DELETED",
            "LINK_ADDED",
            "LINK_REMOVED",
          ])
          .optional()
          .describe("Filter by event type."),
        since: z.string().optional().describe("ISO 8601 timestamp. Only return events at or after this time."),
        limit: z.number().int().min(1).max(500).optional().describe("Max results (default 100)."),
        offset: z.number().int().min(0).optional().describe("Offset for pagination."),
      },
    },
    async ({ event_type, since, limit, offset }) => {
      requireDb();
      const wantType = (event_type ?? undefined) as CanonicalEventType | undefined;
      const from = offset ?? 0;
      const max = limit ?? 100;

      const all = dbManager.events
        .readAll()
        .filter((e) => (wantType ? e.type === wantType : true))
        .filter((e) => (since ? e.ts >= since : true));

      const page = all.slice(from, from + max).map((e) => ({
        uid: e.uid,
        event_type: e.type,
        timestamp: e.ts,
        payload: e.payload,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(page, null, 2) }],
      };
    },
  );
}
