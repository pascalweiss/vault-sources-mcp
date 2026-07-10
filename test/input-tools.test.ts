import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { InputRepository } from "../src/db/repositories/input-repository.js";
import { openTestDb, type TestDb } from "./helpers.js";

describe("store_input_from_file functionality", () => {
  let ctx: TestDb;
  let repo: InputRepository;

  beforeEach(() => {
    ctx = openTestDb();
    repo = new InputRepository(ctx.dbm);
  });

  afterEach(() => {
    ctx.cleanup();
  });

  it("should read and store content from a file", () => {
    const filePath = join(ctx.dir, "test-input.txt");
    const content = "Test article about gardening";
    writeFileSync(filePath, content, "utf-8");

    const { input, duplicate } = repo.store("input-001", content, {
      file_path: filePath,
      filename: "test-input.txt",
    });

    assert.equal(duplicate, false);
    assert.equal(input.input_id, "input-001");
    assert.equal(input.content, content);

    const meta = JSON.parse(input.meta_json!);
    assert.equal(meta.file_path, filePath);
    assert.equal(meta.filename, "test-input.txt");
  });

  it("should merge user metadata with auto-generated file metadata", () => {
    const filePath = join(ctx.dir, "article.md");
    const content = "Some article content";
    writeFileSync(filePath, content, "utf-8");

    const mergedMeta = { file_path: filePath, filename: "article.md", source: "youtube", title: "Gardening Tips" };
    const { input } = repo.store("input-001", content, mergedMeta);

    const meta = JSON.parse(input.meta_json!);
    assert.equal(meta.file_path, filePath);
    assert.equal(meta.filename, "article.md");
    assert.equal(meta.source, "youtube");
    assert.equal(meta.title, "Gardening Tips");
  });

  it("should allow user metadata to override auto-generated metadata", () => {
    const filePath = join(ctx.dir, "doc.txt");
    const content = "Document content";
    writeFileSync(filePath, content, "utf-8");

    const mergedMeta = { file_path: "custom/path", filename: "doc.txt", custom_field: "custom_value" };
    const { input } = repo.store("input-001", content, mergedMeta);

    const meta = JSON.parse(input.meta_json!);
    assert.equal(meta.file_path, "custom/path");
    assert.equal(meta.filename, "doc.txt");
    assert.equal(meta.custom_field, "custom_value");
  });

  it("should detect duplicate content across different files", () => {
    const sharedContent = "Duplicate content about composting";
    const result1 = repo.store("input-001", sharedContent, { filename: "file1.txt" });
    assert.equal(result1.duplicate, false);

    const result2 = repo.store("input-002", sharedContent, { filename: "file2.txt" });
    assert.equal(result2.duplicate, true);
    assert.equal(result2.input.input_id, "input-001");
  });

  it("should handle UTF-8 encoded files with Unicode characters", () => {
    const content = "Unicode test: café, naïve, 日本語, 🌱🌿🍃";
    const { input } = repo.store("input-001", content, { filename: "unicode.txt" });
    assert.equal(input.content, content);
  });

  it("should preserve multi-line content", () => {
    const lines = ["Line 1", "Line 2", "Line 3", "", "Line 5"];
    const content = lines.join("\n");
    const { input } = repo.store("input-001", content, { filename: "multiline.txt" });
    assert.equal(input.content, content);
    assert.equal(input.content!.split("\n").length, lines.length);
  });

  it("should deduplicate across store_input and store_input_from_file", () => {
    const content = "Shared content between tools";
    assert.equal(repo.store("input-001", content, { source: "direct_input" }).duplicate, false);
    const result2 = repo.store("input-002", content, { filename: "file1.txt" });
    assert.equal(result2.duplicate, true);
    assert.equal(result2.input.input_id, "input-001");
  });

  it("should append an INPUT_STORED event on successful storage", () => {
    repo.store("input-001", "Event test content", { filename: "event-test.txt" });
    const events = ctx.dbm.events.readAll().filter((e) => e.type === "INPUT_STORED");
    assert.ok(events.length > 0);
    const target = events.find((e) => e.payload["input_id"] === "input-001");
    assert.ok(target);
  });

  it("should preserve exact content without modification", async () => {
    const filePath = join(ctx.dir, "exact-content.txt");
    const content = "Exact content:\n  - with indentation\n  - and special chars: !@#$%^&*()\n";
    writeFileSync(filePath, content, "utf-8");

    const fileContent = await readFile(filePath, "utf-8");
    const { input } = repo.store("input-001", fileContent, { filename: "exact-content.txt" });
    assert.equal(input.content, content);
    assert.equal(input.content, fileContent);
  });

  it("should handle metadata with complex nested structures", () => {
    const userMeta = {
      filename: "complex-meta.txt",
      tags: ["gardening", "composting", "tips"],
      source: { type: "video", platform: "youtube", duration_minutes: 45 },
      processed: true,
    };
    const { input } = repo.store("input-001", "Complex metadata test", userMeta);

    const meta = JSON.parse(input.meta_json!);
    assert.deepEqual(meta.tags, ["gardening", "composting", "tips"]);
    assert.equal(meta.source.platform, "youtube");
    assert.equal(meta.processed, true);
  });
});
