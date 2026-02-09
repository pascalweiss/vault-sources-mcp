import type { Database as DatabaseType } from "better-sqlite3";
import type { EventType, VaultEvent } from "../../types.js";

export class EventRepository {
  constructor(private db: DatabaseType) {}

  append(eventType: EventType, payload: Record<string, unknown>): VaultEvent {
    const now = new Date().toISOString();
    const payloadStr = JSON.stringify(payload);

    const result = this.db
      .prepare(`INSERT INTO events (event_type, timestamp, payload) VALUES (?, ?, ?)`)
      .run(eventType, now, payloadStr);

    return {
      event_id: Number(result.lastInsertRowid),
      event_type: eventType,
      timestamp: now,
      payload: payloadStr,
    };
  }

  query(opts: {
    event_type?: EventType;
    since?: string;
    limit?: number;
    offset?: number;
  } = {}): VaultEvent[] {
    const conditions: string[] = [];
    const params: unknown[] = [];

    if (opts.event_type) {
      conditions.push("event_type = ?");
      params.push(opts.event_type);
    }
    if (opts.since) {
      conditions.push("timestamp >= ?");
      params.push(opts.since);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = opts.limit ?? 100;
    const offset = opts.offset ?? 0;

    return this.db
      .prepare(`SELECT * FROM events ${where} ORDER BY event_id ASC LIMIT ? OFFSET ?`)
      .all(...params, limit, offset) as VaultEvent[];
  }
}
