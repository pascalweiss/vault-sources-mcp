# Plan: Git-syncable provenance via an event log (SQLite becomes a derived cache)

Created: 2026-07-07

## Problem

`vault-sources-mcp` stores everything in a single SQLite file. Multiple environments
(the personal-assistant pod, the local Mac, potentially others) use the same
git-synced markdown vaults and each run their own server instance. SQLite is binary:
git cannot merge it, and concurrent writes from two environments produce binary
conflicts that silently drop provenance. We want the provenance to sync over git as
cleanly and conflict-free as the markdown notes do.

Existing populated ledgers that must migrate without data loss:

| Vault | SQLite size | Lives in |
|---|---|---|
| `app-market-gap-vault` | ~5.2M | second-brain pod |
| `obsidian-vaults/trading` | ~2.1M | local Mac |
| `obsidian-vaults/it` | ~384K | local Mac |
| `dev/vault-sources-mcp/data` | ~128K | test, disposable |
| `knowledge/personal-knowledge-base` | empty | pod + Mac (fresh) |

## Design

**Event-sourced store. SQLite stops being the source of truth and becomes a
rebuildable projection (cache).** The durable, git-synced source of truth is an
append-only event log, sharded per writer so two environments never touch the same
file (disjoint files ⇒ git never conflicts, no merge strategy needed).

### On-disk layout (inside each vault, syncs with the notes)

```
.vault-sources/
  events/
    <node-id>.jsonl        # append-only, ONE writer per file (e.g. pa-pod.jsonl, mac-local.jsonl)
  inputs/
    <sha256>               # content-addressed input bodies, immutable
  node                     # local node-id marker (gitignored, per-machine)
.vault-sources.sqlite      # derived projection, gitignored, rebuilt from the log
```

- **`events/<node-id>.jsonl`**: one canonical JSON event per line:
  `{ "uid": "<uuidv7>", "type": "INPUT_STORED|NOTE_REGISTERED|LINK_ADDED|LINK_REMOVED|INPUT_REDACTED|NOTE_DELETED", "ts": "<iso>", "payload": {...} }`.
  `uid` is a UUIDv7 (globally unique + time-ordered). Only this environment appends here.
- **`inputs/<sha256>`**: raw input body, keyed by content hash. Same content ⇒ same
  file ⇒ dedup for free and no conflicts. Events reference the sha, not the body
  (keeps the JSONL small).

### Why it is conflict-free and correct

1. Disjoint shard files ⇒ trivial git merges.
2. Content-addressed inputs ⇒ immutable, deduped, never conflict.
3. `uid` = UUIDv7 ⇒ globally unique and time-orderable.
4. Replay is idempotent + order-tolerant: rebuild = read all shards, dedup by `uid`,
   sort by `(ts, uid)`, apply. Deterministic regardless of how git interleaves shards.

## Component changes (current code → target)

Current: `src/db/database.ts` (schema + WAL + `appendEvent`), `src/db/repositories/*`
(each write also `events.append(type, payload)`), `src/tools/*`, `src/index.ts`,
`src/types.ts` (`FRONTMATTER_KEY = "vault_sources_mcp_id"`).

1. **`EventStore` (new, `src/log/event-store.ts`)**: owns `.vault-sources/events/<node>.jsonl`
   and `.vault-sources/inputs/`. `append(event)` = write content file if needed +
   atomically append the JSONL line (`O_APPEND` + fsync). Assigns `uid` (UUIDv7) + `ts`.
2. **`Projector` (new, `src/log/projector.ts`)**: `apply(event, db)` mutates the SQLite
   projection for one event. Pure function of (event, current state). Idempotent
   (ignore already-applied `uid`).
3. **Refactor repositories** to the pattern: build event → `eventStore.append(event)`
   (durable commit point) → `projector.apply(event, db)` (local read cache). No more
   direct-to-SQLite writes as the source of truth.
4. **Rebuild + incremental sync (`src/log/sync.ts`)**:
   - Startup: if projection missing/behind, rebuild into a temp DB then atomically swap.
   - `sync_state` table (`shard_file → last_uid`) as per-shard high-water mark.
   - Long-running freshness: `fs.watch` on `.vault-sources/events/` (fallback: poll
     every ~10s). On change, read new lines past the high-water mark and `apply`.
     This is how one environment picks up the other's events after `git pull`.
5. **Content-addressed inputs**: `store_input` writes `inputs/<sha256>`; `get_input`
   reads the file. Keep `inputs.content` in the projection during transition for
   verification, drop later (decision below).
6. **Redaction**: `redact_input` → `INPUT_REDACTED` tombstone + delete the working-tree
   `inputs/<sha256>` file. Projection sets `state=redacted`. (Caveat: git history keeps
   the content; see caveats.)
7. **Config**: `VAULT_SOURCES_NODE_ID` env. If unset, read/create a random id in the
   gitignored `.vault-sources/node` file (stable per machine, never committed).
8. **.gitignore**: ignore `.vault-sources.sqlite*` and `.vault-sources/node`; TRACK
   `.vault-sources/events/` and `.vault-sources/inputs/`.

## Migration (automatic, one-time per vault, verified)

**Design decision (revised after reading the code): migrate from the STATE tables,
not the legacy `events` table.** The legacy `events` rows carry no `meta` (metadata
lives only in the `inputs`/`notes` rows), so replaying them would lose it. Synthesizing
events from the state tables reproduces the live provenance faithfully (identity,
content, links, redaction/deletion + meta). Pre-migration audit history is collapsed
to net state; the untouched `.pre-migration` backup retains the original if ever needed.

On startup, if `.vault-sources/events/` is empty AND the legacy projection holds data:

1. **Backup first**: copy the legacy DB to `.vault-sources.sqlite.pre-migration` before
   touching anything.
2. **Synthesize events from state**: for each `inputs` row → `INPUT_STORED` (+ `INPUT_REDACTED`
   at `created_at+1ms` if redacted); each `notes` row → `NOTE_REGISTERED` (+ a second one at
   `last_seen_at` to preserve it; deleted flag carried in meta); each `input_note_links` row
   → `LINK_ADDED`. ts = the row's `created_at`. Active input bodies are dumped to
   `inputs/<sha>`.
3. **Verification gate**: replay the synthesized events into a throwaway **in-memory**
   projection and assert its `inputs` (id+sha+state) / `notes` (id+deleted) /
   `input_note_links` sets equal the legacy state. This happens BEFORE any shard is
   written, so a mismatch aborts with the real DB + backup untouched. Never silently lose data.
4. **Commit**: only on a clean gate, append the shard and rebuild the real projection.
5. Idempotent: guarded by shard emptiness (a second open sees a non-empty log and skips).

Schema facts that make this clean (verified): `inputs` has `content` + `content_sha256`
+ `state` + `created_at` + `meta_json`; `notes` have `created_at` + `last_seen_at` +
`meta_json`; `links` have `created_at`. Nothing needs to be guessed.

## Cross-environment sync flow (steady state)

1. Env A writes → appends to `events/A.jsonl` (+ maybe `inputs/<sha>`), applies to its cache.
2. The vault's git sidecar (notes-sync in the pod / your local git) commits + pushes
   `.vault-sources/**` alongside the notes.
3. Env B pulls → its watcher sees new lines in `events/A.jsonl`, applies them past its
   high-water mark. Content files arrive with the same pull.
4. No merges, no conflicts. Eventual consistency at pull cadence.

## Edge cases & caveats

- **Same vault populated independently in two envs before migration**: two shards with
  distinct input-ids for identical content (deduped at the file level by sha, duplicated
  at the record level). Not the case for the current ledgers (each populated in one
  place); add a sha-based dedup pass only if it ever happens.
- **Redaction vs git history**: deleting the content file removes it from the working
  tree, not from git history. Real secret-scrubbing needs history rewrite. Document;
  do not put secrets you must be able to hard-delete into inputs.
- **Node-id collisions**: two envs sharing a node-id would append to the same shard and
  conflict. Node-id must be unique per environment (explicit env var recommended).
- **Rebuild atomicity**: always build into a temp DB and swap, so a crash mid-rebuild
  never leaves a half-projection.

## Testing

- Projector: apply each event type; apply-twice = no-op (idempotent); shuffled order +
  sort = identical state (order-tolerant).
- EventStore: concurrent appends within one process are serialized; append is atomic.
- Migration: fixture legacy DBs (small + a redaction case) → migrate → projection equals
  legacy state; verification gate triggers fallback on a deliberately truncated event log.
- Cross-env: two disjoint shards → union rebuild = merged state; content dedup holds.
- Golden: migrate a copy of the real `it` (384K) ledger offline and diff state.

## Rollout phases

1. EventStore + Projector + content-addressed inputs + repository refactor (SQLite still
   works as before, now as a projection). Ship behind the same tool surface.
2. Rebuild-on-start + incremental watcher + `sync_state`.
3. Auto-migration + verification gate.
4. Config (`VAULT_SOURCES_NODE_ID`), `.gitignore`, README/AGENTS docs.
5. Version bump, publish to Nexus via CI (tag), bump the pin in the PA `release.yaml`
   and set `VAULT_SOURCES_NODE_ID=pa-pod`; set a distinct id locally.
6. Migrate the ledgers in low-risk order: `it` → `trading` → `app-market-gap` (pod).
   Verify each (state diff + `.sqlite.pre-migration` kept until confirmed), commit the
   `.vault-sources/**` into each vault's repo.

## Decisions (resolved 2026-07-10, implemented)

1. **Node-id scheme**: explicit `VAULT_SOURCES_NODE_ID` per env, fallback to a random
   id in the gitignored `.vault-sources/node`. ✅ implemented in `src/log/node-id.ts`.
2. **`inputs.content` in the projection**: KEPT as a hydrated cache during this version
   (the projector reads the body from `inputs/<sha>` and stores it in the column so all
   read paths work unchanged). Source of truth is the file; dropping the column is a
   later cleanup. ✅
3. **Redaction/history**: accept working-tree-only redaction (git history retains the
   body); documented in the README caveats. No history-scrub tool for now. ✅
4. **Rollout order**: local vaults first (`it` → `trading`), pod (`app-market-gap`) last;
   keep `.sqlite.pre-migration` backups until each is confirmed. (rollout pending)

## Status (2026-07-10)

Implemented + published as `@pwlab/vault-sources-mcp@0.2.2` (0.2.0 core; 0.2.1
WAL-checkpoint-before-backup; 0.2.2 startup auto-init + idempotent db_init). 67 tests
pass under Node 24 (local Node 26 cannot compile better-sqlite3 12.6.2, so tests run via
`/opt/homebrew/opt/node@24/bin`).

**Rolled out:**
- PA pod → 0.2.2 + `VAULT_SOURCES_NODE_ID=pa-pod` (homelab `86804a85`); auto-init verified in-pod.
- Local Mac KB client wired (node@24 binary, `mac-local`).
- `obsidian-vaults/it` + `obsidian-vaults/trading` migrated, verified, committed + pushed.

**Deferred:** pod `app-market-gap` (second-brain) — needs vault-sources wired into the
second-brain release first; single-env, no cross-env need.
