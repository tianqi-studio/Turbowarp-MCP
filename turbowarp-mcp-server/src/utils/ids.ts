import { randomBytes } from "node:crypto";

/** Generate a Scratch-compatible opaque ID (20 lowercase hex characters). */
export function newId(): string {
  return randomBytes(10).toString("hex");
}

/** Generate an ID that is not present in the supplied collection. */
export function newUniqueId(existing: { has(id: string): boolean }): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const id = newId();
    if (!existing.has(id)) {
      return id;
    }
  }
  throw new Error("Unable to generate a unique Scratch ID.");
}
