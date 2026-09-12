import type { Adjudication } from "../types.js";
import { isObject, jsonSnapshot } from "../registry/json.js";

export function validateAdjudication(input: unknown): Adjudication {
  const issues: string[] = [];
  const value = jsonSnapshot(input, (_p, message) => issues.push(message));
  const text = (v: unknown) => typeof v === "string" && !!v.trim();
  if (issues.length || !isObject(value) || Object.keys(value).length !== 6 ||
      !["requestId", "actor", "evidence", "note"].every(k => text(value[k])) ||
      !Number.isSafeInteger(value.expectedSequence) || (value.expectedSequence as number) < 0 || !isObject(value.decision)) throw new Error("INVALID_ADJUDICATION");
  const d = value.decision;
  const valid = d.kind === "applied" ? Object.keys(d).length === 2 && text(d.remoteRef)
    : d.kind === "no_effect" ? Object.keys(d).length === 2 && (d.next === "retry" || d.next === "stop")
    : d.kind === "close_unresolved" && Object.keys(d).length === 1;
  // Reject unknown keys even when another field is absent.
  if (!valid || Object.keys(value).some(k => !["requestId", "expectedSequence", "actor", "evidence", "note", "decision"].includes(k))) throw new Error("INVALID_ADJUDICATION");
  return value as unknown as Adjudication;
}
