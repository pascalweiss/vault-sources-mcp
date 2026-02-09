# vault-sources-mcp

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node Version](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen.svg)](package.json)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.3-blue.svg)](https://www.typescriptlang.org/)

> **"Where did this note come from?"** — A provenance ledger for AI-generated Obsidian vaults.

An [MCP](https://modelcontextprotocol.io/) server that tracks **which inputs** (transcripts, articles, excerpts) produced **which notes** in your Obsidian vault — without ever touching the vault itself.

---

## The Problem

You use an AI agent to populate an Obsidian vault from YouTube transcripts, book excerpts, articles, and pasted text. Over time, the vault grows into a rich knowledge base — but the *origins* of that knowledge disappear:

- Chat history gets lost. Copy-paste sources are forgotten.
- You can't answer **"where did this note come from?"**
- There's no way to audit, reconcile, or clean up AI-generated content.
- When something looks wrong, you can't trace it back to the source.

## The Solution

`vault-sources-mcp` is a **provenance ledger** that sits alongside your vault. It gives any MCP-compatible AI agent the ability to:

- **Store raw inputs** (transcripts, articles, etc.) with SHA-256 deduplication
- **Link inputs to notes** via stable UUIDv7 identifiers in frontmatter
- **Query provenance** in both directions — sources for a note, notes for a source
- **Diagnose problems** — find orphaned inputs, stale notes, missing links
- **Audit everything** via an immutable, append-only event log

All data lives in a single SQLite file. The server never reads or writes your vault.

---

## How It Works

```
┌──────────────┐                              ┌──────────────────────┐
│   AI Agent   │◄── MCP (15 tools) ──────────►│  vault-sources-mcp   │
│              │                               │                      │
│  Reads/edits │                               │  Stores inputs,      │
│  markdown    │                               │  tracks links,       │
│  files       │                               │  logs events         │
└──────┬───────┘                               └──────────┬───────────┘
       │                                                  │
       ▼                                                  ▼
┌──────────────┐                               ┌──────────────────────┐
│  Obsidian    │                               │  SQLite database     │
│  Vault       │                               │  (single file)       │
└──────────────┘                               └──────────────────────┘
```

The agent handles all vault interactions. The MCP server handles all provenance data. They communicate through 15 structured tools.

---

## Installation

```bash
git clone https://github.com/your-username/vault-sources-mcp.git
cd vault-sources-mcp
npm install
npm run build
```

---

## Usage

### 1. Via `.mcp.json` (Claude Code Projects)

Create a `.mcp.json` file in your project root. Claude Code automatically loads this file when starting in the directory:

```json
{
  "mcpServers": {
    "vault-sources": {
      "command": "node",
      "args": ["/path/to/vault-sources-mcp/dist/src/index.js"],
      "env": {
        "VAULT_SOURCES_DB_PATH": "/path/to/vault-sources.sqlite"
      }
    }
  }
}
```

### 2. Via Claude CLI

```bash
claude mcp add --transport stdio \
  --env VAULT_SOURCES_DB_PATH=/path/to/vault-sources.sqlite \
  vault-sources -- node /path/to/vault-sources-mcp/dist/src/index.js
```

> **Note:** All options (`--transport`, `--env`, `--scope`) must come **before** the server name. The `--` separates the server name from the command and arguments.

### 3. With Claude Desktop (Global)

Add to your Claude Desktop configuration:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "vault-sources": {
      "command": "node",
      "args": ["/path/to/vault-sources-mcp/dist/src/index.js"],
      "env": {
        "VAULT_SOURCES_DB_PATH": "/path/to/vault-sources.sqlite"
      }
    }
  }
}
```

### 4. With Gemini CLI

Add to `~/.gemini/settings.json`:

```json
{
  "mcpServers": {
    "vault-sources": {
      "command": "node",
      "args": ["/path/to/vault-sources-mcp/dist/src/index.js"],
      "env": {
        "VAULT_SOURCES_DB_PATH": "/path/to/vault-sources.sqlite"
      }
    }
  }
}
```

### 5. With Codex CLI (OpenAI)

Add to `~/.codex/config.toml`:

```toml
[mcp_servers.vault-sources]
command = "node"
args = ["/path/to/vault-sources-mcp/dist/src/index.js"]

[mcp_servers.vault-sources.env]
VAULT_SOURCES_DB_PATH = "/path/to/vault-sources.sqlite"
```

> **Note:** MCP is an open standard. Any MCP-compatible client can use this server via stdio transport.

---

## Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `VAULT_SOURCES_DB_PATH` | Path to the SQLite database file | `./data/vault-sources.sqlite` |

The database path can also be passed as the first CLI argument:

```bash
node dist/src/index.js /custom/path/to/vault-sources.sqlite
```

---

## MCP Tools

### Database Management

| Tool | Description |
|------|-------------|
| `db_status` | Check if the database is initialized and get statistics (inputs, notes, links, events) |
| `db_init` | Create and migrate the database. Explicit — never created silently |

### Input Management

| Tool | Description |
|------|-------------|
| `store_input` | Store raw text (transcript, article, excerpt) with automatic SHA-256 deduplication |
| `get_input` | Retrieve an input by ID. Returns `[REDACTED]` if the input has been redacted |
| `list_inputs` | List stored inputs (metadata only) with pagination and state filtering |
| `redact_input` | Permanently remove content but preserve metadata, links, and audit trail |

### Note Management

| Tool | Description |
|------|-------------|
| `generate_note_id` | Generate a UUIDv7 and the frontmatter snippet to inject into a note |
| `register_note` | Register a note in the database. Idempotent — updates `last_seen_at` on repeat calls |
| `get_note` | Get a note record including its list of linked input IDs |
| `mark_note_deleted` | Soft-delete a note. Preserves the record for audit purposes |

### Provenance Links

| Tool | Description |
|------|-------------|
| `add_link` | Create a provenance link between an input and a note. Many-to-many, idempotent |
| `remove_link` | Remove a provenance link between an input and a note |
| `get_sources_for_note` | **Given a note, find its sources.** Returns all linked inputs |
| `get_notes_for_input` | **Given a source, find affected notes.** Returns all linked notes |

### Reconciliation & Diagnostics

| Tool | Description |
|------|-------------|
| `find_stale_notes` | Notes not seen since a given date — the agent can check if the files still exist |
| `find_orphaned_inputs` | Inputs that were stored but never linked to any note |
| `find_unlinked_notes` | Notes with no known provenance — no input has been linked |
| `get_event_log` | Query the append-only event log. Filter by type, time range, with pagination |

---

## Typical Workflow

Here's what a conversation with an MCP-connected agent looks like in practice:

```
1.  User provides a YouTube transcript
2.  Agent calls  store_input           → persists the transcript, gets input_id
3.  Agent calls  generate_note_id      → gets a UUIDv7 for the new note
4.  Agent writes the markdown file with the ID in frontmatter
5.  Agent calls  register_note         → registers the note in the provenance DB
6.  Agent calls  add_link              → links the transcript to the note
```

Later, the user asks *"where did my Composting Basics note come from?"*:

```
7.  Agent calls  get_sources_for_note  → returns the linked transcript metadata
8.  Agent calls  get_input             → retrieves the full original text
```

For periodic vault health checks:

```
9.  Agent calls  find_stale_notes      → which notes haven't been seen recently?
10. Agent calls  find_orphaned_inputs  → which inputs were never used?
11. Agent calls  get_event_log         → full audit trail of every action
```

---

## Design Principles

| Principle | What it means |
|-----------|---------------|
| **Separation of concerns** | The server never reads or writes vault files. All vault interactions are the agent's job. |
| **Provenance, not duplication** | Inputs live outside the vault. Notes don't link to inputs. Relationships exist only in the ledger. |
| **Auditability** | Every mutation produces an immutable event. The log is append-only and never modified. |
| **Explicit over implicit** | The database is never created silently. IDs require user approval. Reconciliation suggests — it never auto-fixes. |

---

## Project Structure

```
vault-sources-mcp/
├── src/
│   ├── index.ts                    # MCP server entry point (stdio transport)
│   ├── types.ts                    # Core types: Input, Note, Link, Event
│   ├── errors.ts                   # Custom error classes
│   ├── db/
│   │   ├── database.ts             # SQLite manager (WAL mode, FK enforcement)
│   │   └── repositories/
│   │       ├── input-repository.ts # Store, deduplicate, redact inputs
│   │       ├── note-repository.ts  # Register, find stale/unlinked notes
│   │       ├── link-repository.ts  # Provenance links, orphan detection
│   │       └── event-repository.ts # Append-only audit log
│   └── tools/
│       ├── db-tools.ts             # db_status, db_init
│       ├── id-tools.ts             # generate_note_id
│       ├── input-tools.ts          # store, get, list, redact
│       ├── note-tools.ts           # register, get, mark deleted
│       ├── link-tools.ts           # add, remove, query both directions
│       └── reconciliation-tools.ts # Diagnostics & event log queries
├── test/
│   ├── db/                         # Unit tests (40 tests)
│   ├── integration.test.ts         # End-to-end workflow test (4 tests)
│   └── dummy-vault/                # Sample Obsidian vault (gardening notes)
└── dist/                           # Compiled output
```

---

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npm test             # Run all 44 tests
npm run dev          # Watch mode (recompile on change)
npm run clean        # Remove compiled output
```

---

## License

MIT
