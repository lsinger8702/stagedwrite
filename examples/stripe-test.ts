import { createStagedWrite, defineDraftType } from "../src/index.js";
import { StripeTestCustomerAdapter } from "../src/adapters/stripe-test.js";
import type { StripeTransport } from "../src/adapters/stripe-test.js";

// Opt-in only. Never run in ordinary CI; never print the key or raw API responses.
const secretKey = process.env.STRIPE_SECRET_KEY;
const accountId = process.env.STRIPE_ACCOUNT_ID;
if (!secretKey || !accountId) {
  console.error("STRIPE_SECRET_KEY and STRIPE_ACCOUNT_ID must be configured. Use a Stripe test key locally; do not paste it into chat or commit it.");
  process.exitCode = 2;
} else {
  const loseResponse = process.argv.includes("--lose-response");
  let postCount = 0, searchCount = 0, accountChecks = 0, responseDiscarded = false;
  const transport: StripeTransport = async (url, init) => {
    if (init.method === "POST") postCount++;
    else if (url.endsWith("/v1/account")) accountChecks++;
    else searchCount++;
    const response = await fetch(url, init);
    if (loseResponse && init.method === "POST" && response.ok && !responseDiscarded) {
      await response.text(); // Real Stripe response received, then deliberately withheld from the adapter.
      responseDiscarded = true;
      throw new Error("Simulated response loss after real Stripe success");
    }
    return response;
  };
  try {
    const adapter = new StripeTestCustomerAdapter({ secretKey, accountId, transport });
    const definition = defineDraftType({ id: "example.stripe-customer", version: "1", nodeTypes: { customer: {
      valueSchema: { type: "object", properties: { description: { type: "string", minLength: 1, maxLength: 500 } }, additionalProperties: false },
      requiredAtPublish: ["description"]
    } }, relationTypes: {} });
    const selector = { type: definition.id, typeVersion: definition.version };
    const engine = createStagedWrite({ definitions: [definition], mode: "executable", executors: [adapter.graphExecutor(selector)] });
    let draft = engine.create(selector);
    draft = engine.edit(draft.id, 0, [{ op: "node.add", id: "customer", nodeType: "customer" },
      { op: "set", nodeId: "customer", path: "/description", value: "StagedWrite disposable test customer" }]);
    const certificate = engine.preflight(draft.id).certificate!;
    let run = await engine.publish(draft.id, certificate);
    console.log("Initial state:", run.state, "simulated response loss:", responseDiscarded);
    for (let n = 0; ["unknown", "blocked"].includes(run.state) && n < 6; n++) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      run = await engine.resume(run.id);
      console.log("Resume (unknown queries; blocked retries a proven refusal):", n + 1, run.state);
    }
    console.log({ state: run.state, remoteRef: run.steps[0]?.remoteRef, postCount, searchCount, accountChecks });
    console.log("Created test customers are retained for inspection in the Stripe test dashboard. No payments were requested.");
    if (run.state !== "published") {
      console.log("Unresolved: inspect the test dashboard; rerunning this demo creates a NEW intent and may create another customer.");
      process.exitCode = 1;
    }
  } catch {
    console.error("Stripe experiment could not complete. Check the test key and local configuration. No secrets or raw errors printed.");
    process.exitCode = 1;
  }
}
