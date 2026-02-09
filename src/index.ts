#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { DatabaseManager } from "./db/database.js";
import { registerDbTools } from "./tools/db-tools.js";

const dbPath = process.argv[2] ?? process.env["VAULT_SOURCES_DB_PATH"] ?? "./data/vault-sources.sqlite";

const server = new McpServer({
  name: "vault-sources-mcp",
  version: "0.1.0",
});

const dbManager = new DatabaseManager();

registerDbTools(server, dbManager, dbPath);

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`vault-sources-mcp running (db: ${dbPath})`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
