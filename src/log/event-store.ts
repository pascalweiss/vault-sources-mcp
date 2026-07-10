import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { v7 as uuidv7 } from "uuid";
import type { CanonicalEvent, CanonicalEventType } from "../types.js";
import { sha256 } from "./hash.js";

/**
 * Owns the git-synced source of truth on disk:
 *
 *   <logDir>/events/<node-id>.jsonl   append-only, ONE writer (this node) per file
 *   <logDir>/inputs/<sha256>          immutable, content-addressed input bodies
 *
 * Only this environment appends to its own shard, so git never has to merge a
 * shard. Reads scan every shard (all environments) to reconstruct the full log.
 */
export class EventStore {
  private readonly eventsDir: string;
  private readonly inputsDir: string;
  private readonly shardPath: string;

  constructor(logDir: string, nodeId: string) {
    this.eventsDir = join(logDir, "events");
    this.inputsDir = join(logDir, "inputs");
    this.shardPath = join(this.eventsDir, `${nodeId}.jsonl`);
    this.ensureDirs();
  }

  private ensureDirs(): void {
    mkdirSync(this.eventsDir, { recursive: true });
    mkdirSync(this.inputsDir, { recursive: true });
  }

  // ---- content-addressed inputs ----

  /** Write the body under inputs/<sha> (if absent) and return its sha. */
  putInput(content: string): string {
    const sha = sha256(content);
    const target = join(this.inputsDir, sha);
    if (!existsSync(target)) {
      // Write to a temp file then rename so a reader never sees a partial body.
      const tmp = `${target}.tmp-${process.pid}-${uuidv7()}`;
      writeFileSync(tmp, content, "utf-8");
      renameSync(tmp, target);
    }
    return sha;
  }

  getInput(sha: string): string | null {
    const target = join(this.inputsDir, sha);
    if (!existsSync(target)) return null;
    return readFileSync(target, "utf-8");
  }

  hasInput(sha: string): boolean {
    return existsSync(join(this.inputsDir, sha));
  }

  /** Remove the working-tree body for a sha (redaction). Git history is unaffected. */
  deleteInput(sha: string): void {
    const target = join(this.inputsDir, sha);
    if (existsSync(target)) rmSync(target);
  }

  // ---- events ----

  /**
   * Append one event to this node's shard. Assigns a fresh UUIDv7 `uid` and an
   * ISO `ts`. The write is O_APPEND + fsync so a crash never leaves a torn line.
   */
  append(type: CanonicalEventType, payload: Record<string, unknown>): CanonicalEvent {
    const event: CanonicalEvent = {
      uid: uuidv7(),
      type,
      ts: new Date().toISOString(),
      payload,
    };
    this.appendRaw(event);
    return event;
  }

  /** Append a pre-built event verbatim (used by migration, which supplies uid+ts). */
  appendRaw(event: CanonicalEvent): void {
    const line = `${JSON.stringify(event)}\n`;
    const fd = openSync(this.shardPath, "a");
    try {
      writeSync(fd, line);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
  }

  /** Absolute paths of every shard file (all nodes), sorted for determinism. */
  listShards(): string[] {
    if (!existsSync(this.eventsDir)) return [];
    return readdirSync(this.eventsDir)
      .filter((f) => f.endsWith(".jsonl"))
      .sort()
      .map((f) => join(this.eventsDir, f));
  }

  /** True if no shard holds any event yet (fresh vault). */
  isEmpty(): boolean {
    return this.listShards().every((p) => statSync(p).size === 0);
  }

  /**
   * Every event from every shard, deduped by uid and sorted by (ts, uid).
   * Deterministic regardless of how git interleaved the shards.
   */
  readAll(): CanonicalEvent[] {
    const byUid = new Map<string, CanonicalEvent>();
    for (const shard of this.listShards()) {
      for (const ev of parseShard(readFileSync(shard, "utf-8"))) {
        if (!byUid.has(ev.uid)) byUid.set(ev.uid, ev);
      }
    }
    return [...byUid.values()].sort(compareEvents);
  }

  /**
   * Incremental read: for each shard, parse only the bytes past `offsets[shard]`
   * and return the new events plus the updated byte offsets. Used by the watcher
   * to pick up another environment's events after a git pull without a full rebuild.
   */
  readSince(offsets: Map<string, number>): {
    events: CanonicalEvent[];
    offsets: Map<string, number>;
  } {
    const next = new Map(offsets);
    const fresh: CanonicalEvent[] = [];
    for (const shard of this.listShards()) {
      const buf = readFileSync(shard, "utf-8");
      const start = offsets.get(shard) ?? 0;
      if (buf.length <= start) {
        next.set(shard, buf.length);
        continue;
      }
      // Only parse from the last newline at/under `start` to avoid a torn line.
      const safeStart = start === 0 ? 0 : buf.lastIndexOf("\n", start - 1) + 1;
      fresh.push(...parseShard(buf.slice(safeStart)));
      next.set(shard, buf.length);
    }
    fresh.sort(compareEvents);
    return { events: fresh, offsets: next };
  }

  /** Current byte size of every shard (watcher's starting high-water mark). */
  currentOffsets(): Map<string, number> {
    const m = new Map<string, number>();
    for (const shard of this.listShards()) m.set(shard, statSync(shard).size);
    return m;
  }

  get eventsDirPath(): string {
    return this.eventsDir;
  }
}

function parseShard(text: string): CanonicalEvent[] {
  const events: CanonicalEvent[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as CanonicalEvent);
    } catch {
      // Skip a corrupt/half-written line rather than abort the whole rebuild.
    }
  }
  return events;
}

function compareEvents(a: CanonicalEvent, b: CanonicalEvent): number {
  if (a.ts < b.ts) return -1;
  if (a.ts > b.ts) return 1;
  if (a.uid < b.uid) return -1;
  if (a.uid > b.uid) return 1;
  return 0;
}
