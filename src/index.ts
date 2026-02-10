#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DatabaseManager } from "./db/database.js";
import { registerDbTools } from "./tools/db-tools.js";
import { registerIdTools } from "./tools/id-tools.js";
import { registerInputTools } from "./tools/input-tools.js";
import { registerNoteTools } from "./tools/note-tools.js";
import { registerLinkTools } from "./tools/link-tools.js";
import { registerReconciliationTools } from "./tools/reconciliation-tools.js";

const dbPath = process.argv[2] ?? process.env["VAULT_SOURCES_DB_PATH"] ?? "./data/vault-sources.sqlite";

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

registerDbTools(server, dbManager, dbPath);
registerIdTools(server);
registerInputTools(server, dbManager);
registerNoteTools(server, dbManager);
registerLinkTools(server, dbManager);
registerReconciliationTools(server, dbManager);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`vault-sources-mcp running (db: ${dbPath})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
