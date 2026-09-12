import type { GraphDraft } from "../graph/types.js";
import type { DefinitionSelector } from "../registry/types.js";
import type { DefinitionRegistry } from "../registry/registry.js";
import type { Step, Adapter } from "../types.js";
import { deepFreeze, isObject, jsonSnapshot } from "../registry/json.js";
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
export function assembleExecutors(registry: DefinitionRegistry, input: readonly GraphExecutor[]): Map<string, BoundExecutor> {
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
      plan: executor.plan.bind(executor), runtime: new ExecutionRuntime({ apply: executor.apply.bind(executor), reconcile }) }));
  }
  for (const selector of registry.selectors()) if (!entries.has(key(selector))) throw new Error("EXECUTOR_REQUIRED");
  return entries;
}
export const executorFor = (entries: Map<string, BoundExecutor>, selector: DefinitionSelector): BoundExecutor => entries.get(key(selector))!;
export function fixedPlan(executor: BoundExecutor, draft: GraphDraft): Step[] {
  const output: unknown = executor.plan(deepFreeze(structuredClone(draft)));
  if (output instanceof Promise) { void output.catch(() => undefined); throw new Error("INVALID_PLAN"); }
  const issues: string[] = [];
  const plan = jsonSnapshot(output, (path, message) => issues.push(`${path}: ${message}`));
  if (issues.length || !Array.isArray(plan) || !plan.length) throw new Error("INVALID_PLAN");
  const ids = new Set<string>();
  for (const step of plan) {
    if (!isObject(step) || Object.keys(step).length !== 2 || typeof step.id !== "string" || !step.id.trim() || ids.has(step.id) || !isObject(step.payload) ||
      Object.values(step.payload).some(value => value !== null && !["string", "number", "boolean"].includes(typeof value))) throw new Error("INVALID_PLAN");
    ids.add(step.id);
  }
  return plan as unknown as Step[];
}
