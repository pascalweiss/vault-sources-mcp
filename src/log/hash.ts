import { createHash } from "node:crypto";

/** SHA-256 hex digest of a UTF-8 string. Used to content-address input bodies. */
export function sha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}
