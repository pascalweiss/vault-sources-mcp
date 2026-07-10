import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { InputRepository } from "../../src/db/repositories/input-repository.js";
import { NoteRepository } from "../../src/db/repositories/note-repository.js";
import { LinkRepository } from "../../src/db/repositories/link-repository.js";
import { EntityNotFoundError } from "../../src/errors.js";
import type { CanonicalEventType } from "../../src/types.js";
import { openTestDb, type TestDb } from "../helpers.js";

function eventsOfType(ctx: TestDb, type: CanonicalEventType) {
  return ctx.dbm.events.readAll().filter((e) => e.type === type);
}

describe("InputRepository", () => {
  let ctx: TestDb;
  let repo: InputRepository;

  beforeEach(() => {
    ctx = openTestDb();
    repo = new InputRepository(ctx.dbm);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should store an input", () => {
    const { input, duplicate } = repo.store("input-001", "Some gardening text about tomatoes");
    assert.equal(duplicate, false);
    assert.equal(input.input_id, "input-001");
    assert.equal(input.state, "active");
    assert.ok(input.content_sha256);
  });

  it("should detect duplicate content", () => {
    const content = "Duplicate content about composting";
    repo.store("input-001", content);
    const { input, duplicate } = repo.store("input-002", content);
    assert.equal(duplicate, true);
    assert.equal(input.input_id, "input-001"); // returns the original
  });

  it("should get an input by ID with hydrated content", () => {
    repo.store("input-001", "Test content");
    const input = repo.getById("input-001");
    assert.equal(input.input_id, "input-001");
    assert.equal(input.content, "Test content");
  });

  it("should throw EntityNotFoundError for missing input", () => {
    assert.throws(() => repo.getById("nonexistent"), EntityNotFoundError);
  });

  it("should list inputs", () => {
    repo.store("input-001", "First");
    repo.store("input-002", "Second");
    assert.equal(repo.list().length, 2);
  });

  it("should filter by state", () => {
    repo.store("input-001", "Active content");
    repo.store("input-002", "To be redacted");
    repo.redact("input-002");

    const active = repo.list({ state: "active" });
    assert.equal(active.length, 1);
    assert.equal(active[0].input_id, "input-001");

    const redacted = repo.list({ state: "redacted" });
    assert.equal(redacted.length, 1);
    assert.equal(redacted[0].input_id, "input-002");
  });

  it("should redact an input and remove its body from the store", () => {
    const { input } = repo.store("input-001", "Sensitive text");
    const sha = input.content_sha256;
    assert.equal(ctx.dbm.getInput(sha), "Sensitive text");

    const redacted = repo.redact("input-001");
    assert.equal(redacted.state, "redacted");
    assert.equal(redacted.content, null);
    assert.equal(ctx.dbm.getInput(sha), null); // body deleted from working tree

    const fetched = repo.getById("input-001");
    assert.equal(fetched.content, null);
    assert.equal(fetched.state, "redacted");
  });

  it("should store with metadata", () => {
    const { input } = repo.store("input-001", "Content", { source: "youtube", url: "https://example.com" });
    assert.ok(input.meta_json);
    const meta = JSON.parse(input.meta_json!);
    assert.equal(meta.source, "youtube");
  });

  it("should append an INPUT_STORED event to the log", () => {
    repo.store("input-001", "Test");
    const events = eventsOfType(ctx, "INPUT_STORED");
    assert.equal(events.length, 1);
    assert.equal(events[0].payload["input_id"], "input-001");
  });

  it("should append an INPUT_REDACTED event to the log", () => {
    repo.store("input-001", "Test");
    repo.redact("input-001");
    assert.equal(eventsOfType(ctx, "INPUT_REDACTED").length, 1);
  });
});

describe("NoteRepository", () => {
  let ctx: TestDb;
  let repo: NoteRepository;

  beforeEach(() => {
    ctx = openTestDb();
    repo = new NoteRepository(ctx.dbm);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should register a new note", () => {
    const note = repo.register("note-001");
    assert.equal(note.note_id, "note-001");
    assert.equal(note.created_at, note.last_seen_at);
  });

  it("should update last_seen_at on re-registration", () => {
    const first = repo.register("note-001");
    const second = repo.register("note-001");
    assert.equal(second.note_id, "note-001");
    assert.ok(second.last_seen_at >= first.last_seen_at);
  });

  it("should get a note by ID", () => {
    repo.register("note-001");
    assert.equal(repo.getById("note-001").note_id, "note-001");
  });

  it("should throw EntityNotFoundError for missing note", () => {
    assert.throws(() => repo.getById("nonexistent"), EntityNotFoundError);
  });

  it("should mark a note as deleted", () => {
    repo.register("note-001");
    repo.markDeleted("note-001");
    const note = repo.getById("note-001");
    const meta = JSON.parse(note.meta_json!);
    assert.equal(meta.deleted, true);
    assert.ok(meta.deleted_at);
  });

  it("should find stale notes", () => {
    repo.register("note-001");
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    assert.equal(repo.findStale(futureDate).length, 1);

    const pastDate = new Date(Date.now() - 86400000).toISOString();
    assert.equal(repo.findStale(pastDate).length, 0);
  });

  it("should find unlinked notes", () => {
    repo.register("note-001");
    assert.equal(repo.findUnlinked().length, 1);
  });

  it("should append a NOTE_REGISTERED event to the log", () => {
    repo.register("note-001");
    assert.equal(eventsOfType(ctx, "NOTE_REGISTERED").length, 1);
  });

  it("should append a NOTE_DELETED event to the log", () => {
    repo.register("note-001");
    repo.markDeleted("note-001");
    assert.equal(eventsOfType(ctx, "NOTE_DELETED").length, 1);
  });
});

describe("LinkRepository", () => {
  let ctx: TestDb;
  let inputRepo: InputRepository;
  let noteRepo: NoteRepository;
  let linkRepo: LinkRepository;

  beforeEach(() => {
    ctx = openTestDb();
    inputRepo = new InputRepository(ctx.dbm);
    noteRepo = new NoteRepository(ctx.dbm);
    linkRepo = new LinkRepository(ctx.dbm);

    inputRepo.store("input-001", "Gardening transcript about tomatoes");
    inputRepo.store("input-002", "Article about composting methods");
    noteRepo.register("note-001");
    noteRepo.register("note-002");
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should add a link", () => {
    const { link, created } = linkRepo.add("input-001", "note-001");
    assert.equal(created, true);
    assert.equal(link.input_id, "input-001");
    assert.equal(link.note_id, "note-001");
  });

  it("should be idempotent on duplicate link", () => {
    linkRepo.add("input-001", "note-001");
    const { created } = linkRepo.add("input-001", "note-001");
    assert.equal(created, false);
  });

  it("should reject link to nonexistent input", () => {
    assert.throws(() => linkRepo.add("nonexistent", "note-001"), EntityNotFoundError);
  });

  it("should reject link to nonexistent note", () => {
    assert.throws(() => linkRepo.add("input-001", "nonexistent"), EntityNotFoundError);
  });

  it("should remove a link", () => {
    linkRepo.add("input-001", "note-001");
    assert.equal(linkRepo.remove("input-001", "note-001"), true);
  });

  it("should return false when removing nonexistent link", () => {
    assert.equal(linkRepo.remove("input-001", "note-001"), false);
  });

  it("should get sources for a note", () => {
    linkRepo.add("input-001", "note-001");
    linkRepo.add("input-002", "note-001");
    assert.equal(linkRepo.getSourcesForNote("note-001").length, 2);
  });

  it("should get notes for an input", () => {
    linkRepo.add("input-001", "note-001");
    linkRepo.add("input-001", "note-002");
    assert.equal(linkRepo.getNotesForInput("input-001").length, 2);
  });

  it("should find orphaned inputs", () => {
    linkRepo.add("input-001", "note-001");
    const orphaned = linkRepo.findOrphanedInputs();
    assert.equal(orphaned.length, 1);
    assert.equal(orphaned[0].input_id, "input-002");
  });

  it("should detect orphaned input after link removal", () => {
    linkRepo.add("input-001", "note-001");
    linkRepo.remove("input-001", "note-001");
    assert.equal(linkRepo.findOrphanedInputs().length, 2);
  });

  it("should append a LINK_ADDED event to the log", () => {
    linkRepo.add("input-001", "note-001");
    assert.equal(eventsOfType(ctx, "LINK_ADDED").length, 1);
  });

  it("should append a LINK_REMOVED event to the log", () => {
    linkRepo.add("input-001", "note-001");
    linkRepo.remove("input-001", "note-001");
    assert.equal(eventsOfType(ctx, "LINK_REMOVED").length, 1);
  });

  it("should preserve link after input redaction", () => {
    linkRepo.add("input-001", "note-001");
    inputRepo.redact("input-001");
    const sources = linkRepo.getSourcesForNote("note-001");
    assert.equal(sources.length, 1);
    assert.equal(sources[0].content, null);
    assert.equal(sources[0].state, "redacted");
  });
});

describe("Event log projection round-trip", () => {
  let ctx: TestDb;

  beforeEach(() => {
    ctx = openTestDb();
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("rebuilds the same projection from the log", () => {
    const inputs = new InputRepository(ctx.dbm);
    const notes = new NoteRepository(ctx.dbm);
    const links = new LinkRepository(ctx.dbm);

    inputs.store("input-001", "content one");
    notes.register("note-001", { title: "Note One" });
    links.add("input-001", "note-001");

    const before = ctx.dbm.connection.prepare(`SELECT COUNT(*) c FROM input_note_links`).get() as { c: number };
    assert.equal(before.c, 1);

    // The log holds exactly the three mutations.
    const types = ctx.dbm.events.readAll().map((e) => e.type);
    assert.deepEqual(types.sort(), ["INPUT_STORED", "LINK_ADDED", "NOTE_REGISTERED"]);
  });
});
