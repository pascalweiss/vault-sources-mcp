import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatabaseManager } from "../db/database.js";
import { LinkRepository } from "../db/repositories/link-repository.js";
import { DatabaseNotInitializedError, VaultSourcesError } from "../errors.js";

export function registerLinkTools(server: McpServer, dbManager: DatabaseManager): void {
  function getRepo(): LinkRepository {
    if (!dbManager.isInitialized()) throw new DatabaseNotInitializedError();
    return new LinkRepository(dbManager.connection);
  }

  server.registerTool(
    "add_link",
    {
      description:
        "Create a provenance link between an input and a note. " +
        "Both must already exist in the database. Idempotent — re-adding the same link is a no-op.",
      inputSchema: {
        input_id: z.string().describe("The input ID."),
        note_id: z.string().describe("The note ID."),
      },
    },
    async ({ input_id, note_id }) => {
      try {
        const repo = getRepo();
        const { link, created } = repo.add(input_id, note_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  input_id: link.input_id,
                  note_id: link.note_id,
                  created: created,
                  created_at: link.created_at,
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
    "remove_link",
    {
      description: "Remove a provenance link between an input and a note.",
      inputSchema: {
        input_id: z.string().describe("The input ID."),
        note_id: z.string().describe("The note ID."),
      },
    },
    async ({ input_id, note_id }) => {
      const repo = getRepo();
      const removed = repo.remove(input_id, note_id);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                input_id,
                note_id,
                removed,
                message: removed ? "Link removed." : "Link did not exist.",
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
    "get_sources_for_note",
    {
      description:
        "Get all inputs linked to a note. Returns input metadata (not full content) for each source.",
      inputSchema: {
        note_id: z.string().describe("The note ID to query."),
      },
    },
    async ({ note_id }) => {
      const repo = getRepo();
      const sources = repo.getSourcesForNote(note_id);

      const summary = sources.map((s) => ({
        input_id: s.input_id,
        content_sha256: s.content_sha256,
        state: s.state,
        created_at: s.created_at,
        meta: s.meta_json ? JSON.parse(s.meta_json) : null,
      }));

      return {
        content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
      };
    },
  );

  server.registerTool(
    "get_notes_for_input",
    {
      description: "Get all notes linked to an input.",
      inputSchema: {
        input_id: z.string().describe("The input ID to query."),
      },
    },
    async ({ input_id }) => {
      const repo = getRepo();
      const notes = repo.getNotesForInput(input_id);

      const summary = notes.map((n) => ({
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
}
