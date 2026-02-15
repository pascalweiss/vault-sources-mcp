export class VaultSourcesError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "VaultSourcesError";
  }
}

export class DatabaseNotInitializedError extends VaultSourcesError {
  constructor() {
    super("Database is not initialized. Call db_init first.", "DB_NOT_INITIALIZED");
    this.name = "DatabaseNotInitializedError";
  }
}

export class DatabaseAlreadyInitializedError extends VaultSourcesError {
  constructor() {
    super("Database is already initialized.", "DB_ALREADY_INITIALIZED");
    this.name = "DatabaseAlreadyInitializedError";
  }
}

export class EntityNotFoundError extends VaultSourcesError {
  constructor(entity: string, id: string) {
    super(`${entity} not found: ${id}`, "ENTITY_NOT_FOUND");
    this.name = "EntityNotFoundError";
  }
}

export class InvalidParameterError extends VaultSourcesError {
  constructor(message: string) {
    super(message, "INVALID_PARAMETER");
    this.name = "InvalidParameterError";
  }
}

export class FileReadError extends VaultSourcesError {
  constructor(filePath: string, cause: string) {
    super(`Failed to read file '${filePath}': ${cause}`, "FILE_READ_ERROR");
    this.name = "FileReadError";
  }
}
