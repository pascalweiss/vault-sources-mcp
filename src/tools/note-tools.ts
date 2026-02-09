import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatabaseManager } from "../db/database.js";
import { NoteRepository } from "../db/repositories/note-repository.js";
import { DatabaseNotInitializedError, VaultSourcesError } from "../errors.js";

export function registerNoteTools(server: McpServer, dbManager: DatabaseManager): void {
  function getRepo(): NoteRepository {
    if (!dbManager.isInitialized()) throw new DatabaseNotInitializedError();
    return new NoteRepository(dbManager.connection);
  }

  server.registerTool(
    "register_note",
    {
      description:
        "Register a note in the provenance database. Idempotent — if the note already exists, updates last_seen_at. " +
        "Call this after injecting the vault_sources_mcp_id into the note's frontmatter.",
      inputSchema: {
        note_id: z.string().describe("The UUIDv7 note ID (from generate_note_id)."),
        meta: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional metadata about the note."),
      },
    },
    async ({ note_id, meta }) => {
      const repo = getRepo();
      const note = repo.register(note_id, meta as Record<string, unknown> | undefined);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                note_id: note.note_id,
                created_at: note.created_at,
                last_seen_at: note.last_seen_at,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  server.registerTool(
    "get_note",
    {
      description: "Retrieve a note record by its ID, including its list of linked input IDs.",
      inputSchema: {
        note_id: z.string().describe("The note ID to retrieve."),
      },
    },
    async ({ note_id }) => {
      try {
        const repo = getRepo();
        const note = repo.getById(note_id);

        const links = dbManager.connection
          .prepare(`SELECT input_id FROM input_note_links WHERE note_id = ?`)
          .all(note_id) as { input_id: string }[];

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  note_id: note.note_id,
                  created_at: note.created_at,
                  last_seen_at: note.last_seen_at,
                  meta: note.meta_json ? JSON.parse(note.meta_json) : null,
                  linked_input_ids: links.map((l) => l.input_id),
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (err) {
        if (err instanceof VaultSourcesError) {
          return { isError: true, content: [{ type: "text" as const, text: err.message }] };
        }
        throw err;
      }
    },
  );

  server.registerTool(
    "mark_note_deleted",
    {
      description:
        "Mark a note as deleted. Does NOT remove the row — preserves it for audit. " +
        "The agent should call this when it detects a vault file has been removed.",
      inputSchema: {
        note_id: z.string().describe("The note ID to mark as deleted."),
      },
    },
    async ({ note_id }) => {
      try {
        const repo = getRepo();
        repo.markDeleted(note_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ note_id, message: "Note marked as deleted." }, null, 2),
            },
          ],
        };
      } catch (err) {
        if (err instanceof VaultSourcesError) {
          return { isError: true, content: [{ type: "text" as const, text: err.message }] };
        }
        throw err;
      }
    },
  );
}
