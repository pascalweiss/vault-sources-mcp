import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { v7 as uuidv7 } from "uuid";
import { DatabaseManager } from "../src/db/database.js";
import { InputRepository } from "../src/db/repositories/input-repository.js";
import { NoteRepository } from "../src/db/repositories/note-repository.js";
import { LinkRepository } from "../src/db/repositories/link-repository.js";
import { EventRepository } from "../src/db/repositories/event-repository.js";
import { FRONTMATTER_KEY } from "../src/types.js";

describe("Integration: Full agent workflow", () => {
  let dbm: DatabaseManager;
  let inputs: InputRepository;
  let notes: NoteRepository;
  let links: LinkRepository;
  let events: EventRepository;

  beforeEach(() => {
    dbm = new DatabaseManager();
    dbm.open(":memory:");
  });

  afterEach(() => {
    dbm.close();
  });

  it("should complete the full provenance lifecycle", () => {
    // Step 1: Initialize database
    assert.equal(dbm.isInitialized(), false);
    dbm.initialize();
    assert.equal(dbm.isInitialized(), true);

    inputs = new InputRepository(dbm.connection);
    notes = new NoteRepository(dbm.connection);
    links = new LinkRepository(dbm.connection);
    events = new EventRepository(dbm.connection);

    // Step 2: Store a "YouTube transcript about composting"
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

    // Step 3: Store a second input — an article about soil health
    const inputId2 = uuidv7();
    const article = `Healthy soil is the foundation of a productive garden. Testing pH,
adding amendments, and planting cover crops are essential practices.`;
    inputs.store(inputId2, article, { source: "article", title: "Soil Health Basics" });

    // Step 4: Verify deduplication — storing the same transcript again
    const { input: dupInput, duplicate: isDup } = inputs.store(uuidv7(), transcript);
    assert.equal(isDup, true);
    assert.equal(dupInput.input_id, inputId1); // Returns original

    // Step 5: Generate note IDs (simulating what generate_note_id tool does)
    const noteId1 = uuidv7();
    const noteId2 = uuidv7();
    assert.equal(FRONTMATTER_KEY, "vault_sources_mcp_id");

    // Step 6: Register notes (agent has injected IDs into frontmatter)
    const note1 = notes.register(noteId1, { title: "Composting Basics" });
    assert.equal(note1.note_id, noteId1);

    const note2 = notes.register(noteId2, { title: "Soil Health" });
    assert.equal(note2.note_id, noteId2);

    // Step 7: Create provenance links
    const { created: link1Created } = links.add(inputId1, noteId1);
    assert.equal(link1Created, true);

    // Composting transcript also influenced the soil health note
    links.add(inputId1, noteId2);

    // Soil article linked to soil health note
    links.add(inputId2, noteId2);

    // Step 8: Query sources for Composting Basics note
    const compostSources = links.getSourcesForNote(noteId1);
    assert.equal(compostSources.length, 1);
    assert.equal(compostSources[0].input_id, inputId1);

    // Step 9: Query sources for Soil Health note (should have 2)
    const soilSources = links.getSourcesForNote(noteId2);
    assert.equal(soilSources.length, 2);

    // Step 10: Query notes for the composting transcript (should be linked to 2 notes)
    const transcriptNotes = links.getNotesForInput(inputId1);
    assert.equal(transcriptNotes.length, 2);

    // Step 11: Redact the transcript
    const redacted = inputs.redact(inputId1);
    assert.equal(redacted.state, "redacted");
    assert.equal(redacted.content, null);

    // Step 12: Verify links still exist after redaction
    const sourcesAfterRedact = links.getSourcesForNote(noteId1);
    assert.equal(sourcesAfterRedact.length, 1);
    assert.equal(sourcesAfterRedact[0].state, "redacted");
    assert.equal(sourcesAfterRedact[0].content, null);

    // Step 13: Check orphaned inputs — none should be orphaned yet
    const orphanedBefore = links.findOrphanedInputs();
    assert.equal(orphanedBefore.length, 0);

    // Step 14: Remove link between transcript and composting note
    const removed = links.remove(inputId1, noteId1);
    assert.equal(removed, true);

    // Step 15: Check — transcript is still linked to soil note, so not orphaned
    const orphanedAfterPartial = links.findOrphanedInputs();
    assert.equal(orphanedAfterPartial.length, 0);

    // Step 16: Remove remaining link for transcript
    links.remove(inputId1, noteId2);
    const orphanedAfterFull = links.findOrphanedInputs();
    assert.equal(orphanedAfterFull.length, 1);
    assert.equal(orphanedAfterFull[0].input_id, inputId1);

    // Step 17: Check unlinked notes — composting note now has no sources
    const unlinked = notes.findUnlinked();
    assert.equal(unlinked.length, 1);
    assert.equal(unlinked[0].note_id, noteId1);

    // Step 18: Mark composting note as deleted
    notes.markDeleted(noteId1);
    const deletedNote = notes.getById(noteId1);
    const meta = JSON.parse(deletedNote.meta_json!);
    assert.equal(meta.deleted, true);

    // Step 19: Verify event log has recorded everything
    const allEvents = events.query({ limit: 500 });
    const eventTypes = allEvents.map((e) => e.event_type);

    assert.ok(eventTypes.includes("DB_INITIALIZED"));
    assert.ok(eventTypes.includes("INPUT_STORED"));
    assert.ok(eventTypes.includes("INPUT_REDACTED"));
    assert.ok(eventTypes.includes("NOTE_SEEN"));
    assert.ok(eventTypes.includes("LINK_ADDED"));
    assert.ok(eventTypes.includes("LINK_REMOVED"));
    assert.ok(eventTypes.includes("NOTE_MARKED_DELETED"));

    // At least: 1 DB_INIT + 2 INPUT_STORED + 1 INPUT_REDACTED + 2 NOTE_SEEN + 3 LINK_ADDED + 2 LINK_REMOVED + 1 NOTE_MARKED_DELETED
    assert.ok(allEvents.length >= 12);
  });

  it("should handle concurrent note re-registration", () => {
    dbm.initialize();
    notes = new NoteRepository(dbm.connection);

    const noteId = uuidv7();
    const first = notes.register(noteId);
    const second = notes.register(noteId);
    const third = notes.register(noteId);

    assert.equal(first.note_id, noteId);
    assert.equal(second.note_id, noteId);
    assert.equal(third.note_id, noteId);
    assert.ok(third.last_seen_at >= first.last_seen_at);
  });

  it("should enforce foreign key constraints on links", () => {
    dbm.initialize();
    links = new LinkRepository(dbm.connection);
    inputs = new InputRepository(dbm.connection);
    notes = new NoteRepository(dbm.connection);

    const inputId = uuidv7();
    const noteId = uuidv7();

    // Cannot link nonexistent entities
    assert.throws(() => links.add(inputId, noteId));

    // Create only the input — still can't link
    inputs.store(inputId, "Test content");
    assert.throws(() => links.add(inputId, noteId));

    // Create the note — now linking works
    notes.register(noteId);
    const { created } = links.add(inputId, noteId);
    assert.equal(created, true);
  });

  it("should find stale notes correctly", () => {
    dbm.initialize();
    notes = new NoteRepository(dbm.connection);

    const noteId = uuidv7();
    notes.register(noteId);

    // Threshold in the future → note is stale
    const future = new Date(Date.now() + 86400000).toISOString();
    const stale = notes.findStale(future);
    assert.equal(stale.length, 1);

    // Re-register to update last_seen_at
    notes.register(noteId);

    // Threshold in the past → not stale
    const past = new Date(Date.now() - 86400000).toISOString();
    const notStale = notes.findStale(past);
    assert.equal(notStale.length, 0);
  });
});
