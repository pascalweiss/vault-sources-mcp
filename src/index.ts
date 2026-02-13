#!/usr/bin/env node

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { DatabaseManager } from "./db/database.js";
import { registerDbTools } from "./tools/db-tools.js";
import { registerIdTools } from "./tools/id-tools.js";
import { registerInputTools } from "./tools/input-tools.js";
import { registerNoteTools } from "./tools/note-tools.js";
import { registerLinkTools } from "./tools/link-tools.js";
import { registerReconciliationTools } from "./tools/reconciliation-tools.js";

/**
 * Resolve the database path from explicit configuration (CLI arg, env vars).
 * Returns null when no explicit config is provided — the path will be
 * resolved from MCP client roots after the handshake completes.
 */
function resolveDbPath(): string | null {
  // 1. Explicit CLI argument
  if (process.argv[2]) return process.argv[2];

  // 2. Explicit env var
  if (process.env["VAULT_SOURCES_DB_PATH"]) return process.env["VAULT_SOURCES_DB_PATH"];

  // 3. Derive from VAULT_PATH — store DB inside the vault
  const vaultPath = process.env["VAULT_PATH"];
  if (vaultPath) return `${vaultPath}/.vault-sources.sqlite`;

  // 4. No explicit config — will resolve from MCP roots
  return null;
}

/**
 * Auto-detect the vault path from the MCP client's roots and derive the DB path.
 */
async function resolveDbPathFromRoots(lowLevelServer: Server): Promise<string> {
  const capabilities = lowLevelServer.getClientCapabilities();
  if (!capabilities?.roots) {
    throw new Error(
      "No database path configured and the MCP client does not support roots.\n" +
      "Either set VAULT_SOURCES_DB_PATH or VAULT_PATH, or use an MCP client that provides roots.",
    );
  }

  const { roots } = await lowLevelServer.listRoots();

  if (roots.length === 0) {
    throw new Error(
      "No database path configured and the MCP client reported no roots.\n" +
      "Set VAULT_SOURCES_DB_PATH or VAULT_PATH to configure the database location.",
    );
  }

  const fileRoot = roots.find((r) => r.uri.startsWith("file://"));
  if (!fileRoot) {
    throw new Error(
      "No database path configured and no file:// roots found from the MCP client.\n" +
      "Set VAULT_SOURCES_DB_PATH or VAULT_PATH to configure the database location.",
    );
  }

  const rootPath = fileURLToPath(fileRoot.uri);
  console.error(`Auto-detected vault path from MCP roots: ${rootPath}`);
  return `${rootPath}/.vault-sources.sqlite`;
}

// Mutable config — dbPath may be updated after MCP initialization
const config = { dbPath: resolveDbPath() ?? "./data/vault-sources.sqlite" };
const hasExplicitConfig = resolveDbPath() !== null;

const server = new McpServer(
  {
    name: "vault-sources-mcp",
    version: "0.1.0",
    title: "Vault Sources",
    description:
      "Provenance ledger for AI-generated Obsidian vaults. " +
      "Tracks which inputs (transcripts, articles, excerpts) produced which notes, " +
      "without ever touching the vault itself.",
    websiteUrl: "https://github.com/pascalweiss/vault-sources-mcp",
  },
  {
    instructions: [
      "This server tracks provenance for an Obsidian vault — it records which source inputs were used to create which notes.",
      "",
      "Typical workflow:",
      "1. Initialize the database with db_init (one-time setup).",
      "2. Store raw source material (transcripts, articles, etc.) with store_input.",
      "3. When creating a vault note, call generate_note_id to get a UUIDv7, embed it in the note's YAML frontmatter, then register_note.",
      "4. Link sources to notes with add_link to establish provenance.",
      "5. Query provenance with get_sources_for_note / get_notes_for_input.",
      "6. Run find_orphaned_inputs, find_unlinked_notes, or find_stale_notes for health checks.",
      "",
      "The server never reads or writes vault files — it only manages the provenance database.",
    ].join("\n"),
  },
);

const dbManager = new DatabaseManager();

// Auto-open existing DB on startup (only when path is already known)
if (hasExplicitConfig && existsSync(config.dbPath)) {
  dbManager.open(config.dbPath);
}

// Register tools — db-tools receives a getter so it reads the resolved path at call time
registerDbTools(server, dbManager, () => config.dbPath);
registerIdTools(server);
registerInputTools(server, dbManager);
registerNoteTools(server, dbManager);
registerLinkTools(server, dbManager);
registerReconciliationTools(server, dbManager);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();

  if (!hasExplicitConfig) {
    // Resolve DB path from MCP roots after handshake completes
    const lowLevelServer = server.server;

    await new Promise<void>((resolve, reject) => {
      lowLevelServer.oninitialized = async () => {
        try {
          config.dbPath = await resolveDbPathFromRoots(lowLevelServer);

          // Auto-open if DB file already exists
          if (existsSync(config.dbPath)) {
            dbManager.open(config.dbPath);
          }

          resolve();
        } catch (err) {
          reject(err);
        }
      };

      server.connect(transport).catch(reject);
    });
  } else {
    await server.connect(transport);
  }

  console.error(`vault-sources-mcp running (db: ${config.dbPath})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
