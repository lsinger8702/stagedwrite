import { performance } from "node:perf_hooks";
import { deepFreeze, definitionDigest, isObject, jsonSnapshot } from "../registry/json.js";
import type { DefinitionRegistry } from "../registry/registry.js";
import type { GraphDraft } from "../graph/types.js";
import type { AsyncGraphRule, GraphCheck, GraphDiagnostic } from "./types.js";
import { GraphPreflight } from "./check.js";
import { validDiagnostic } from "./diagnostic.js";

export class AsyncPreflight {
  private readonly rules: readonly AsyncGraphRule[];
  constructor(private readonly registry: DefinitionRegistry, sync: readonly import("./types.js").GraphRule[], rules: readonly AsyncGraphRule[], readonly timeoutMs: number) {
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2_147_483_647) throw new Error("INVALID_PREFLIGHT_TIMEOUT");
    if (!Array.isArray(rules)) throw new Error("INVALID_RULE");
    // Reuse identity/shape validation; the dummy callback is never executed.
    new GraphPreflight(registry, [...sync, ...rules.map(rule => ({ ...rule, check: () => [] }))]);
    if (rules.some(rule => typeof rule?.check !== "function")) throw new Error("INVALID_RULE");
    this.rules = Object.freeze(rules.map(rule => Object.freeze({ ...rule })));
  }
  digest(draft: GraphDraft, syncDigest: string): string {
    const rules = this.rules.filter(r => r.type === draft.type && r.typeVersion === draft.typeVersion);
    return rules.length ? definitionDigest({ syncDigest, asyncRules: rules.map(({ id, version, type, typeVersion }) => ({ id, version, type, typeVersion })) }) : syncDigest;
  }
  async run(draft: GraphDraft, result: GraphCheck, deadline: number): Promise<GraphCheck> {
    result.pendingRules = [];
    let incomplete = result.status === "incomplete";
    for (const rule of this.rules.filter(r => r.type === draft.type && r.typeVersion === draft.typeVersion)) {
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        result.pendingRules.push({ ruleId: rule.id, ruleVersion: rule.version, message: "Not checked: this preflight exhausted its time budget. Retry preflight.", retryAfterSeconds: 1 });
        continue;
      }
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      let timedOut = false;
      const source = { kind: "rule" as const, id: rule.id, version: rule.version };
      try {
        const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { timedOut = true; reject(new Error("timeout")); controller.abort(); }, remaining); });
        const invocation = Promise.resolve().then(() => rule.check(deepFreeze(structuredClone(draft)), { signal: controller.signal }));
        const output: unknown = await Promise.race([invocation, timeout]);
        const failures: string[] = [];
        const copied = jsonSnapshot(output, (path, message) => failures.push(`${path}: ${message}`));
        if (failures.length || !isObject(copied) || !["complete", "pending"].includes(String(copied.status)) ||
          Object.keys(copied).some(k => !(copied.status === "pending" ? ["status", "message", "retryAfterSeconds", "diagnostics"] : ["status", "diagnostics"]).includes(k))) throw new Error("Invalid async result");
        const diagnostics = copied.diagnostics ?? (copied.status === "pending" && !Object.hasOwn(copied, "diagnostics") ? [] : null);
        if (!Array.isArray(diagnostics) || !diagnostics.every(d => validDiagnostic(d, this.registry, draft))) throw new Error("Invalid diagnostics");
        if (copied.status === "pending") {
          if (typeof copied.message !== "string" || !copied.message.trim() ||
            ("retryAfterSeconds" in copied && (!Number.isSafeInteger(copied.retryAfterSeconds) || Number(copied.retryAfterSeconds) < 0))) throw new Error("Invalid pending result");
          result.pendingRules.push({ ruleId: rule.id, ruleVersion: rule.version, message: copied.message,
            ...("retryAfterSeconds" in copied ? { retryAfterSeconds: Number(copied.retryAfterSeconds) } : {}) });
        }
        for (const raw of diagnostics) {
          const diagnostic = raw as unknown as GraphDiagnostic;
          result.diagnostics.push({ ...diagnostic, severity: diagnostic.severity ?? "error", source });
        }
      } catch {
        if (timedOut) deadline = 0;
        incomplete = true;
        result.diagnostics.push({ code: timedOut ? "rule.timeout" : "rule.error", path: "", severity: "error", source,
          message: timedOut ? `Rule ${rule.id} exceeded the preflight time budget; its outcome is unknown.` : `Rule ${rule.id} failed or returned invalid diagnostics.`,
          ...(timedOut ? { retryable: true } : {}) });
      } finally { if (timer !== undefined) clearTimeout(timer); }
    }
    result.status = incomplete ? "incomplete" : result.pendingRules.length ? "pending" : result.diagnostics.some(d => d.severity === "error") ? "blocked" : "passed";
    return result;
  }
}
