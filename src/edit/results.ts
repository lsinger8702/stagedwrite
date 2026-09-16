import type { Json } from "../registry/json.js";
import type { CreatedRef, PatchOp } from "./protocol.js";

/** Display state, not the persisted intent representation. */
export type EditFieldState = { kind: "undeclared" } | { kind: "remove" } | { kind: "set"; value: Json };
interface ChangeSource {
  /** JSON Pointer into the submitted batch, not an index in a synthetic mixed array. */
  inputPath: string;
  op: PatchOp;
  ref: string;
}
/** Lightweight changes; node entries intentionally exclude whole node/graph snapshots. */
export type EditChange = ChangeSource & (
  | { target: "field"; scope: "canonical"; path: string; before: EditFieldState; after: EditFieldState }
  | { target: "node"; before: { nodeType: string } | null; after: { nodeType: string } | null }
  | { target: "relation"; path: string; before: string[]; after: string[] }
);
export interface EditReceipt {
  draftId: string;
  version: number;
  preflightRequired: true;
  changes: EditChange[];
  createdRefs: CreatedRef[];
}
/** Created intent plus the input-position mapping for server-assigned identities. */
export interface CreateReceipt<Draft> { draft: Draft; createdRefs: CreatedRef[] }
export interface EditPreview<Draft> {
  preview: true;
  candidate: Draft;
  changes: EditChange[];
  createdRefs: CreatedRef[];
}
