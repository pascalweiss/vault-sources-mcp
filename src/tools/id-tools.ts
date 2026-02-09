import { v7 as uuidv7 } from "uuid";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { FRONTMATTER_KEY } from "../types.js";

export function registerIdTools(server: McpServer): void {
  server.registerTool(
    "generate_note_id",
    {
      description:
        "Generate a new UUIDv7 note ID. Returns the ID and the frontmatter key to use. " +
        "Does NOT register the note — call register_note after the agent injects the ID into the markdown.",
    },
    async () => {
      const noteId = uuidv7();
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                note_id: noteId,
                frontmatter_key: FRONTMATTER_KEY,
                frontmatter_snippet: `${FRONTMATTER_KEY}: ${noteId}`,
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
