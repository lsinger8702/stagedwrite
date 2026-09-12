import assert from "node:assert/strict";
import test from "node:test";
import { StagedWrite } from "../src/index.js";
import { StripeTestCustomerAdapter, STRIPE_EXPERIMENT_API_VERSION } from "../src/adapters/stripe-test.js";
import type { StripeTransport } from "../src/adapters/stripe-test.js";
const secretKey = "sk_test_fixture";
const step = { id: "create_test_customer", payload: { description: "Synthetic fixture" } };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const customer = (marker: string) => ({ object: "customer", id: "cus_fixture", livemode: false, metadata: { stagedwrite_attempt: marker } });

test("test adapter pins endpoint/version/key and returns only a matching test customer", async () => {
  let calls = 0;
  const transport: StripeTransport = async (url, init) => {
    calls++; assert.equal(url, "https://api.stripe.com/v1/customers");
    assert.equal(init.method, "POST"); assert.equal(init.redirect, "error");
    const headers = new Headers(init.headers);
    assert.equal(headers.get("Stripe-Version"), STRIPE_EXPERIMENT_API_VERSION);
    assert.equal(headers.get("Idempotency-Key"), "run:step");
    const body = new URLSearchParams(String(init.body));
    assert.equal(body.get("description"), step.payload.description);
    return response(customer(body.get("metadata[stagedwrite_attempt]")!));
  };
  const adapter = new StripeTestCustomerAdapter({ secretKey, transport });
  assert.deepEqual(await adapter.apply(step, "run:step"), { kind: "applied", remoteRef: "cus_fixture" });
  assert.equal((await adapter.apply(step, "run:step")).kind, "applied");
  assert.equal((await adapter.reconcile(step, "run:step")).kind, "applied");
  assert.equal(calls, 1);
});

test("real-shaped response loss and delayed search do not redispatch through engine resume", async () => {
  let marker = "", posts = 0, searches = 0;
  const transport: StripeTransport = async (url, init) => {
    if (init.method === "POST") { posts++; marker = new URLSearchParams(String(init.body)).get("metadata[stagedwrite_attempt]")!; throw new Error("committed then disconnected"); }
    searches++;
    assert.equal(new URL(url).pathname, "/v1/customers/search");
    assert.ok(new URL(url).searchParams.get("query")!.includes(marker));
    return response({ object: "search_result", has_more: false, data: searches === 1 ? [] : [customer(marker)] });
  };
  const engine = new StagedWrite(new StripeTestCustomerAdapter({ secretKey, transport }), []);
  let draft = engine.create(); draft = engine.edit(draft.id, 0, [{ op: "set", path: "/description", value: "fixture" }]);
  const run = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
  assert.equal(run.state, "unknown");
  assert.equal((await engine.resume(run.id)).state, "unknown");
  assert.equal((await engine.resume(run.id)).state, "published");
  assert.equal(posts, 1); assert.equal(searches, 2);
});

test("error HTTP statuses never become unproven retry permissions", async () => {
  for (const status of [400, 401, 409, 429, 500]) {
    let posts = 0;
    const adapter = new StripeTestCustomerAdapter({ secretKey, transport: async () => { posts++; return response({ error: { message: "do not log" } }, status); } });
    assert.equal((await adapter.apply(step, "key")).kind, "unknown");
    assert.equal((await adapter.apply(step, "key")).kind, "unknown");
    assert.equal(posts, 1);
  }
});

test("empty, multiple, paginated, mismatched and live search evidence remains unknown", async () => {
  for (const kind of ["empty", "multiple", "paginated", "mismatched", "live", "error", "invalid-json"]) {
    let marker = "";
    const adapter = new StripeTestCustomerAdapter({ secretKey, transport: async (_url, init) => {
      if (init.method === "POST") { marker = new URLSearchParams(String(init.body)).get("metadata[stagedwrite_attempt]")!; throw new Error("lost"); }
      if (kind === "error") return response({}, 503);
      if (kind === "invalid-json") return new Response("invalid-json");
      const item = kind === "mismatched" ? customer("wrong") : { ...customer(marker), livemode: kind === "live" };
      return response({ object: "search_result", has_more: kind === "paginated", data: kind === "empty" ? [] : kind === "multiple" ? [item, item] : [item] });
    } });
    await adapter.apply(step, "key");
    assert.equal((await adapter.reconcile(step, "key")).kind, "unknown", kind);
  }
});

test("local key/payload safeguards and missing attempt records issue no requests", async () => {
  let calls = 0;
  const transport: StripeTransport = async () => { calls++; throw new Error("network"); };
  for (const key of ["sk_live_fixture", "rk_live_fixture", "", "pk_test_fixture"]) assert.throws(() => new StripeTestCustomerAdapter({ secretKey: key, transport }), /STRIPE_TEST_KEY_REQUIRED/);
  const adapter = new StripeTestCustomerAdapter({ secretKey, transport });
  assert.equal((await adapter.reconcile(step, "key")).kind, "unknown");
  await assert.rejects(adapter.apply(step, "invalid\nkey"), /INVALID_IDEMPOTENCY_KEY/);
  await assert.rejects(adapter.apply({ ...step, payload: { description: "valid", extra: "rejected" } }, "key"), /INVALID_STRIPE_STEP/);
  assert.equal(calls, 0);
  await adapter.apply(step, "key");
  assert.equal((await adapter.apply({ ...step, payload: { description: "changed" } }, "key")).kind, "unknown");
  assert.equal(calls, 1);
});

test("a concurrent call using the same key cannot create another POST", async () => {
  let finish!: (response: Response) => void;
  let calls = 0;
  const adapter = new StripeTestCustomerAdapter({ secretKey, transport: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const pending = adapter.apply(step, "key");
  assert.equal((await adapter.apply(step, "key")).kind, "unknown");
  finish(response({}, 500)); await pending;
  assert.equal(calls, 1);
});

test("invalid success evidence and network failures do not expose raw responses or secrets", async () => {
  for (const transport of [
    async () => response({ ...customer("wrong"), livemode: true }),
    async () => { throw new Error(secretKey); }
  ]) {
    const adapter = new StripeTestCustomerAdapter({ secretKey, transport });
    const outcome = await adapter.apply(step, "key");
    assert.equal(outcome.kind, "unknown");
    assert.equal(JSON.stringify(outcome).includes(secretKey), false);
  }
});

test("planning is pure and rejects unsupported field intent", () => {
  const adapter = new StripeTestCustomerAdapter({ secretKey, transport: async () => { assert.fail("plan made a network call"); } });
  assert.deepEqual(adapter.plan({ id: "draft", version: 1, fields: { description: { kind: "value", value: "Synthetic fixture" } } }), [step]);
  assert.throws(() => adapter.plan({ id: "draft", version: 1, fields: { description: { kind: "clear" } } }), /STRIPE_DESCRIPTION_REQUIRED/);
});
