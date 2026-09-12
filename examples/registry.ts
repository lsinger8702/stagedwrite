import { createStagedWrite, defineDraftType } from "../src/index.js";

// Public teaching domain; independent of any production adapter or account.
export const campaignDefinition = defineDraftType({
  id: "example.campaign",
  version: "1",
  nodeTypes: {
    campaign: {
      valueSchema: {
        type: "object",
        $defs: { money: { type: "number", minimum: 0 } },
        properties: {
          name: { type: "string", minLength: 1 },
          budget: { $ref: "#/$defs/money" },
          spendingLimit: { $ref: "#/$defs/money" }
        },
        additionalProperties: false
      },
      requiredAtPublish: ["name", "budget"]
    },
    adSet: {
      valueSchema: { type: "object", properties: { name: { type: "string" } }, additionalProperties: false },
      requiredAtPublish: ["name"]
    }
  },
  relationTypes: { contains: { from: ["campaign"], to: ["adSet"] } }
});

const engine = createStagedWrite({ definitions: [campaignDefinition] });
const selector = { type: "example.campaign", typeVersion: "1" };
console.log("1. Create an incomplete empty graph:", engine.create(selector));
console.log("2. Missing publish fields are allowed here:", engine.validateValues(selector, "campaign", {}));
console.log("3. Shared money constraint rejects a negative budget:", engine.validateValues(selector, "campaign", { budget: -1 }));
console.log("M1 example: see demo:graph for M2 editing. Graph preflight, publication and persistence remain future work.");
