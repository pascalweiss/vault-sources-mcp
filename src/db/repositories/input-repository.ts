import { createHash } from "node:crypto";
import type { Database as DatabaseType } from "better-sqlite3";
import type { Input, InputId } from "../../types.js";
import { EntityNotFoundError } from "../../errors.js";
import { EventRepository } from "./event-repository.js";

export class InputRepository {
  private events: EventRepository;

  constructor(private db: DatabaseType) {
    this.events = new EventRepository(db);
  }

  store(inputId: InputId, content: string, meta?: Record<string, unknown>): { input: Input; duplicate: boolean } {
    const sha256 = computeSha256(content);
    const existing = this.findBySha256(sha256);

    if (existing) {
      return { input: existing, duplicate: true };
    }

    const now = new Date().toISOString();
    const metaJson = meta ? JSON.stringify(meta) : null;

    this.db
      .prepare(
        `INSERT INTO inputs (input_id, content, content_sha256, state, created_at, meta_json)
         VALUES (?, ?, ?, 'active', ?, ?)`,
      )
      .run(inputId, content, sha256, now, metaJson);

    const input: Input = {
      input_id: inputId,
      content,
      content_sha256: sha256,
      state: "active",
      created_at: now,
      meta_json: metaJson,
    };

    this.events.append("INPUT_STORED", { input_id: inputId, content_sha256: sha256 });

    return { input, duplicate: false };
  }

  getById(inputId: InputId): Input {
    const row = this.db.prepare(`SELECT * FROM inputs WHERE input_id = ?`).get(inputId) as Input | undefined;
    if (!row) throw new EntityNotFoundError("Input", inputId);
    return row;
  }

  findBySha256(sha256: string): Input | null {
    const row = this.db
      .prepare(`SELECT * FROM inputs WHERE content_sha256 = ? AND state = 'active'`)
      .get(sha256) as Input | undefined;
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

    this.db
      .prepare(`UPDATE inputs SET content = NULL, state = 'redacted' WHERE input_id = ?`)
      .run(inputId);

    this.events.append("INPUT_REDACTED", { input_id: inputId });

    return { ...input, content: null, state: "redacted" };
  }
}

function computeSha256(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

export { computeSha256 };
