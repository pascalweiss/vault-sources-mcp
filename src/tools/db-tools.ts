import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DatabaseManager } from "../db/database.js";

export function registerDbTools(server: McpServer, dbManager: DatabaseManager, getDbPath: () => string): void {
  server.registerTool(
    "db_status",
    {
      description:
        "Check the database status. Returns whether the DB is initialized and basic statistics.",
    },
    async () => {
      const initialized = dbManager.isInitialized();

      if (!initialized) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ initialized: false, path: getDbPath() }, null, 2),
            },
          ],
        };
      }

      const db = dbManager.connection;
      const inputCount = (db.prepare("SELECT COUNT(*) as count FROM inputs").get() as { count: number }).count;
      const noteCount = (db.prepare("SELECT COUNT(*) as count FROM notes").get() as { count: number }).count;
      const linkCount = (db.prepare("SELECT COUNT(*) as count FROM input_note_links").get() as { count: number }).count;
      // Events now live in the git-synced JSONL log, not the SQLite table.
      const eventCount = dbManager.events.readAll().length;

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                initialized: true,
                path: getDbPath(),
                stats: {
                  inputs: inputCount,
                  notes: noteCount,
                  links: linkCount,
                  events: eventCount,
                },
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
    "db_init",
    {
      description:
        "Initialize the database. Creates the SQLite file and all tables. Fails if already initialized.",
      inputSchema: {
        path: z.string().optional().describe("Database file path. Uses the configured default if omitted."),
      },
    },
    async ({ path: overridePath }) => {
      const targetPath = overridePath ?? getDbPath();
      const already = dbManager.isInitialized();

      // Idempotent: the server auto-opens (and migrates) on startup when a path
      // is configured, so db_init usually finds the store already initialized.
      try {
        if (!already) {
          dbManager.open(targetPath);
        } else {
          dbManager.initialize(); // ensure schema (no-op if present)
        }
      } catch (err) {
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Failed to initialize database: ${err}` }],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                initialized: true,
                path: targetPath,
                message: already ? "Database already initialized." : "Database created and migrated successfully.",
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
