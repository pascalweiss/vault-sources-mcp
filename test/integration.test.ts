import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { v7 as uuidv7 } from "uuid";
import { InputRepository } from "../src/db/repositories/input-repository.js";
import { NoteRepository } from "../src/db/repositories/note-repository.js";
import { LinkRepository } from "../src/db/repositories/link-repository.js";
import { FRONTMATTER_KEY } from "../src/types.js";
import { openTestDb, type TestDb } from "./helpers.js";

describe("Integration: Full agent workflow", () => {
  let ctx: TestDb;
  let inputs: InputRepository;
  let notes: NoteRepository;
  let links: LinkRepository;

  beforeEach(() => {
    ctx = openTestDb();
    inputs = new InputRepository(ctx.dbm);
    notes = new NoteRepository(ctx.dbm);
    links = new LinkRepository(ctx.dbm);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should complete the full provenance lifecycle", () => {
    assert.equal(ctx.dbm.isInitialized(), true);

    // Store a "YouTube transcript about composting"
    const inputId1 = uuidv7();
    const transcript = `Composting is the process of recycling organic matter, such as leaves
and food scraps, into a valuable fertilizer. It enriches soil, helps retain
moisture, and suppresses plant diseases and pests.`;
    const { input: storedInput, duplicate } = inputs.store(inputId1, transcript, {
      source: "youtube",
      title: "Composting 101",
      url: "https://example.com/composting-101",
    });
    assert.equal(duplicate, false);
    assert.equal(storedInput.input_id, inputId1);
    assert.ok(storedInput.content_sha256);

    // Store a second input — an article about soil health
    const inputId2 = uuidv7();
    const article = `Healthy soil is the foundation of a productive garden. Testing pH,
adding amendments, and planting cover crops are essential practices.`;
    inputs.store(inputId2, article, { source: "article", title: "Soil Health Basics" });

    // Deduplication — storing the same transcript again
    const { input: dupInput, duplicate: isDup } = inputs.store(uuidv7(), transcript);
    assert.equal(isDup, true);
    assert.equal(dupInput.input_id, inputId1);

    // Generate + register notes
    const noteId1 = uuidv7();
    const noteId2 = uuidv7();
    assert.equal(FRONTMATTER_KEY, "vault_sources_mcp_id");

    assert.equal(notes.register(noteId1, { title: "Composting Basics" }).note_id, noteId1);
    assert.equal(notes.register(noteId2, { title: "Soil Health" }).note_id, noteId2);

    // Provenance links
    assert.equal(links.add(inputId1, noteId1).created, true);
    links.add(inputId1, noteId2);
    links.add(inputId2, noteId2);

    assert.equal(links.getSourcesForNote(noteId1).length, 1);
    assert.equal(links.getSourcesForNote(noteId2).length, 2);
    assert.equal(links.getNotesForInput(inputId1).length, 2);

    // Redact the transcript
    const redacted = inputs.redact(inputId1);
    assert.equal(redacted.state, "redacted");
    assert.equal(redacted.content, null);

    const sourcesAfterRedact = links.getSourcesForNote(noteId1);
    assert.equal(sourcesAfterRedact.length, 1);
    assert.equal(sourcesAfterRedact[0].state, "redacted");
    assert.equal(sourcesAfterRedact[0].content, null);

    assert.equal(links.findOrphanedInputs().length, 0);

    // Remove links → transcript becomes orphaned
    assert.equal(links.remove(inputId1, noteId1), true);
    assert.equal(links.findOrphanedInputs().length, 0);
    links.remove(inputId1, noteId2);
    const orphanedAfterFull = links.findOrphanedInputs();
    assert.equal(orphanedAfterFull.length, 1);
    assert.equal(orphanedAfterFull[0].input_id, inputId1);

    const unlinked = notes.findUnlinked();
    assert.equal(unlinked.length, 1);
    assert.equal(unlinked[0].note_id, noteId1);

    // Mark composting note deleted
    notes.markDeleted(noteId1);
    const deletedNote = notes.getById(noteId1);
    assert.equal(JSON.parse(deletedNote.meta_json!).deleted, true);

    // The git-synced log recorded every mutation.
    const eventTypes = ctx.dbm.events.readAll().map((e) => e.type);
    assert.ok(eventTypes.includes("INPUT_STORED"));
    assert.ok(eventTypes.includes("INPUT_REDACTED"));
    assert.ok(eventTypes.includes("NOTE_REGISTERED"));
    assert.ok(eventTypes.includes("LINK_ADDED"));
    assert.ok(eventTypes.includes("LINK_REMOVED"));
    assert.ok(eventTypes.includes("NOTE_DELETED"));

    // 2 INPUT_STORED + 1 INPUT_REDACTED + 2 NOTE_REGISTERED + 3 LINK_ADDED + 2 LINK_REMOVED + 1 NOTE_DELETED
    assert.ok(ctx.dbm.events.readAll().length >= 11);
  });

  it("should handle concurrent note re-registration", () => {
    const noteId = uuidv7();
    const first = notes.register(noteId);
    notes.register(noteId);
    const third = notes.register(noteId);

    assert.equal(third.note_id, noteId);
    assert.ok(third.last_seen_at >= first.last_seen_at);
  });

  it("should require both entities to exist before linking", () => {
    const inputId = uuidv7();
    const noteId = uuidv7();

    assert.throws(() => links.add(inputId, noteId));

    inputs.store(inputId, "Test content");
    assert.throws(() => links.add(inputId, noteId));

    notes.register(noteId);
    assert.equal(links.add(inputId, noteId).created, true);
  });

  it("should find stale notes correctly", () => {
    const noteId = uuidv7();
    notes.register(noteId);

    const future = new Date(Date.now() + 86400000).toISOString();
    assert.equal(notes.findStale(future).length, 1);

    notes.register(noteId);
    const past = new Date(Date.now() - 86400000).toISOString();
    assert.equal(notes.findStale(past).length, 0);
  });
});
