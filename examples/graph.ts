import { createLegacyStagedWrite, defineDraftType } from "../src/index.js";
import type { GraphOp } from "../src/index.js";

const definition = defineDraftType({
  id: "example.shared-document", version: "1",
  nodeTypes: {
    project: { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["name"] },
    document: { valueSchema: { type: "object", properties: { url: { type: "string" } }, additionalProperties: false } }
  },
  relationTypes: { uses: { from: ["project"], to: ["document"] } }
});
const engine = createLegacyStagedWrite({ definitions: [definition] });
const draft = engine.create({ type: definition.id, typeVersion: definition.version });
const ops: GraphOp[] = [
  { op: "node.add", id: "project-a", nodeType: "project" },
  { op: "node.add", id: "project-b", nodeType: "project" },
  { op: "node.add", id: "shared-document", nodeType: "document" },
  { op: "set", nodeId: "project-a", path: "/name", value: "Example project" },
  { op: "set", nodeId: "shared-document", path: "/url", value: "https://example.com/document.txt" },
  { op: "edge.add", id: "uses-a", relationType: "uses", from: "project-a", to: "shared-document" },
  { op: "edge.add", id: "uses-b", relationType: "uses", from: "project-b", to: "shared-document" }
];
const preview = engine.preview(draft.id, 0, ops);
console.log("1. Preview changes:", preview.changes.length, "stored version:", engine.getDraft(draft.id).version);
const saved = engine.edit(draft.id, 0, ops);
console.log("2. Saved one batch:", JSON.stringify(saved, null, 2));
try { engine.edit(draft.id, saved.version, [{ op: "node.remove", id: "shared-document" }]); }
catch (error) { console.log("3. Removing a referenced node was rejected:", (error as Error).message); }
console.log("4. Graph remains at version:", engine.getDraft(draft.id).version);
console.log("M2 only: no remote requests or publication. The second project may remain incomplete.");
