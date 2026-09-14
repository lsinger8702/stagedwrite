import { randomUUID } from "node:crypto";
import type { RunInput } from "../storage/drafts.js";

export interface PublishOptions {
  /** Stable identity for one logical submission. Use a different ID for a new intent. */
  runId: string;
}
export function publicationId(options: PublishOptions | undefined): string {
  if (options === undefined) return randomUUID();
  if (!options || typeof options !== "object" || Object.keys(options).some(k => k !== "runId") ||
      typeof options.runId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(options.runId)) throw new Error("INVALID_PUBLISH_OPTIONS");
  return options.runId;
}
export function requireSameSubmission(input: RunInput, draftId: string, certificate: string): void {
  if (input.draft.id !== draftId || input.certificate !== certificate) throw new Error("RUN_ID_CONFLICT");
}
