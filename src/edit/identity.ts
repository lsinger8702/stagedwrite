import { randomUUID } from "node:crypto";

export const PREVIEW_REF_PREFIX = "preview:";
export type IdentityKind = "node" | "edge";

/** Per-candidate allocation: failed edits consume no durable state. Both current and
 * retired identities must be supplied. Baseline restoration does not allocate an ID. */
export function createIdentityAllocator(options: {
  preview: boolean;
  reserved: Iterable<string>;
  /** Test seam for byte-stable mock evidence; production uses randomUUID. */
  next?: () => string;
}) {
  const used = new Set(options.reserved);
  let sequence = 0;
  return (kind: IdentityKind): string => {
    for (let i = 0; i < 32; i++) {
      const suffix = options.preview ? String(++sequence) : (options.next ?? randomUUID)();
      if (typeof suffix !== "string" || !/^[A-Za-z0-9_-]+$/.test(suffix)) throw new Error("INVALID_IDENTITY_SOURCE");
      const id = `${options.preview ? PREVIEW_REF_PREFIX : ""}${kind}_${suffix}`;
      if (!used.has(id)) { used.add(id); return id; }
    }
    throw new Error("IDENTITY_ALLOCATION_EXHAUSTED");
  };
}
