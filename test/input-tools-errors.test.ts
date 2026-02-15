import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FileReadError, VaultSourcesError } from "../src/errors.js";

describe("FileReadError", () => {
  it("should create error with correct name", () => {
    const error = new FileReadError("/path/to/file.txt", "File not found");
    assert.equal(error.name, "FileReadError");
  });

  it("should create error with correct code", () => {
    const error = new FileReadError("/path/to/file.txt", "File not found");
    assert.equal(error.code, "FILE_READ_ERROR");
  });

  it("should format message correctly", () => {
    const error = new FileReadError("/path/to/file.txt", "File not found");
    assert.equal(error.message, "Failed to read file '/path/to/file.txt': File not found");
  });

  it("should extend VaultSourcesError", () => {
    const error = new FileReadError("/path/to/file.txt", "Permission denied");
    assert.ok(error instanceof VaultSourcesError);
    assert.ok(error instanceof Error);
  });

  it("should handle different error causes", () => {
    const causes = [
      "File not found",
      "Permission denied",
      "Path is a directory, not a file",
      "File is empty",
      "Unknown I/O error",
    ];

    causes.forEach((cause) => {
      const error = new FileReadError("/test.txt", cause);
      assert.ok(error.message.includes(cause));
    });
  });

  it("should handle special characters in file path", () => {
    const specialPath = "/path/with spaces/and-dashes/file_with_underscores.txt";
    const error = new FileReadError(specialPath, "File not found");
    assert.ok(error.message.includes(specialPath));
  });

  it("should be throwable and catchable", () => {
    assert.throws(
      () => {
        throw new FileReadError("/path/to/file.txt", "File not found");
      },
      FileReadError,
    );
  });

  it("should be catchable as VaultSourcesError", () => {
    assert.throws(
      () => {
        throw new FileReadError("/path/to/file.txt", "File not found");
      },
      VaultSourcesError,
    );
  });
});
