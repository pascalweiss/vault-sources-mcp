import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseManager } from "../src/db/database.js";

export interface TestDb {
  dbm: DatabaseManager;
  dir: string;
  dbPath: string;
  cleanup(): void;
}

/**
 * A DatabaseManager backed by a throwaway temp directory. The event log needs a
 * real directory (it is git-synced on disk), so tests can't use ":memory:".
 * Each call gets an isolated vault dir; cleanup() closes the manager (stopping
 * its sync timers/watchers) and removes the dir.
 */
export function openTestDb(): TestDb {
  const dir = mkdtempSync(join(tmpdir(), "vs-test-"));
  const dbPath = join(dir, ".vault-sources.sqlite");
  const dbm = new DatabaseManager();
  dbm.open(dbPath);
  return {
    dbm,
    dir,
    dbPath,
    cleanup() {
      dbm.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}
