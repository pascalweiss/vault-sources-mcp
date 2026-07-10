import { watch, type FSWatcher } from "node:fs";
import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import type { CanonicalEvent, CanonicalEventType } from "../types.js";
import { EventStore } from "../log/event-store.js";
import { Projector } from "../log/projector.js";
import { rebuildInto } from "../log/rebuild.js";
import { resolveNodeId } from "../log/node-id.js";
import { migrateLegacy } from "../log/migrate.js";
import { applySchema, deriveLogDir } from "./schema.js";

const POLL_INTERVAL_MS = 15_000;

/**
 * Coordinates the SQLite projection and the git-synced event log.
 *
 * - Writes go through `commit()`: append to the log (durable), then project into
 *   SQLite (local read cache).
 * - On open it migrates a legacy SQLite ledger once, then rebuilds the projection
 *   from the log.
 * - A poll+watch loop applies events that another environment appended (arriving
 *   over git pull), so a long-running server stays current without a restart.
 */
export class DatabaseManager {
  private db: DatabaseType | null = null;
  private store: EventStore | null = null;
  private projector: Projector | null = null;
  private offsets = new Map<string, number>();
  private watcher: FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;

  get connection(): DatabaseType {
    if (!this.db) throw new Error("Database not opened. Call open() first.");
    return this.db;
  }

  get events(): EventStore {
    if (!this.store) throw new Error("Event store not opened. Call open() first.");
    return this.store;
  }

  /** Open the projection + log, migrate/rebuild, and begin syncing. */
  open(dbPath: string): void {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    applySchema(this.db);

    const logDir = deriveLogDir(dbPath);
    const nodeId = resolveNodeId(logDir);
    this.store = new EventStore(logDir, nodeId);
    this.projector = new Projector(this.store);

    // One-time migration: log has no events yet but a legacy SQLite holds data.
    if (this.store.isEmpty() && legacyHasData(this.db)) {
      migrateLegacy(this.db, this.store, this.projector, dbPath);
    }

    // Bring the projection in line with the full log (fresh clone or drift).
    rebuildInto(this.db, this.store.readAll(), this.projector);
    this.offsets = this.store.currentOffsets();
    this.startSync();
  }

  /**
   * Commit a mutation: append to the log (the durable commit point), then apply
   * it to the local projection. Returns the canonical event.
   */
  commit(type: CanonicalEventType, payload: Record<string, unknown>): CanonicalEvent {
    const ev = this.events.append(type, payload);
    this.projector!.apply(ev, this.connection);
    return ev;
  }

  putInput(content: string): string {
    return this.events.putInput(content);
  }

  getInput(sha: string): string | null {
    return this.events.getInput(sha);
  }

  deleteInput(sha: string): void {
    this.events.deleteInput(sha);
  }

  /** Apply any events other nodes appended since the last check (idempotent). */
  catchUp(): void {
    if (!this.store || !this.projector || !this.db) return;
    const { events, offsets } = this.store.readSince(this.offsets);
    if (events.length > 0) {
      const apply = this.db.transaction((evs: CanonicalEvent[]) => {
        for (const ev of evs) this.projector!.apply(ev, this.db!);
      });
      apply(events);
    }
    this.offsets = offsets;
  }

  private startSync(): void {
    // Poll is the reliable baseline; fs.watch just makes pickup near-instant.
    this.pollTimer = setInterval(() => {
      try {
        this.catchUp();
      } catch (err) {
        console.error("[sync] catch-up failed:", err);
      }
    }, POLL_INTERVAL_MS);
    if (typeof this.pollTimer.unref === "function") this.pollTimer.unref();

    try {
      this.watcher = watch(this.events.eventsDirPath, () => {
        try {
          this.catchUp();
        } catch (err) {
          console.error("[sync] catch-up (watch) failed:", err);
        }
      });
    } catch {
      // fs.watch is best-effort; the poll loop still guarantees eventual pickup.
    }
  }

  isInitialized(): boolean {
    if (!this.db) return false;
    try {
      const row = this.db
        .prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='inputs'`)
        .get() as { name: string } | undefined;
      return row !== undefined;
    } catch {
      return false;
    }
  }

  /** Back-compat for the db_init tool. Schema is already applied by open(). */
  initialize(): void {
    applySchema(this.connection);
  }

  close(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.store = null;
    this.projector = null;
  }
}

/** True if the projection tables hold any provenance rows (legacy ledger present). */
function legacyHasData(db: DatabaseType): boolean {
  for (const table of ["inputs", "notes", "input_note_links"]) {
    const row = db.prepare(`SELECT 1 FROM ${table} LIMIT 1`).get();
    if (row) return true;
  }
  return false;
}
