# vault-sources-mcp — Implementation Plan

This document breaks the project into sequential phases. Each phase is self-contained: it produces testable, working code before the next phase begins.

---

## Phase 0 — Project Scaffolding & Dummy Vault

**Goal:** Set up the TypeScript project structure, tooling, and a dummy Obsidian vault for manual testing.

### 0.1 Project Setup

- [ ] `npm install` all dependencies from existing `package.json`
- [ ] Create `tsconfig.json` (target ES2022, module NodeNext, strict mode, outDir `dist/`)
- [ ] Create directory structure:
  ```
  src/
    index.ts          # MCP server entry point
    db/               # database layer
    tools/            # MCP tool handlers
    types.ts          # shared types & interfaces
    errors.ts         # custom error classes
  test/
    fixtures/         # test helpers
  ```

### 0.2 Dummy Obsidian Vault

Create `test/dummy-vault/` — a minimal Obsidian-style folder of markdown files about **gardening**. This vault is purely for manual integration testing (the MCP server never reads it; the agent does).

```
test/dummy-vault/
  .obsidian/              # empty dir so Obsidian recognizes it
  Garden Planning.md
  Composting Basics.md
  Tomato Growing Guide.md
  Herb Spiral Design.md
  Seasonal Planting Calendar.md
  Pest Control Methods.md
  Soil Health.md
  Raised Bed Construction.md
```

Each file will:
- Have realistic gardening content (2-4 paragraphs)
- Some files will have YAML frontmatter (tags, aliases) to mirror a real vault
- **No** `vault_sources_mcp_id` yet — the agent is responsible for injecting those

### 0.3 Acceptance Criteria

- `npm run build` compiles without errors
- `npm run start` launches (even if it does nothing yet)
- Dummy vault files exist and are valid markdown

---

## Phase 1 — SQLite Database Layer

**Goal:** Implement the full data model (tables, migrations, event log) and expose it through a clean internal API.

### 1.1 Schema (single migration)

Tables to create:

**`inputs`**
| Column           | Type    | Notes                           |
| ---------------- | ------- | ------------------------------- |
| `input_id`       | TEXT PK | UUIDv7                          |
| `content`        | TEXT    | Raw text, immutable             |
| `content_sha256` | TEXT    | SHA-256 hex, indexed            |
| `state`          | TEXT    | `active` or `redacted`          |
| `created_at`     | TEXT    | ISO 8601                        |
| `meta_json`      | TEXT    | Optional JSON blob              |

**`notes`**
| Column         | Type    | Notes              |
| -------------- | ------- | ------------------ |
| `note_id`      | TEXT PK | UUIDv7             |
| `created_at`   | TEXT    | ISO 8601           |
| `last_seen_at` | TEXT    | ISO 8601           |
| `meta_json`    | TEXT    | Optional JSON blob |

**`input_note_links`**
| Column       | Type | Notes                                  |
| ------------ | ---- | -------------------------------------- |
| `input_id`   | TEXT | FK → inputs                            |
| `note_id`    | TEXT | FK → notes                             |
| `created_at` | TEXT | ISO 8601                               |
| PK           |      | Composite (`input_id`, `note_id`)      |

**`events`**
| Column       | Type        | Notes                        |
| ------------ | ----------- | ---------------------------- |
| `event_id`   | INTEGER PK  | AUTOINCREMENT                |
| `event_type` | TEXT        | e.g. `INPUT_STORED`          |
| `timestamp`  | TEXT        | ISO 8601                     |
| `payload`    | TEXT        | JSON with relevant IDs/data  |

### 1.2 Database Manager (`src/db/database.ts`)

- `open(path)` — open or create SQLite file
- `initialize()` — run migration, emit `DB_INITIALIZED` event
- `close()` — clean shutdown
- WAL mode enabled for performance

### 1.3 Repository Layer (`src/db/repositories/`)

One file per entity:

- `input-repository.ts` — CRUD for inputs, SHA-256 lookup, redaction
- `note-repository.ts` — register, update `last_seen_at`, mark deleted
- `link-repository.ts` — add/remove/query links (by note or by input)
- `event-repository.ts` — append event, query events by type/time/entity

### 1.4 Acceptance Criteria

- Unit tests for each repository (in-memory SQLite via `:memory:`)
- Events are emitted for every mutating operation
- Redacting an input nulls `content` but preserves row + links
- Duplicate input detection via `content_sha256`
- Foreign key constraints enforced

---

## Phase 2 — MCP Server Core & DB Management Tools

**Goal:** Wire up a working MCP server that handles transport and exposes database management tools.

### 2.1 MCP Server Bootstrap (`src/index.ts`)

- Use `@modelcontextprotocol/sdk` `Server` class
- stdio transport (standard for CLI-based MCP servers)
- Register tool handlers from `src/tools/`
- Accept `--db-path` CLI argument (or env var `VAULT_SOURCES_DB_PATH`)

### 2.2 Tools: Database Management (`src/tools/db-tools.ts`)

**`db_status`**
- Returns: `{ initialized: boolean, path: string, stats: { inputs, notes, links, events } }`
- If DB file doesn't exist → `{ initialized: false }`

**`db_init`**
- Creates and migrates the database
- Returns confirmation with path
- Emits `DB_INITIALIZED` event
- Fails if DB already exists (no silent re-init)

### 2.3 Acceptance Criteria

- Server starts via `node dist/index.js`
- `db_status` returns correct state before and after init
- `db_init` creates the file and tables
- Calling `db_init` twice returns an error

---

## Phase 3 — ID Management & Input Tools

**Goal:** Expose tools for generating note IDs and storing/managing inputs.

### 3.1 Tools: ID Management (`src/tools/id-tools.ts`)

**`generate_note_id`**
- Returns: `{ note_id: <uuidv7>, frontmatter_key: "vault_sources_mcp_id" }`
- Pure generation — does NOT register the note yet
- Agent uses this to build the frontmatter snippet

### 3.2 Tools: Input Management (`src/tools/input-tools.ts`)

**`store_input`**
- Params: `{ content: string, meta?: object }`
- Normalizes whitespace, computes SHA-256
- If duplicate hash exists: returns existing `input_id` with `duplicate: true`
- Otherwise: stores input, emits `INPUT_STORED`
- Returns: `{ input_id, content_sha256, duplicate: boolean }`

**`get_input`**
- Params: `{ input_id: string }`
- Returns input content + metadata (or `[REDACTED]` placeholder)

**`list_inputs`**
- Params: `{ limit?: number, offset?: number, state?: "active" | "redacted" }`
- Returns paginated list (without full content — just IDs, hashes, meta, timestamps)

**`redact_input`**
- Params: `{ input_id: string }`
- Nulls content, sets state to `redacted`
- Emits `INPUT_REDACTED`
- Links and metadata preserved

### 3.3 Acceptance Criteria

- UUIDv7 IDs are time-ordered and valid
- Storing the same content twice returns the same input with `duplicate: true`
- Redacted inputs return `[REDACTED]` for content but retain links
- All mutations emit events

---

## Phase 4 — Note Registration & Provenance Linking

**Goal:** Allow the agent to register notes and create/query provenance links.

### 4.1 Tools: Note Management (`src/tools/note-tools.ts`)

**`register_note`**
- Params: `{ note_id: string, meta?: object }`
- Registers the note in the DB (idempotent — updates `last_seen_at` if exists)
- Emits `NOTE_SEEN`
- Returns: `{ note_id, created_at, last_seen_at }`

**`get_note`**
- Params: `{ note_id: string }`
- Returns note record + list of linked input IDs

**`mark_note_deleted`**
- Params: `{ note_id: string }`
- Does NOT delete the row — marks it with metadata
- Emits `NOTE_MARKED_DELETED`

### 4.2 Tools: Provenance Linking (`src/tools/link-tools.ts`)

**`add_link`**
- Params: `{ input_id: string, note_id: string }`
- Both IDs must already exist in DB — error otherwise
- Idempotent (re-adding same link is a no-op)
- Emits `LINK_ADDED`

**`remove_link`**
- Params: `{ input_id: string, note_id: string }`
- Emits `LINK_REMOVED`

**`get_sources_for_note`**
- Params: `{ note_id: string }`
- Returns: list of inputs linked to this note (with metadata, without full content)

**`get_notes_for_input`**
- Params: `{ input_id: string }`
- Returns: list of notes linked to this input

### 4.3 Acceptance Criteria

- Linking a non-existent note or input returns a clear error
- `get_sources_for_note` returns all linked inputs
- `get_notes_for_input` returns all linked notes
- Removing a link emits an event but preserves both entities
- Full round-trip: store input → generate ID → register note → link → query

---

## Phase 5 — Reconciliation & Diagnostic Tools

**Goal:** Provide diagnostic queries that help the agent (and user) find inconsistencies.

### 5.1 Tools: Reconciliation (`src/tools/reconciliation-tools.ts`)

**`find_stale_notes`**
- Params: `{ not_seen_since: string }` (ISO date)
- Returns notes with `last_seen_at` older than threshold
- Agent can then check if the files still exist

**`find_orphaned_inputs`**
- Returns inputs with zero links
- Useful for cleanup

**`find_unlinked_notes`**
- Returns notes with zero input links
- These notes have no known provenance

**`get_event_log`**
- Params: `{ event_type?: string, since?: string, limit?: number }`
- Returns filtered, paginated event history

### 5.2 Acceptance Criteria

- Stale note detection respects the date threshold
- Orphaned inputs are correctly identified after link removal
- Event log is filterable and paginated
- All tools return structured JSON (no prose)

---

## Phase 6 — Integration Testing & Polish

**Goal:** End-to-end tests using the dummy vault scenario, error handling hardening, and documentation.

### 6.1 Integration Tests

Write integration tests that simulate the full agent workflow:

1. `db_init` → create database
2. `store_input` → store a "YouTube transcript about composting"
3. `generate_note_id` → get an ID
4. `register_note` → register "Composting Basics" note with the ID
5. `add_link` → link the input to the note
6. `get_sources_for_note` → verify the link
7. `redact_input` → redact the transcript
8. `get_sources_for_note` → verify link exists but content is redacted
9. `find_orphaned_inputs` → verify none (still linked)
10. `remove_link` → remove the link
11. `find_orphaned_inputs` → now the input appears

### 6.2 Error Handling

- Validate all input parameters (malformed UUIDs, missing required fields)
- Return structured MCP errors with clear messages
- Never crash the server on bad input

### 6.3 Acceptance Criteria

- Full integration test passes end-to-end
- Invalid inputs return helpful error messages
- Server handles concurrent calls safely (SQLite WAL mode)
- `npm run build && npm run test` passes cleanly

---

## Phase Summary

| Phase | Focus                          | Key Deliverable                       |
| ----- | ------------------------------ | ------------------------------------- |
| 0     | Scaffolding & Dummy Vault      | Compiling project + test vault        |
| 1     | SQLite Database Layer          | Schema + repositories + unit tests    |
| 2     | MCP Server & DB Tools          | Running server + `db_status`/`db_init`|
| 3     | ID & Input Tools               | `generate_note_id`, `store_input`, etc|
| 4     | Note & Link Tools              | `register_note`, `add_link`, queries  |
| 5     | Reconciliation Tools           | Diagnostics + event log               |
| 6     | Integration Tests & Polish     | End-to-end tests, error handling      |

---

## Dummy Vault Contents (Phase 0 Detail)

The following files will be created in `test/dummy-vault/`:

| File                           | Content Theme                                      |
| ------------------------------ | -------------------------------------------------- |
| `Garden Planning.md`           | Seasonal planning, zone maps, crop rotation        |
| `Composting Basics.md`         | Green/brown ratio, hot vs cold composting           |
| `Tomato Growing Guide.md`     | Varieties, staking, watering, common diseases       |
| `Herb Spiral Design.md`       | Permaculture herb spiral construction               |
| `Seasonal Planting Calendar.md`| Month-by-month planting guide                      |
| `Pest Control Methods.md`     | Organic pest control, companion planting            |
| `Soil Health.md`              | pH testing, amendments, cover crops                 |
| `Raised Bed Construction.md`  | Materials, dimensions, filling layers               |

Some files will include frontmatter with tags like `#gardening`, `#permaculture`, `#organic`. None will have `vault_sources_mcp_id` — that gets injected by the agent during testing.

---

## Technical Decisions

- **UUIDv7 generation**: Use `uuid` package v7 support (or polyfill with timestamp-based generation)
- **SHA-256**: Use Node.js built-in `crypto.createHash`
- **SQLite**: `better-sqlite3` (synchronous, fast, no async overhead)
- **MCP SDK**: `@modelcontextprotocol/sdk` with stdio transport
- **Testing**: Node.js built-in test runner (`node:test` + `node:assert`)
- **No ORM**: Direct SQL via `better-sqlite3` prepared statements
