import { createStagedWrite, defineDraftType } from "../src/index.js";
import type { GraphOp } from "../src/index.js";

const definition = defineDraftType({
  id: "example.shared-asset", version: "1",
  nodeTypes: {
    campaign: { valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["name"] },
    asset: { valueSchema: { type: "object", properties: { url: { type: "string" } }, additionalProperties: false } }
  },
  relationTypes: { uses: { from: ["campaign"], to: ["asset"] } }
});
const engine = createStagedWrite({ definitions: [definition] });
const draft = engine.create({ type: definition.id, typeVersion: definition.version });
const ops: GraphOp[] = [
  { op: "node.add", id: "campaign-a", nodeType: "campaign" },
  { op: "node.add", id: "campaign-b", nodeType: "campaign" },
  { op: "node.add", id: "shared-image", nodeType: "asset" },
  { op: "set", nodeId: "campaign-a", path: "/name", value: "Summer" },
  { op: "set", nodeId: "shared-image", path: "/url", value: "https://example.com/image.png" },
  { op: "edge.add", id: "uses-a", relationType: "uses", from: "campaign-a", to: "shared-image" },
  { op: "edge.add", id: "uses-b", relationType: "uses", from: "campaign-b", to: "shared-image" }
];
const preview = engine.preview(draft.id, 0, ops);
console.log("1. Preview changes:", preview.changes.length, "stored version:", engine.getDraft(draft.id).version);
const saved = engine.edit(draft.id, 0, ops);
console.log("2. Saved one batch:", JSON.stringify(saved, null, 2));
try { engine.edit(draft.id, saved.version, [{ op: "node.remove", id: "shared-image" }]); }
catch (error) { console.log("3. Removing a referenced node was rejected:", (error as Error).message); }
console.log("4. Graph remains at version:", engine.getDraft(draft.id).version);
console.log("M2 only: no remote requests or publication. The second campaign may remain incomplete.");
