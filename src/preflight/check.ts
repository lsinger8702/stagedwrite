import { randomUUID } from "node:crypto";
import type { DefinitionRegistry } from "../registry/registry.js";
import { deepFreeze, definitionDigest, isObject, jsonSnapshot, pointer } from "../registry/json.js";
import { evaluateGraphEdit } from "../graph/edit.js";
import type { GraphDraft, GraphOp } from "../graph/types.js";
import type { GraphRule, GraphDiagnostic, GraphCheck, SourcedGraphDiagnostic } from "./types.js";

const builtinVersion = "graph-completeness-v1";
const bindingKey = (type: string, version: string) => JSON.stringify([type, version]);
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const exactKeys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const validPointer = (v: unknown): v is string => typeof v === "string" && (v === "" || v.startsWith("/")) && !/~(?![01])/.test(v);

export class GraphPreflight {
  #rules = new Map<string, readonly GraphRule[]>();
  constructor(private readonly registry: DefinitionRegistry, rules: readonly GraphRule[]) {
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
  rulesDigest(draft: GraphDraft): string {
    const rules = this.#rules.get(bindingKey(draft.type, draft.typeVersion)) ?? [];
    return definitionDigest({ builtinVersion, rules: rules.map(({ id, version, type, typeVersion }) => ({ id, version, type, typeVersion })) });
  }
  run(draft: GraphDraft): GraphCheck {
    const { definition, digest } = this.registry.getDefinition(draft);
    if (digest !== draft.definitionDigest) throw new Error("DEFINITION_MISMATCH");
    const diagnostics: SourcedGraphDiagnostic[] = [];
    const builtin = (code: string, path: string, message: string) => diagnostics.push({
      code, path, message, resolution: { kind: "blocked", reason: "human_intent" }, source: { kind: "builtin", version: builtinVersion }
    });
    if (!Object.keys(draft.nodes).length) builtin("graph.empty", "/nodes", "Add at least one node to express the intended change.");
    for (const id of Object.keys(draft.nodes).sort()) {
      const node = draft.nodes[id]!;
      for (const field of definition.nodeTypes[node.nodeType]!.requiredAtPublish ?? []) {
        if (node.fields[field]?.kind !== "value") builtin("field.required", `/nodes/${pointer(id)}/fields/${pointer(field)}`, `Supply an explicit value for ${field}.`);
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
          if (!isObject(entry) || !exactKeys(entry, ["code", "path", "message", "resolution"]) || !text(entry.code) || !validPointer(entry.path) || !text(entry.message) || !isObject(entry.resolution)) throw new Error("Invalid diagnostic");
          const resolution = entry.resolution;
          if (resolution.kind === "ops") {
            if (!exactKeys(resolution, ["kind", "ops"]) || !Array.isArray(resolution.ops)) throw new Error("Invalid repair");
            // Runtime M2 validation also rejects invalid shapes, stale IDs and invalid final graphs.
            evaluateGraphEdit(this.registry, draft, draft.version, resolution.ops as unknown as GraphOp[]);
          } else if (resolution.kind === "blocked") {
            if (!exactKeys(resolution, ["kind", "reason", "message"]) || !["human_intent", "unsupported"].includes(String(resolution.reason)) ||
                ("message" in resolution && typeof resolution.message !== "string")) throw new Error("Invalid blocked reason");
          } else throw new Error("Invalid resolution");
          accepted.push({ ...(entry as unknown as GraphDiagnostic), source });
        }
        diagnostics.push(...accepted);
      } catch {
        incomplete = true;
        diagnostics.push({ code: "rule.error", path: "", message: `Rule ${rule.id}@${rule.version} did not return valid synchronous diagnostics and repairs.`,
          resolution: { kind: "blocked", reason: "unsupported", message: "Fix the rule implementation and run preflight again." }, source });
      }
    }
    return { scope: "draft", checkId: randomUUID(), draftId: draft.id, version: draft.version, definitionDigest: draft.definitionDigest,
      rulesDigest: this.rulesDigest(draft), status: incomplete ? "incomplete" : diagnostics.length ? "blocked" : "passed", diagnostics };
  }
}
