import type { GraphDraft } from "../graph/types.js";
import type { DefinitionSelector } from "../registry/types.js";
import type { DefinitionRegistry } from "../registry/registry.js";
import type { Step, Adapter, Clock, Run } from "../types.js";
import { deepFreeze } from "../registry/json.js";
import { validatePlan } from "./plan.js";
import { ExecutionRuntime } from "./runtime.js";

export interface GraphExecutor extends DefinitionSelector {
  id: string;
  version: string;
  /** Stable, non-secret destination identity, e.g. Stripe test account ID. */
  target: string;
  plan(draft: GraphDraft): readonly Step[];
  apply: Adapter["apply"];
  reconcile: Adapter["reconcile"] | { unsupported: string };
}
export interface BoundExecutor {
  id: string; version: string; target: string;
  plan(draft: GraphDraft): readonly Step[];
  runtime: ExecutionRuntime;
}
const key = (selector: DefinitionSelector) => JSON.stringify([selector.type, selector.typeVersion]);
export function assembleExecutors(registry: DefinitionRegistry, input: readonly GraphExecutor[], clock?: Clock, persist?: (run: Run) => void): Map<string, BoundExecutor> {
  if (!Array.isArray(input)) throw new Error("INVALID_EXECUTOR");
  const entries = new Map<string, BoundExecutor>();
  for (const executor of input) {
    if (!executor || ![executor.id, executor.version, executor.type, executor.typeVersion, executor.target].every(v => typeof v === "string" && v.trim()) ||
        typeof executor.plan !== "function" || typeof executor.apply !== "function") throw new Error("INVALID_EXECUTOR");
    registry.getDefinition(executor);
    if (entries.has(key(executor))) throw new Error("EXECUTOR_CONFLICT");
    const recovery = executor.reconcile;
    let reconcile: Adapter["reconcile"];
    if (typeof recovery === "function") reconcile = recovery.bind(executor);
    else if (recovery && typeof recovery.unsupported === "string" && recovery.unsupported.trim()) {
      const reason = recovery.unsupported;
      reconcile = async () => ({ kind: "unknown", reason: `Recovery unsupported: ${reason}` });
    } else throw new Error("RECOVERY_CAPABILITY_REQUIRED");
    entries.set(key(executor), Object.freeze({ id: executor.id, version: executor.version, target: executor.target,
      plan: executor.plan.bind(executor), runtime: new ExecutionRuntime({ apply: executor.apply.bind(executor), reconcile }, clock, persist) }));
  }
  for (const selector of registry.selectors()) if (!entries.has(key(selector))) throw new Error("EXECUTOR_REQUIRED");
  return entries;
}
export const executorFor = (entries: Map<string, BoundExecutor>, selector: DefinitionSelector): BoundExecutor => entries.get(key(selector))!;
export function fixedPlan(executor: BoundExecutor, draft: GraphDraft): Step[] {
  const plan = validatePlan(executor.plan(deepFreeze(structuredClone(draft))));
  const mapped = new Set<string>();
  for (const step of plan) if (step.effect) {
    if (!Object.hasOwn(draft.nodes, step.effect.nodeId) || mapped.has(step.effect.nodeId)) throw new Error("INVALID_EFFECT_MAPPING");
    mapped.add(step.effect.nodeId);
  }
  return plan;
}
