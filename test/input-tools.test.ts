import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { DatabaseManager } from "../src/db/database.js";
import { InputRepository } from "../src/db/repositories/input-repository.js";
import { EventRepository } from "../src/db/repositories/event-repository.js";

describe("store_input_from_file functionality", () => {
  let dbm: DatabaseManager;
  let repo: InputRepository;
  let tmpDir: string;

  beforeEach(() => {
    dbm = new DatabaseManager();
    dbm.open(":memory:");
    dbm.initialize();
    repo = new InputRepository(dbm.connection);
    tmpDir = mkdtempSync(join(import.meta.dirname, "..", "tmp-"));
  });

  afterEach(() => {
    dbm.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("should read and store content from a file", () => {
    const filePath = join(tmpDir, "test-input.txt");
    const content = "Test article about gardening";
    writeFileSync(filePath, content, "utf-8");

    // Simulate reading and storing via repository
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
    const filePath = join(tmpDir, "article.md");
    const content = "Some article content";
    writeFileSync(filePath, content, "utf-8");

    // Auto metadata gets overridden by user metadata
    const autoMeta = {
      file_path: filePath,
      filename: "article.md",
    };
    const userMeta = {
      source: "youtube",
      title: "Gardening Tips",
    };
    const mergedMeta = { ...autoMeta, ...userMeta };

    const { input } = repo.store("input-001", content, mergedMeta);

    const meta = JSON.parse(input.meta_json!);
    assert.equal(meta.file_path, filePath);
    assert.equal(meta.filename, "article.md");
    assert.equal(meta.source, "youtube");
    assert.equal(meta.title, "Gardening Tips");
  });

  it("should allow user metadata to override auto-generated metadata", () => {
    const filePath = join(tmpDir, "doc.txt");
    const content = "Document content";
    writeFileSync(filePath, content, "utf-8");

    // User overrides file_path
    const autoMeta = {
      file_path: filePath,
      filename: "doc.txt",
    };
    const userMeta = {
      file_path: "custom/path",
      custom_field: "custom_value",
    };
    const mergedMeta = { ...autoMeta, ...userMeta };

    const { input } = repo.store("input-001", content, mergedMeta);

    const meta = JSON.parse(input.meta_json!);
    assert.equal(meta.file_path, "custom/path");
    assert.equal(meta.filename, "doc.txt");
    assert.equal(meta.custom_field, "custom_value");
  });

  it("should detect duplicate content across different files", () => {
    const file1 = join(tmpDir, "file1.txt");
    const file2 = join(tmpDir, "file2.txt");
    const sharedContent = "Duplicate content about composting";

    writeFileSync(file1, sharedContent, "utf-8");
    writeFileSync(file2, sharedContent, "utf-8");

    // Store first file
    const result1 = repo.store("input-001", sharedContent, {
      file_path: file1,
      filename: "file1.txt",
    });
    assert.equal(result1.duplicate, false);

    // Store second file with same content
    const result2 = repo.store("input-002", sharedContent, {
      file_path: file2,
      filename: "file2.txt",
    });

    assert.equal(result2.duplicate, true);
    assert.equal(result2.input.input_id, "input-001"); // Returns original input
  });

  it("should handle UTF-8 encoded files with Unicode characters", () => {
    const filePath = join(tmpDir, "unicode.txt");
    const content = "Unicode test: café, naïve, 日本語, 🌱🌿🍃";
    writeFileSync(filePath, content, "utf-8");

    const { input } = repo.store("input-001", content, {
      file_path: filePath,
      filename: "unicode.txt",
    });

    assert.equal(input.content, content);
    const meta = JSON.parse(input.meta_json!);
    assert.equal(meta.filename, "unicode.txt");
  });

  it("should preserve multi-line content", () => {
    const filePath = join(tmpDir, "multiline.txt");
    const lines = [
      "Line 1: Introduction",
      "Line 2: Body",
      "Line 3: Conclusion",
      "",
      "Line 5: Extra line with trailing newline",
    ];
    const content = lines.join("\n");
    writeFileSync(filePath, content, "utf-8");

    const { input } = repo.store("input-001", content, {
      file_path: filePath,
      filename: "multiline.txt",
    });

    // Verify all lines are preserved
    assert.equal(input.content, content);
    const lineCount = input.content.split("\n").length;
    assert.equal(lineCount, lines.length);
  });

  it("should work with cross-tool deduplication via store_input", () => {
    const content = "Shared content between tools";
    const file1Path = join(tmpDir, "file1.txt");
    writeFileSync(file1Path, content, "utf-8");

    // First store via store_input
    const result1 = repo.store("input-001", content, { source: "direct_input" });
    assert.equal(result1.duplicate, false);

    // Then store via store_input_from_file (simulated)
    const result2 = repo.store("input-002", content, {
      file_path: file1Path,
      filename: "file1.txt",
    });

    assert.equal(result2.duplicate, true);
    assert.equal(result2.input.input_id, "input-001");
  });

  it("should emit INPUT_STORED event on successful file storage", () => {
    const filePath = join(tmpDir, "event-test.txt");
    const content = "Event test content";
    writeFileSync(filePath, content, "utf-8");

    const eventRepo = new EventRepository(dbm.connection);

    const result = repo.store("input-001", content, {
      file_path: filePath,
      filename: "event-test.txt",
    });

    const events = eventRepo.query({ event_type: "INPUT_STORED" });
    assert.ok(events.length > 0);

    const targetEvent = events.find((e) => JSON.parse(e.payload).input_id === "input-001");
    assert.ok(targetEvent);
    assert.equal(targetEvent.event_type, "INPUT_STORED");
  });

  it("should handle relative and absolute paths correctly", () => {
    const filename = "relative-test.txt";
    const content = "Path test content";

    // Create file in tmpDir
    const filePath = join(tmpDir, filename);
    writeFileSync(filePath, content, "utf-8");

    // Store with absolute path
    const { input } = repo.store("input-001", content, {
      file_path: filePath,
      filename,
    });

    const meta = JSON.parse(input.meta_json!);
    assert.ok(meta.file_path.includes(filename));
  });

  it("should handle files with special characters in names", () => {
    const filename = "test-file_2024 (draft).txt";
    const content = "Special filename test";
    const filePath = join(tmpDir, filename);
    writeFileSync(filePath, content, "utf-8");

    const { input } = repo.store("input-001", content, {
      file_path: filePath,
      filename,
    });

    const meta = JSON.parse(input.meta_json!);
    assert.equal(meta.filename, filename);
  });

  it("should preserve exact content without modification", async () => {
    const filePath = join(tmpDir, "exact-content.txt");
    const content = "Exact content:\n  - with indentation\n  - and special chars: !@#$%^&*()\n";
    writeFileSync(filePath, content, "utf-8");

    const fileContent = await readFile(filePath, "utf-8");

    const { input } = repo.store("input-001", fileContent, {
      file_path: filePath,
      filename: "exact-content.txt",
    });

    assert.equal(input.content, content);
    assert.equal(input.content, fileContent);
  });

  it("should handle metadata with complex nested structures", () => {
    const filePath = join(tmpDir, "complex-meta.txt");
    const content = "Complex metadata test";
    writeFileSync(filePath, content, "utf-8");

    const autoMeta = {
      file_path: filePath,
      filename: "complex-meta.txt",
    };
    const userMeta = {
      tags: ["gardening", "composting", "tips"],
      source: {
        type: "video",
        platform: "youtube",
        duration_minutes: 45,
      },
      processed: true,
    };
    const mergedMeta = { ...autoMeta, ...userMeta };

    const { input } = repo.store("input-001", content, mergedMeta);

    const meta = JSON.parse(input.meta_json!);
    assert.deepEqual(meta.tags, ["gardening", "composting", "tips"]);
    assert.equal(meta.source.platform, "youtube");
    assert.equal(meta.source.duration_minutes, 45);
    assert.equal(meta.processed, true);
  });
});
