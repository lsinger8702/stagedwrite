import { canonicalJson, type Json } from "../registry/json.js";
import type { TopologySnapshot } from "../edit/evaluate-topology.js";
import { EditInputError } from "../edit/protocol.js";

const same = (a: unknown, b: unknown) => canonicalJson(a as Json) === canonicalJson(b as Json);
export interface RepairProtection {
  state: "running" | "blocked" | "unknown" | "published";
  adopted: TopologySnapshot;
  successfulNodes: readonly string[];
}
/** One shared safety policy for publication, preview and both migration stages. */
export function protectIntentRepair(candidate: TopologySnapshot, run?: RepairProtection): void {
  if (!run) return;
  if (run.state === "published") throw new Error("UPDATE_NOT_SUPPORTED");
  const old = run.adopted;
  if (!same(old.graph.edges, candidate.graph.edges) || !same(Object.keys(old.graph.nodes).sort(), Object.keys(candidate.graph.nodes).sort()))
    throw new Error("REPAIR_TOPOLOGY_CHANGED");
  for (const id of Object.keys(old.graph.nodes)) if (old.graph.nodes[id]!.nodeType !== candidate.graph.nodes[id]!.nodeType)
    throw new Error("REPAIR_TOPOLOGY_CHANGED");
  for (const id of run.successfulNodes) {
    if (!Object.hasOwn(old.graph.nodes, id) || !Object.hasOwn(candidate.graph.nodes, id)) throw new Error("REPAIR_TOPOLOGY_CHANGED");
    if (!same(old.graph.nodes[id], candidate.graph.nodes[id]) || !same(old.fieldIntents[id] ?? {}, candidate.fieldIntents[id] ?? {}))
      throw new Error("APPLIED_STEP_IMMUTABLE");
  }
}
/** Run before allocation or candidate evaluation. Version never grants execution rights. */
export function requireEditVersion(current: number, expected: number): void {
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(expected) || expected < 0 || current !== expected)
    throw new EditInputError([{ code: "INVALID_EDIT_INPUT", path: "/expectedVersion", message: "STALE_VERSION: the requested version does not match the current Draft.", hint: "Read the current Draft preview and generate a fresh edit against its version." }]);
  if (current === Number.MAX_SAFE_INTEGER)
    throw new EditInputError([{ code: "INVALID_EDIT_INPUT", path: "/expectedVersion", message: "VERSION_EXHAUSTED: this Draft cannot increment its version safely.", hint: "Stop editing this Draft and investigate version exhaustion; do not replay a stale request." }]);
}
