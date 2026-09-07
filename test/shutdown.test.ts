import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * The server must exit when its client closes stdin.
 *
 * This is not a nicety. A stdio server is spawned per client, and OpenClaw's SSH
 * sandbox backend spawns one per agent run. When the sync machinery holds the event
 * loop open (an fs.watch that is not unref'd, a timer that is not), a finished run
 * leaves a live server behind, and the pod walks into its memory limit at roughly one
 * leaked process per run. That is what this test catches.
 */

const ENTRY = resolve(dirname(fileURLToPath(import.meta.url)), "../src/index.js");
const EXIT_BUDGET_MS = 10_000;

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2024-11-05",
    capabilities: {},
    clientInfo: { name: "shutdown-test", version: "0" },
  },
});

/**
 * Run the server against a throwaway vault, write `stdinPayload` (if any), close the
 * pipe, and report how it ended. A server that never exits is reported as timed out
 * rather than left running.
 */
async function runUntilExit(stdinPayload: string | null): Promise<{
  timedOut: boolean;
  code: number | null;
  stdout: string;
}> {
  const dir = mkdtempSync(join(tmpdir(), "vs-shutdown-"));
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, VAULT_PATH: dir },
    stdio: ["pipe", "pipe", "pipe"],
  });

  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.resume();

  if (stdinPayload !== null) child.stdin.write(stdinPayload + "\n");
  child.stdin.end();

  try {
    return await new Promise((resolvePromise) => {
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        resolvePromise({ timedOut: true, code: null, stdout });
      }, EXIT_BUDGET_MS);

      child.on("exit", (code) => {
        clearTimeout(timer);
        resolvePromise({ timedOut: false, code, stdout });
      });
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("Shutdown when the client goes away", () => {
  it("exits on immediate stdin EOF", async () => {
    const result = await runUntilExit(null);
    assert.equal(
      result.timedOut,
      false,
      `server was still running ${EXIT_BUDGET_MS} ms after stdin closed`,
    );
    assert.equal(result.code, 0);
  });

  it("exits after serving a handshake, once stdin closes", async () => {
    const result = await runUntilExit(INITIALIZE);
    assert.equal(
      result.timedOut,
      false,
      `server was still running ${EXIT_BUDGET_MS} ms after stdin closed`,
    );
    assert.equal(result.code, 0);
    assert.ok(
      result.stdout.includes('"serverInfo"'),
      "server should have answered the handshake before shutting down",
    );
  });
});
