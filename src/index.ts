#!/usr/bin/env node

/**
 * vault-sources-mcp — MCP Server entry point.
 *
 * Implements the Model Context Protocol over stdio transport.
 * Tools are registered in subsequent phases.
 */

import { FRONTMATTER_KEY } from "./types.js";

function main(): void {
  const dbPath = process.argv[2] ?? process.env["VAULT_SOURCES_DB_PATH"] ?? "./data/vault-sources.sqlite";

  // Placeholder: MCP server setup happens in Phase 2
  console.error(`vault-sources-mcp starting (db: ${dbPath}, frontmatter key: ${FRONTMATTER_KEY})`);
}

main();
