import type { Input, InputId } from "../../types.js";
import { EntityNotFoundError } from "../../errors.js";
import { sha256 } from "../../log/hash.js";
import type { DatabaseManager } from "../database.js";

export class InputRepository {
  constructor(private mgr: DatabaseManager) {}

  private get db() {
    return this.mgr.connection;
  }

  store(inputId: InputId, content: string, meta?: Record<string, unknown>): { input: Input; duplicate: boolean } {
    const sha = sha256(content);
    const existing = this.findBySha256(sha);

    if (existing) {
      return { input: existing, duplicate: true };
    }

    // Content-addressed body first (source of truth), then the event that references it.
    this.mgr.putInput(content);
    this.mgr.commit("INPUT_STORED", { input_id: inputId, content_sha256: sha, meta: meta ?? null });

    return { input: this.getById(inputId), duplicate: false };
  }

  getById(inputId: InputId): Input {
    const row = this.db.prepare(`SELECT * FROM inputs WHERE input_id = ?`).get(inputId) as Input | undefined;
    if (!row) throw new EntityNotFoundError("Input", inputId);
    return row;
  }

  findBySha256(sha256Hex: string): Input | null {
    const row = this.db
      .prepare(`SELECT * FROM inputs WHERE content_sha256 = ? AND state = 'active'`)
      .get(sha256Hex) as Input | undefined;
    return row ?? null;
  }

  list(opts: { limit?: number; offset?: number; state?: "active" | "redacted" } = {}): Input[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.state) {
      conditions.push("state = ?");
      params.push(opts.state);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    return this.db
      .prepare(`SELECT * FROM inputs ${where} ORDER BY created_at ASC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as Input[];
  }

  redact(inputId: InputId): Input {
    const input = this.getById(inputId);

    this.mgr.commit("INPUT_REDACTED", { input_id: inputId });
    // Remove the working-tree body. Git history still holds it (documented caveat).
    this.mgr.deleteInput(input.content_sha256);

    return { ...input, content: null, state: "redacted" };
  }
}

export { sha256 as computeSha256 };
