import type { Draft, Op } from "./types.js";

export function edited(draft: Draft, expectedVersion: number, ops: Op[]): Draft {
  if (draft.version !== expectedVersion) throw new Error("STALE_VERSION");
  const next = structuredClone(draft);
  for (const op of ops) {
    // Restrict the prototype to simple field names; nested JSON Pointer is future work.
    if (!/^\/[a-zA-Z][a-zA-Z0-9_]*$/.test(op.path)) throw new Error("UNSUPPORTED_PATH");
    const field = op.path.slice(1);
    if (["__proto__", "constructor", "prototype"].includes(field)) throw new Error("UNSUPPORTED_PATH");
    switch (op.op) {
      case "set":
        if (op.value !== null && !["string", "boolean", "number"].includes(typeof op.value)) {
          throw new Error("UNSUPPORTED_VALUE");
        }
        if (typeof op.value === "number" && !Number.isFinite(op.value)) throw new Error("UNSUPPORTED_VALUE");
        next.fields[field] = { kind: "value", value: op.value };
        break;
      case "remove": next.fields[field] = { kind: "clear" }; break;
      case "reset": delete next.fields[field]; break;
      default: throw new Error("UNSUPPORTED_OP");
    }
  }
  next.version++;
  return next;
}
