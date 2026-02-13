import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { DatabaseManager } from "../db/database.js";
import { DatabaseAlreadyInitializedError } from "../errors.js";

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
      const eventCount = (db.prepare("SELECT COUNT(*) as count FROM events").get() as { count: number }).count;

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
      if (dbManager.isInitialized()) {
        throw new DatabaseAlreadyInitializedError();
      }

      const targetPath = overridePath ?? getDbPath();

      try {
        if (!dbManager.isInitialized()) {
          dbManager.open(targetPath);
        }
        dbManager.initialize();
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
                message: "Database created and migrated successfully.",
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
