import assert from "node:assert/strict";
import { createLegacyStagedWrite, defineDraftType } from "../src/index.js";
import type { GraphExecutor, Step } from "../src/index.js";

const node = { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["name"] } as const;
const definition = defineDraftType({ id: "example.dependencies", version: "1",
  nodeTypes: { project: node, task: node }, relationTypes: { contains: { from: ["project"], to: ["task"] } } });
const selector = { type: definition.id, typeVersion: definition.version };
let rejectProject = true;
const created: string[] = [];
const executor: GraphExecutor = { ...selector, id: "example.dependencies", version: "1", target: "mock:local",
  plan: draft => {
    const edges = Object.values(draft.edges);
    if (edges.length !== 1 || Object.keys(draft.nodes).length !== 2) throw new Error("EXPECTED_PARENT_CHILD_PAIR");
    const edge = edges[0]!;
    const name = (id: string) => { const field = draft.nodes[id]!.fields.name; return field?.kind === "value" ? field.value : null; };
    // This executor explicitly maps its business relation to execution dependencies.
    return [
      { id: edge.from, payload: { name: name(edge.from) } },
      { id: edge.to, payload: { name: name(edge.to) }, dependsOn: [edge.from], inputRefs: { projectId: edge.from } }
    ];
  },
  apply: async (step: Step) => {
    if (step.id === "project") {
      if (rejectProject) return { kind: "not_applied", reason: "Synthetic name refusal" };
      created.push(step.id);
      return { kind: "applied", remoteRef: "remote_project" };
    }
    assert.equal(step.payload.projectId, "remote_project");
    created.push(step.id);
    return { kind: "unknown", reason: "Synthetic response lost after creating task" };
  },
  reconcile: async step => {
    assert.equal(step.payload.projectId, "remote_project");
    return { kind: "applied", remoteRef: "remote_task" };
  }
};
const engine = createLegacyStagedWrite({ definitions: [definition], mode: "executable", executors: [executor] });
const draft = engine.create(selector);
engine.edit(draft.id, 0, [
  { op: "node.add", id: "project", nodeType: "project" }, { op: "set", nodeId: "project", path: "/name", value: "Rejected name" },
  { op: "node.add", id: "task", nodeType: "task" }, { op: "set", nodeId: "task", path: "/name", value: "Synthetic task" },
  { op: "edge.add", id: "contains", relationType: "contains", from: "project", to: "task" }
]);
const failed = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
assert.equal(created.length, 0);
console.log("1. Zero-effect refusal:", failed.steps.map(s => s.status));
const revised = engine.revise(failed.id);
engine.edit(revised.id, 0, [{ op: "set", nodeId: "project", path: "/name", value: "Accepted name" }]);
rejectProject = false;
const partial = await engine.publish(revised.id, engine.preflight(revised.id).certificate!);
assert.equal(partial.state, "unknown");
console.log("2. Child received parent ID:", partial.steps[1]?.resolvedPayload);
const complete = await engine.resume(partial.id);
assert.equal(complete.state, "published");
assert.deepEqual(created, ["project", "task"]);
assert.equal(engine.getRun(failed.id).state, "failed");
console.log("3. Recovered without duplicate creation:", complete.state, created);
console.log("Offline simulation only; no remote requests or process-restart guarantee.");
