---
name: vault-init
description: Initialize the vault-sources provenance database. Use when setting up a new project, when the database doesn't exist yet, or when the user asks to initialize or set up source tracking.
disable-model-invocation: true
---

# Initialize Vault Sources Database

Set up the provenance database for tracking input sources in this Obsidian vault.

## Steps

1. Call the `db_status` MCP tool to check if the database is already initialized.
2. If already initialized, report the current statistics (number of inputs, notes, links, events) and stop.
3. If not initialized, **ask the user for confirmation** before proceeding.
4. Call the `db_init` MCP tool to create and migrate the database.
5. Call `db_status` again to confirm successful initialization.
6. Report the database path and confirm that all tables were created.

## Important

- Never create the database silently. Always ask the user first.
- If `db_init` fails because the database already exists, report this clearly.
- The database path is configured via the `VAULT_SOURCES_DB_PATH` environment variable.
