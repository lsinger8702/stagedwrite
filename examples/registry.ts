import { createStagedWrite, defineDraftType } from "../src/index.js";

// Teaching example: projects contain tasks with shared numeric constraints.
export const projectDefinition = defineDraftType({
  id: "example.project",
  version: "1",
  nodeTypes: {
    project: {
      valueSchema: {
        type: "object",
        $defs: { quantity: { type: "number", minimum: 0 } },
        properties: {
          name: { type: "string", minLength: 1 },
          capacity: { $ref: "#/$defs/quantity" },
          capacityLimit: { $ref: "#/$defs/quantity" }
        },
        additionalProperties: false
      },
      requiredAtPublish: ["name", "capacity"]
    },
    task: {
      valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false },
      requiredAtPublish: ["name"]
    }
  },
  relationTypes: { contains: { from: ["project"], to: ["task"] } }
});

const engine = createStagedWrite({ definitions: [projectDefinition] });
const selector = { type: "example.project", typeVersion: "1" };
console.log("1. Create an incomplete empty graph:", engine.create(selector));
console.log("2. Missing publish fields are allowed here:", engine.validateValues(selector, "project", {}));
console.log("3. Shared quantity constraint rejects a negative capacity:", engine.validateValues(selector, "project", { capacity: -1 }));
console.log("M1 example: see demo:graph for M2 editing. See demo:preflight for M3 draft checks. See demo:execution for executable mode. Persistence remains future work.");
