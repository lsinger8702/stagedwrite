import type { Step } from "../types.js";
import { isObject, jsonSnapshot } from "../registry/json.js";
/** Validate the executor plan before persisting an artifact. */
export function validatePlan(output: unknown): Step[] {
    if (output instanceof Promise) {
        void output.catch(() => undefined);
        throw new Error("INVALID_PLAN");
    }
    const issues: string[] = [];
    const plan = jsonSnapshot(output, (_path, message) => issues.push(message));
    if (issues.length || !Array.isArray(plan) || !plan.length)
        throw new Error("INVALID_PLAN");
    const ids = new Set<string>();
    for (const step of plan) {
        if (!isObject(step) || Object.keys(step).some(k => !["id", "payload", "dependsOn", "inputRefs", "effect"].includes(k)) ||
            typeof step.id !== "string" || !step.id.trim() || ids.has(step.id) || !isObject(step.payload) ||
            Object.values(step.payload).some(v => v !== null && !["string", "number", "boolean"].includes(typeof v)))
            throw new Error("INVALID_PLAN");
        const deps = step.dependsOn ?? [];
        if (!Array.isArray(deps) || new Set(deps).size !== deps.length || deps.some(d => typeof d !== "string" || !ids.has(d)))
            throw new Error("INVALID_PLAN");
        if (Object.hasOwn(step, "dependsOn") && !Array.isArray(step.dependsOn))
            throw new Error("INVALID_PLAN");
        if (Object.hasOwn(step, "inputRefs")) {
            if (!isObject(step.inputRefs) || Object.entries(step.inputRefs).some(([field, dep]) => !field.trim() || Object.hasOwn(step.payload as object, field) || typeof dep !== "string" || !deps.includes(dep)))
                throw new Error("INVALID_PLAN");
        }
        if ((!isObject(step.effect) || Object.keys(step.effect).length !== 2 ||
            step.effect.kind !== "create" || typeof step.effect.nodeId !== "string" || !step.effect.nodeId.trim()))
            throw new Error("INVALID_PLAN");
        ids.add(step.id);
    }
    return plan as unknown as Step[];
}
