import { StagedWrite } from "../src/index.js";
import { StripeTestCustomerAdapter } from "../src/adapters/stripe-test.js";
import type { StripeTransport } from "../src/adapters/stripe-test.js";

// Opt-in only. Never run in ordinary CI; never print the key or raw API responses.
const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error("STRIPE_SECRET_KEY is not configured. Use a Stripe test key locally; do not paste it into chat or commit it.");
  process.exitCode = 2;
} else {
  const loseResponse = process.argv.includes("--lose-response");
  let postCount = 0, searchCount = 0, responseDiscarded = false;
  const transport: StripeTransport = async (url, init) => {
    if (init.method === "POST") postCount++; else searchCount++;
    const response = await fetch(url, init);
    if (loseResponse && init.method === "POST" && response.ok && !responseDiscarded) {
      await response.text(); // Real Stripe response received, then deliberately withheld from the adapter.
      responseDiscarded = true;
      throw new Error("Simulated response loss after real Stripe success");
    }
    return response;
  };
  try {
    const engine = new StagedWrite(new StripeTestCustomerAdapter({ secretKey, transport }), []);
    let draft = engine.create();
    draft = engine.edit(draft.id, 0, [{ op: "set", path: "/description", value: "StagedWrite disposable test customer" }]);
    const certificate = engine.preflight(draft.id).certificate!;
    let run = await engine.publish(draft.id, certificate);
    console.log("Initial state:", run.state, "simulated response loss:", responseDiscarded);
    for (let n = 0; run.state === "unknown" && n < 6; n++) {
      await new Promise(resolve => setTimeout(resolve, 10000));
      run = await engine.resume(run.id);
      console.log("Read-only reconciliation:", n + 1, run.state);
    }
    console.log({ state: run.state, remoteRef: run.steps[0]?.remoteRef, postCount, searchCount });
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
