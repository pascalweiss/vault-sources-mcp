import { z } from "zod";
import { v7 as uuidv7 } from "uuid";
import { readFile } from "node:fs/promises";
import { resolve, basename } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DatabaseManager } from "../db/database.js";
import { InputRepository } from "../db/repositories/input-repository.js";
import { DatabaseNotInitializedError, VaultSourcesError, FileReadError } from "../errors.js";

export function registerInputTools(server: McpServer, dbManager: DatabaseManager): void {
  function getRepo(): InputRepository {
    if (!dbManager.isInitialized()) throw new DatabaseNotInitializedError();
    return new InputRepository(dbManager.connection);
  }

  server.registerTool(
    "store_input",
    {
      description:
        "Store a raw input (transcript, article, excerpt, etc.). " +
        "Content is hashed for deduplication. Returns the input ID and whether it was a duplicate.",
      inputSchema: {
        content: z.string().min(1).describe("The raw text content to store."),
        meta: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional metadata (e.g. source URL, title, type)."),
      },
    },
    async ({ content, meta }) => {
      const repo = getRepo();
      const inputId = uuidv7();
      const { input, duplicate } = repo.store(inputId, content, meta as Record<string, unknown> | undefined);

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              {
                input_id: input.input_id,
                content_sha256: input.content_sha256,
                duplicate,
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
    "store_input_from_file",
    {
      description:
        "Store an input by reading from a file. Content is hashed for deduplication. " +
        "Automatically includes file path and filename in metadata. Returns the input ID and whether it was a duplicate.",
      inputSchema: {
        file_path: z.string().min(1).describe("Path to the file to read (relative or absolute)."),
        meta: z
          .record(z.string(), z.unknown())
          .optional()
          .describe("Optional additional metadata (e.g. source, title). User metadata takes precedence over auto-generated."),
      },
    },
    async ({ file_path, meta }) => {
      try {
        const absolutePath = resolve(file_path);
        let fileContent: string;

        try {
          fileContent = await readFile(absolutePath, "utf-8");
        } catch (err: unknown) {
          const error = err as NodeJS.ErrnoException;
          let cause = "Unknown error";

          if (error.code === "ENOENT") {
            cause = "File not found";
          } else if (error.code === "EACCES") {
            cause = "Permission denied";
          } else if (error.code === "EISDIR") {
            cause = "Path is a directory, not a file";
          } else if (error.message) {
            cause = error.message;
          }

          throw new FileReadError(file_path, cause);
        }

        if (fileContent.length === 0) {
          throw new FileReadError(file_path, "File is empty");
        }

        // Auto-generate file metadata and merge with user metadata
        const autoMeta = {
          file_path: absolutePath,
          filename: basename(absolutePath),
        };
        const mergedMeta = { ...autoMeta, ...(meta as Record<string, unknown> | undefined) };

        const repo = getRepo();
        const inputId = uuidv7();
        const { input, duplicate } = repo.store(inputId, fileContent, mergedMeta);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  input_id: input.input_id,
                  content_sha256: input.content_sha256,
                  duplicate,
                  file_path: absolutePath,
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
    "get_input",
    {
      description: "Retrieve an input by its ID. Returns content (or [REDACTED]) and metadata.",
      inputSchema: {
        input_id: z.string().describe("The input ID to retrieve."),
      },
    },
    async ({ input_id }) => {
      try {
        const repo = getRepo();
        const input = repo.getById(input_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  input_id: input.input_id,
                  content: input.state === "redacted" ? "[REDACTED]" : input.content,
                  content_sha256: input.content_sha256,
                  state: input.state,
                  created_at: input.created_at,
                  meta: input.meta_json ? JSON.parse(input.meta_json) : null,
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
    "list_inputs",
    {
      description: "List stored inputs (without full content). Supports pagination and state filtering.",
      inputSchema: {
        limit: z.number().int().min(1).max(500).optional().describe("Max results (default 100)."),
        offset: z.number().int().min(0).optional().describe("Offset for pagination."),
        state: z.enum(["active", "redacted"]).optional().describe("Filter by state."),
      },
    },
    async ({ limit, offset, state }) => {
      const repo = getRepo();
      const inputs = repo.list({ limit: limit ?? undefined, offset: offset ?? undefined, state: state ?? undefined });

      const summary = inputs.map((i) => ({
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
    "redact_input",
    {
      description:
        "Redact an input. Nulls the content but preserves metadata and provenance links. Irreversible.",
      inputSchema: {
        input_id: z.string().describe("The input ID to redact."),
      },
    },
    async ({ input_id }) => {
      try {
        const repo = getRepo();
        repo.redact(input_id);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({ input_id, state: "redacted", message: "Input redacted successfully." }, null, 2),
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
