import { PREVIEW_REF_PREFIX } from "./identity.js";
import { isObject, jsonSnapshot, pointer, type Json } from "../registry/json.js";

// Migration module: not exported from the package until the managed engine uses it.
export type PatchOp = "set" | "remove" | "reset";
export type FieldPatch = { ref: string; scope: "canonical"; path: string } & (
  | { op: "set"; value: Json }
  | { op: "remove" | "reset"; value?: never }
);
export type NodeSpec =
  | { nodeType: string; fields: Record<string, Json>; relations?: Record<string, NodeInput[]>; cloneFromRef?: never }
  | { cloneFromRef: string; nodeType?: never; fields?: never; relations?: never };
export type NodeInput = NodeSpec | { ref: string };
export type TopologyPatch =
  | { op: "set"; parentRef: string; path: string; value: NodeSpec; ref?: never }
  | { op: "set"; ref: string; path: string; value: NodeInput[]; parentRef?: never }
  | { op: "remove" | "reset"; ref: string; parentRef?: never; path?: never; value?: never };
export interface EditBatch { graphPatches?: TopologyPatch[]; patches?: FieldPatch[] }
export interface CreatedRef { path: string; ref: string; sourceRef?: string }
export interface EditInputIssue {
  code: "INVALID_EDIT_INPUT" | "PATCH_SELF_CONFLICT";
  path: string;
  message: string;
  hint: string;
  relatedPaths?: string[];
  ref?: string;
  scope?: "canonical";
  fieldPath?: string;
}
export class EditInputError extends Error {
  readonly code: EditInputIssue["code"];
  readonly hint: string;
  constructor(readonly issues: EditInputIssue[]) {
    super(issues.map(issue => issue.message).join("\n"));
    this.name = "EditInputError";
    this.code = issues[0]!.code;
    this.hint = issues.map(issue => issue.hint).join("\n");
  }
  toJSON() { return { code: this.code, message: this.message, hint: this.hint, issues: this.issues }; }
}
const safe = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0
  && !["__proto__", "prototype", "constructor"].includes(s);

/** Decode exactly once. URI fragments and percent decoding are not part of this protocol. */
export function decodeEditPath(path: unknown): string[] | undefined {
  if (typeof path !== "string" || !path.startsWith("/") || /~(?![01])/.test(path)) return;
  const parts = path.slice(1).split("/").map(p => p.replaceAll("~1", "/").replaceAll("~0", "~"));
  return parts.every(safe) ? parts : undefined;
}

/** Shape/conflict validation only: schema, graph identity and execution guards run in the evaluator.
 * Returns an independent JSON snapshot; never mutates a Draft or reads caller accessors. */
export function parseEditBatch(raw: unknown): EditBatch {
  const issues: EditInputIssue[] = [];
  const bad = (path: string, message: string, hint = "Use the documented edit shape; remove unsupported properties and provide all required properties.") => {
    issues.push({ code: "INVALID_EDIT_INPUT", path, message, hint });
  };
  const input = jsonSnapshot(raw, (path, message) => bad(path, message, "Provide plain finite JSON data without accessors, cycles or unsafe keys."));
  if (issues.length) throw new EditInputError(issues);
  const shape = (x: unknown, required: string[], optional: string[], at: string): x is Record<string, Json> => {
    if (!isObject(x)) { bad(at, "Expected an object."); return false; }
    let valid = true;
    for (const key of required) if (!Object.hasOwn(x, key)) { bad(`${at}/${key}`, `Missing required property ${key}.`); valid = false; }
    for (const key of Object.keys(x)) if (![...required, ...optional].includes(key)) { bad(`${at}/${pointer(key)}`, `Property ${key} is not allowed in this form.`); valid = false; }
    return valid;
  };
  const ref = (value: unknown, at: string) => {
    if (!safe(value)) bad(at, "Expected a nonempty safe identity.", "Use an existing persisted node ref; do not invent a new node ID.");
    else if (value.startsWith(PREVIEW_REF_PREFIX)) bad(at, "Preview identities are provisional and cannot be submitted as existing refs.", "Submit the original batch to edit, then use the actual createdRefs returned by that edit.");
  };
  const path = (value: unknown, at: string, relation = false) => {
    const parts = decodeEditPath(value);
    if (!parts || (relation && parts.length !== 1)) bad(at, relation ? "Expected a one-segment relationship JSON Pointer." : "Expected a nonempty safe JSON Pointer.", "Escape ~ as ~0 and / as ~1 inside a segment; provide a registered field or relation path.");
    return parts;
  };
  const node = (value: unknown, at: string, allowRef: boolean): void => {
    if (!isObject(value)) { bad(at, "Expected a node specification."); return; }
    if (Object.hasOwn(value, "ref")) {
      if (!allowRef) { bad(at, "An existing ref cannot be used as a new node specification.", "Provide nodeType plus fields, or cloneFromRef to create a new identity."); return; }
      if (shape(value, ["ref"], [], at)) ref(value.ref, `${at}/ref`);
    } else if (Object.hasOwn(value, "cloneFromRef")) {
      if (shape(value, ["cloneFromRef"], [], at)) ref(value.cloneFromRef, `${at}/cloneFromRef`);
    } else if (shape(value, ["nodeType", "fields"], ["relations"], at)) {
      if (!safe(value.nodeType)) bad(`${at}/nodeType`, "Expected a registered node type name.");
      if (!isObject(value.fields)) bad(`${at}/fields`, "Initial fields must be an object.");
      if (Object.hasOwn(value, "relations")) {
        if (!isObject(value.relations)) bad(`${at}/relations`, "Relations must be a slot-to-input-array object.");
        else for (const [slot, entries] of Object.entries(value.relations)) {
          const p = `${at}/relations/${pointer(slot)}`;
          if (!safe(slot)) bad(p, "Expected a safe relation name.");
          if (!Array.isArray(entries)) bad(p, "A relation slot must be an array, including for one target.");
          else entries.forEach((entry, i) => node(entry, `${p}/${i}`, true));
        }
      }
    }
  };
  if (!shape(input, [], ["graphPatches", "patches"], "")) throw new EditInputError(issues);
  for (const key of ["graphPatches", "patches"]) {
    if (Object.hasOwn(input, key) && !Array.isArray(input[key])) bad(`/${key}`, "An edit channel must be an array.");
  }
  if (issues.length) throw new EditInputError(issues);
  const fields = (input.patches ?? []) as Json[];
  const topology = (input.graphPatches ?? []) as Json[];
  if (!fields.length && !topology.length) bad("", "The edit batch contains no operations.", "Provide at least one field or topology patch.");
  const groups = new Map<string, { ref: string; fieldPath: string; locations: string[] }>();
  fields.forEach((p, i) => {
    const at = `/patches/${i}`;
    if (!isObject(p) || !["set", "remove", "reset"].includes(String(p.op))) { bad(at, "Field op must be set, remove or reset."); return; }
    if (!shape(p, ["op", "ref", "scope", "path", ...(p.op === "set" ? ["value"] : [])], [], at)) return;
    ref(p.ref, `${at}/ref`);
    if (p.scope !== "canonical") bad(`${at}/scope`, "Only explicit canonical scope is supported.", "Set scope to canonical. Missing, empty and unsupported spaces are rejected.");
    const parts = path(p.path, `${at}/path`);
    if (safe(p.ref) && p.scope === "canonical" && parts) {
      const key = JSON.stringify([p.ref, p.scope, parts]);
      const group = groups.get(key) ?? { ref: p.ref, fieldPath: `/${parts.map(pointer).join("/")}`, locations: [] };
      group.locations.push(at);
      groups.set(key, group);
    }
  });
  topology.forEach((p, i) => {
    const at = `/graphPatches/${i}`;
    if (!isObject(p) || !["set", "remove", "reset"].includes(String(p.op))) { bad(at, "Topology op must be set, remove or reset."); return; }
    if (p.op !== "set") {
      if (shape(p, ["op", "ref"], [], at)) ref(p.ref, `${at}/ref`);
    } else if (Object.hasOwn(p, "parentRef")) {
      if (!shape(p, ["op", "parentRef", "path", "value"], [], at)) return;
      ref(p.parentRef, `${at}/parentRef`); path(p.path, `${at}/path`, true); node(p.value, `${at}/value`, false);
    } else {
      if (!shape(p, ["op", "ref", "path", "value"], [], at)) return;
      ref(p.ref, `${at}/ref`); path(p.path, `${at}/path`, true);
      if (!Array.isArray(p.value)) bad(`${at}/value`, "Replacing a relation slot requires a full array of targets.");
      else p.value.forEach((entry, j) => node(entry, `${at}/value/${j}`, true));
    }
  });
  for (const group of groups.values()) if (group.locations.length > 1) {
    issues.push({ code: "PATCH_SELF_CONFLICT", path: group.locations[1]!, relatedPaths: group.locations.filter((_, i) => i !== 1),
      ref: group.ref, scope: "canonical", fieldPath: group.fieldPath,
      message: `${group.locations.join(", ")} modify the same field ${group.ref} canonical:${group.fieldPath}; the entire batch is rejected.`,
      hint: "Keep one OP expressing the final intent for this field, or submit separate batches using the version returned by the previous edit. Nothing in this batch was applied." });
  }
  if (issues.length) throw new EditInputError(issues);
  return input as unknown as EditBatch;
}
