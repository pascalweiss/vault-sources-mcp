import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { v7 as uuidv7 } from "uuid";

/**
 * A node-id names the single writer of one JSONL shard. Two environments MUST
 * have distinct node-ids, otherwise they append to the same shard file and git
 * cannot merge it. Resolution order:
 *
 *   1. VAULT_SOURCES_NODE_ID env var (explicit, recommended for pods/CI).
 *   2. `.vault-sources/node` marker file (gitignored, stable per machine).
 *   3. A fresh random id, persisted to the marker file.
 *
 * The marker file is per-machine and never committed, so a fresh git clone on a
 * new machine gets its own id automatically.
 */
export function resolveNodeId(logDir: string): string {
  const fromEnv = process.env["VAULT_SOURCES_NODE_ID"]?.trim();
  if (fromEnv) return sanitize(fromEnv);

  const markerPath = join(logDir, "node");
  if (existsSync(markerPath)) {
    const existing = readFileSync(markerPath, "utf-8").trim();
    if (existing) return sanitize(existing);
  }

  const generated = `node-${uuidv7()}`;
  mkdirSync(logDir, { recursive: true });
  writeFileSync(markerPath, `${generated}\n`, "utf-8");
  return generated;
}

/**
 * Restrict a node-id to filesystem-safe characters so it can be a shard filename.
 * Anything outside [A-Za-z0-9._-] collapses to a single dash.
 */
export function sanitize(id: string): string {
  const cleaned = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!cleaned) throw new Error(`Node-id "${id}" has no filesystem-safe characters.`);
  return cleaned;
}
