import { isObject, type Json } from "../registry/json.js";
import { registeredTopology } from "../edit/registered-topology.js";
import type { ManagedDraft, IntentSnapshot } from "../managed/types.js";
import type { DefinitionRegistry } from "../registry/registry.js";

const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const pointer = (v: unknown) => typeof v === "string" && (v === "" || v.startsWith("/")) && !/~(?![01])/.test(v);
const optionalText = (v: Record<string, Json>, name: string) => !(name in v) || text(v[name]);

/** Input has already passed the JSON snapshot boundary. Suggestions never mutate the draft. */
export function validDiagnostic(entry: Json, registry: DefinitionRegistry, draft: ManagedDraft, baseline: IntentSnapshot): boolean {
  const batch = (ops: unknown): boolean => {
    try { registeredTopology(registry, draft).evaluate(draft, baseline, draft.definitionDigest, ops, { preview: true }); return true; }
    catch { return false; }
  };
  const candidate = (v: Json, excluded = false): boolean => isObject(v) &&
    keys(v, ["value", "label", "message", "metadata", ...(excluded ? [] : ["repairOps"])]) && Object.hasOwn(v, "value") &&
    (v.value === null || ["string", "number", "boolean"].includes(typeof v.value)) &&
    optionalText(v, "label") && optionalText(v, "message") &&
    (!("metadata" in v) || isObject(v.metadata)) && (!("repairOps" in v) || batch(v.repairOps));
  if (!isObject(entry) || !keys(entry, ["code", "path", "message", "severity", "hint", "candidates", "related", "repairs", "excludedCandidates", "constraintIds", "stage", "retryable", "retryAfterSeconds", "metadata"]) ||
    !text(entry.code) || !pointer(entry.path) || !text(entry.message) ||
    ("severity" in entry && entry.severity !== "error" && entry.severity !== "warning") ||
    !optionalText(entry, "hint") || !optionalText(entry, "stage") ||
    ("related" in entry && (!Array.isArray(entry.related) || !entry.related.every(pointer))) ||
    ("candidates" in entry && (!Array.isArray(entry.candidates) || !entry.candidates.every(v => candidate(v)))) ||
    ("excludedCandidates" in entry && (!Array.isArray(entry.excludedCandidates) || !entry.excludedCandidates.every(v => candidate(v, true)))) ||
    ("constraintIds" in entry && (!Array.isArray(entry.constraintIds) || !entry.constraintIds.every(text))) ||
    ("metadata" in entry && !isObject(entry.metadata)) ||
    ("retryable" in entry && typeof entry.retryable !== "boolean") ||
    ("retryAfterSeconds" in entry && (entry.retryable !== true || !Number.isSafeInteger(entry.retryAfterSeconds) || Number(entry.retryAfterSeconds) < 0)) ||
    ("repairs" in entry && (!Array.isArray(entry.repairs) || !entry.repairs.every(v => isObject(v) && keys(v, ["id", "message", "ops"]) && optionalText(v, "id") && text(v.message) && batch(v.ops))))) return false;
  return true;
}
