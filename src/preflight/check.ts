import { validDiagnostic } from "./diagnostic.js";
import { randomUUID } from "node:crypto";
import type { DefinitionRegistry } from "../registry/registry.js";
import { deepFreeze, definitionDigest, jsonSnapshot, pointer } from "../registry/json.js";
import { previewDraft } from "./preview.js";
import type { ManagedDraft, ManagedRule, IntentSnapshot } from "../managed/types.js";
import type { GraphDiagnostic, GraphCheck, SourcedGraphDiagnostic } from "./types.js";

const builtinVersion = "graph-completeness-v1";
const bindingKey = (type: string, version: string) => JSON.stringify([type, version]);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const exactKeys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));


export class GraphPreflight {
  #rules = new Map<string, readonly ManagedRule[]>();
  constructor(private readonly registry: DefinitionRegistry, rules: readonly ManagedRule[]) {
    if (!Array.isArray(rules)) throw new Error("INVALID_RULE");
    const seen = new Set<string>();
    for (const rule of rules) {
      if (!rule || typeof rule !== "object" || !exactKeys(rule as unknown as Record<string, unknown>, ["id", "version", "type", "typeVersion", "check"]) ||
          !text(rule.id) || !text(rule.version) || !text(rule.type) || !text(rule.typeVersion) || typeof rule.check !== "function") throw new Error("INVALID_RULE");
      registry.getDefinition(rule);
      const identity = JSON.stringify([rule.type, rule.typeVersion, rule.id]);
      if (seen.has(identity)) throw new Error("RULE_CONFLICT");
      seen.add(identity);
      const key = bindingKey(rule.type, rule.typeVersion);
      // Copy binding metadata and function reference; never retain the caller's mutable rule object.
      const snapshot = Object.freeze({ id: rule.id, version: rule.version, type: rule.type, typeVersion: rule.typeVersion, check: rule.check });
      this.#rules.set(key, Object.freeze([...(this.#rules.get(key) ?? []), snapshot]));
    }
  }
  rulesDigest(draft: ManagedDraft): string {
    const rules = this.#rules.get(bindingKey(draft.type, draft.typeVersion)) ?? [];
    return definitionDigest({ builtinVersion, rules: rules.map(({ id, version, type, typeVersion }) => ({ id, version, type, typeVersion })) });
  }
  run(draft: ManagedDraft, baseline: IntentSnapshot): GraphCheck {
    const { definition, digest } = this.registry.getDefinition(draft);
    if (digest !== draft.definitionDigest) throw new Error("DEFINITION_MISMATCH");
    const diagnostics: SourcedGraphDiagnostic[] = [];
    const builtin = (code: string, path: string, message: string) => diagnostics.push({
      code, path, message, severity: "error", source: { kind: "builtin", version: builtinVersion }
    });
    if (!Object.keys(draft.graph.nodes).length) builtin("graph.empty", "/nodes", "Add at least one node to express the intended change.");
    for (const id of Object.keys(draft.graph.nodes).sort()) {
      const node = draft.graph.nodes[id]!;
      for (const field of definition.nodeTypes[node.nodeType]!.requiredAtPublish ?? []) {
        if (draft.fieldIntents[id]?.[`/${pointer(field)}`]?.kind !== "set") builtin("field.required", `/nodes/${pointer(id)}/fields/${pointer(field)}`,
          `Node ${id} requires an explicit value for ${field}; its current intent is ${draft.fieldIntents[id]?.[`/${pointer(field)}`]?.kind === "remove" ? "clear" : "undeclared"}.`);
      }
    }
    let incomplete = false;
    for (const rule of this.#rules.get(bindingKey(draft.type, draft.typeVersion)) ?? []) {
      const source = { kind: "rule" as const, id: rule.id, version: rule.version };
      try {
        const output: unknown = rule.check(deepFreeze(structuredClone(draft)));
        // Async callbacks are unsupported. Observe rejected promises to avoid an unhandled rejection.
        if (output instanceof Promise) { void output.catch(() => undefined); throw new Error("Rules must be synchronous"); }
        const failures: string[] = [];
        const copied = jsonSnapshot(output, (path, message) => failures.push(`${path}: ${message}`));
        if (failures.length || !Array.isArray(copied)) throw new Error("Expected JSON diagnostics");
        const accepted: SourcedGraphDiagnostic[] = [];
        for (const entry of copied) {
          if (!validDiagnostic(entry, this.registry, draft, baseline)) throw new Error("Invalid diagnostic");
          const diagnostic = entry as unknown as GraphDiagnostic;
          accepted.push({ ...diagnostic, severity: (diagnostic.severity ?? "error") as "error" | "warning", source });
        }
        diagnostics.push(...accepted);
      } catch {
        incomplete = true;
        diagnostics.push({ code: "rule.error", path: "", message: `Rule ${rule.id}@${rule.version} did not return valid synchronous diagnostics; this check is incomplete.`,
          severity: "error", hint: "The rule implementation must be corrected before preflight can complete.", source });
      }
    }
    return { formatVersion: 2, scope: "draft", checkId: randomUUID(), draftId: draft.id, version: draft.version, definitionDigest: draft.definitionDigest,
      rulesDigest: this.rulesDigest(draft), preview: previewDraft(draft, definition),
      status: incomplete ? "incomplete" : diagnostics.some(d => d.severity === "error") ? "blocked" : "passed", diagnostics };
  }
}
