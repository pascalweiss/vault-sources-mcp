import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { DatabaseManager } from "../../src/db/database.js";
import { InputRepository } from "../../src/db/repositories/input-repository.js";
import { NoteRepository } from "../../src/db/repositories/note-repository.js";
import { LinkRepository } from "../../src/db/repositories/link-repository.js";
import { EventRepository } from "../../src/db/repositories/event-repository.js";
import { EntityNotFoundError } from "../../src/errors.js";

describe("InputRepository", () => {
  let dbm: DatabaseManager;
  let repo: InputRepository;

  beforeEach(() => {
    dbm = new DatabaseManager();
    dbm.open(":memory:");
    dbm.initialize();
    repo = new InputRepository(dbm.connection);
  });

  afterEach(() => {
    dbm.close();
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

  it("should get an input by ID", () => {
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
    const all = repo.list();
    assert.equal(all.length, 2);
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

  it("should redact an input", () => {
    repo.store("input-001", "Sensitive text");
    const redacted = repo.redact("input-001");
    assert.equal(redacted.state, "redacted");
    assert.equal(redacted.content, null);

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

  it("should emit INPUT_STORED event", () => {
    repo.store("input-001", "Test");
    const events = new EventRepository(dbm.connection).query({ event_type: "INPUT_STORED" });
    assert.equal(events.length, 1);
    const payload = JSON.parse(events[0].payload);
    assert.equal(payload.input_id, "input-001");
  });

  it("should emit INPUT_REDACTED event", () => {
    repo.store("input-001", "Test");
    repo.redact("input-001");
    const events = new EventRepository(dbm.connection).query({ event_type: "INPUT_REDACTED" });
    assert.equal(events.length, 1);
  });
});

describe("NoteRepository", () => {
  let dbm: DatabaseManager;
  let repo: NoteRepository;

  beforeEach(() => {
    dbm = new DatabaseManager();
    dbm.open(":memory:");
    dbm.initialize();
    repo = new NoteRepository(dbm.connection);
  });

  afterEach(() => {
    dbm.close();
  });

  it("should register a new note", () => {
    const note = repo.register("note-001");
    assert.equal(note.note_id, "note-001");
    assert.equal(note.created_at, note.last_seen_at);
  });

  it("should update last_seen_at on re-registration", () => {
    const first = repo.register("note-001");
    // Small delay to ensure different timestamp
    const second = repo.register("note-001");
    assert.equal(second.note_id, "note-001");
    assert.ok(second.last_seen_at >= first.last_seen_at);
  });

  it("should get a note by ID", () => {
    repo.register("note-001");
    const note = repo.getById("note-001");
    assert.equal(note.note_id, "note-001");
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
    // All notes are "now" so nothing should be stale if threshold is in the future
    const futureDate = new Date(Date.now() + 86400000).toISOString();
    const stale = repo.findStale(futureDate);
    assert.equal(stale.length, 1);

    const pastDate = new Date(Date.now() - 86400000).toISOString();
    const notStale = repo.findStale(pastDate);
    assert.equal(notStale.length, 0);
  });

  it("should find unlinked notes", () => {
    repo.register("note-001");
    const unlinked = repo.findUnlinked();
    assert.equal(unlinked.length, 1);
  });

  it("should emit NOTE_SEEN events", () => {
    repo.register("note-001");
    const events = new EventRepository(dbm.connection).query({ event_type: "NOTE_SEEN" });
    assert.equal(events.length, 1);
  });
});

describe("LinkRepository", () => {
  let dbm: DatabaseManager;
  let inputRepo: InputRepository;
  let noteRepo: NoteRepository;
  let linkRepo: LinkRepository;

  beforeEach(() => {
    dbm = new DatabaseManager();
    dbm.open(":memory:");
    dbm.initialize();
    inputRepo = new InputRepository(dbm.connection);
    noteRepo = new NoteRepository(dbm.connection);
    linkRepo = new LinkRepository(dbm.connection);

    inputRepo.store("input-001", "Gardening transcript about tomatoes");
    inputRepo.store("input-002", "Article about composting methods");
    noteRepo.register("note-001");
    noteRepo.register("note-002");
  });

  afterEach(() => {
    dbm.close();
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
    const removed = linkRepo.remove("input-001", "note-001");
    assert.equal(removed, true);
  });

  it("should return false when removing nonexistent link", () => {
    const removed = linkRepo.remove("input-001", "note-001");
    assert.equal(removed, false);
  });

  it("should get sources for a note", () => {
    linkRepo.add("input-001", "note-001");
    linkRepo.add("input-002", "note-001");
    const sources = linkRepo.getSourcesForNote("note-001");
    assert.equal(sources.length, 2);
  });

  it("should get notes for an input", () => {
    linkRepo.add("input-001", "note-001");
    linkRepo.add("input-001", "note-002");
    const notes = linkRepo.getNotesForInput("input-001");
    assert.equal(notes.length, 2);
  });

  it("should find orphaned inputs", () => {
    // input-001 linked, input-002 not
    linkRepo.add("input-001", "note-001");
    const orphaned = linkRepo.findOrphanedInputs();
    assert.equal(orphaned.length, 1);
    assert.equal(orphaned[0].input_id, "input-002");
  });

  it("should detect orphaned input after link removal", () => {
    linkRepo.add("input-001", "note-001");
    linkRepo.remove("input-001", "note-001");
    const orphaned = linkRepo.findOrphanedInputs();
    assert.equal(orphaned.length, 2); // both are now orphaned
  });

  it("should emit LINK_ADDED event", () => {
    linkRepo.add("input-001", "note-001");
    const events = new EventRepository(dbm.connection).query({ event_type: "LINK_ADDED" });
    assert.equal(events.length, 1);
  });

  it("should emit LINK_REMOVED event", () => {
    linkRepo.add("input-001", "note-001");
    linkRepo.remove("input-001", "note-001");
    const events = new EventRepository(dbm.connection).query({ event_type: "LINK_REMOVED" });
    assert.equal(events.length, 1);
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

describe("EventRepository", () => {
  let dbm: DatabaseManager;
  let repo: EventRepository;

  beforeEach(() => {
    dbm = new DatabaseManager();
    dbm.open(":memory:");
    dbm.initialize();
    repo = new EventRepository(dbm.connection);
  });

  afterEach(() => {
    dbm.close();
  });

  it("should append and retrieve events", () => {
    repo.append("INPUT_STORED", { input_id: "test-001" });
    const events = repo.query({ event_type: "INPUT_STORED" });
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, "INPUT_STORED");
  });

  it("should filter by event type", () => {
    repo.append("INPUT_STORED", { input_id: "test-001" });
    repo.append("NOTE_SEEN", { note_id: "note-001" });

    const inputEvents = repo.query({ event_type: "INPUT_STORED" });
    assert.equal(inputEvents.length, 1);

    const noteEvents = repo.query({ event_type: "NOTE_SEEN" });
    assert.equal(noteEvents.length, 1);
  });

  it("should paginate results", () => {
    for (let i = 0; i < 5; i++) {
      repo.append("INPUT_STORED", { input_id: `test-${i}` });
    }
    const page1 = repo.query({ limit: 2, offset: 0 });
    const page2 = repo.query({ limit: 2, offset: 2 });
    // +1 for DB_INITIALIZED event
    assert.equal(page1.length, 2);
    assert.equal(page2.length, 2);
  });

  it("should filter by since timestamp", () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString();
    repo.append("INPUT_STORED", { input_id: "test-001" });
    const events = repo.query({ since: pastDate });
    // DB_INITIALIZED + INPUT_STORED
    assert.ok(events.length >= 2);
  });
});
