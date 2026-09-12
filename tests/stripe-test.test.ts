import assert from "node:assert/strict";
import test from "node:test";
import { StagedWrite } from "../src/index.js";
import { StripeTestCustomerAdapter, STRIPE_EXPERIMENT_API_VERSION } from "../src/adapters/stripe-test.js";
import type { StripeTransport } from "../src/adapters/stripe-test.js";
const secretKey = "sk_test_fixture";
const contexts = new Map<string, string>();
const step = { id: "create_test_customer", payload: { description: "Synthetic fixture" } };
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status });
const customer = (marker: string) => ({ object: "customer", id: "cus_fixture", livemode: false, metadata: { stagedwrite_attempt: marker, stagedwrite_context: contexts.get(marker) } });

function makeAdapter(options: { secretKey: string; transport: StripeTransport }) {
  return new StripeTestCustomerAdapter({ ...options, accountId: "acct_fixture", transport: async (url, init) => {
    if (url === "https://api.stripe.com/v1/account") return response({ object: "account", id: "acct_fixture" });
    if (init.method === "POST") {
      const body = new URLSearchParams(String(init.body));
      contexts.set(body.get("metadata[stagedwrite_attempt]")!, body.get("metadata[stagedwrite_context]")!);
    }
    return options.transport(url, init);
  } });
}

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
  const adapter = makeAdapter({ secretKey, transport });
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
  const engine = new StagedWrite(makeAdapter({ secretKey, transport }), []);
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
    const adapter = makeAdapter({ secretKey, transport: async () => { posts++; return response({ error: { message: "do not log" } }, status); } });
    assert.equal((await adapter.apply(step, "key")).kind, "unknown");
    assert.equal((await adapter.apply(step, "key")).kind, "unknown");
    assert.equal(posts, 1);
  }
});

test("empty, multiple, paginated, mismatched and live search evidence remains unknown", async () => {
  for (const kind of ["empty", "multiple", "paginated", "mismatched", "live", "error", "invalid-json"]) {
    let marker = "";
    const adapter = makeAdapter({ secretKey, transport: async (_url, init) => {
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

test("invalid local keys/payloads issue no requests; missing attempt records can search", async () => {
  let calls = 0;
  const transport: StripeTransport = async () => { calls++; throw new Error("network"); };
  for (const key of ["sk_live_fixture", "rk_live_fixture", "", "pk_test_fixture"]) assert.throws(() => makeAdapter({ secretKey: key, transport }), /STRIPE_TEST_KEY_REQUIRED/);
  const adapter = makeAdapter({ secretKey, transport });
  await assert.rejects(adapter.apply(step, "invalid\nkey"), /INVALID_IDEMPOTENCY_KEY/);
  await assert.rejects(adapter.apply({ ...step, payload: { description: "valid", extra: "rejected" } }, "key"), /INVALID_STRIPE_STEP/);
  assert.equal(calls, 0);
  assert.equal((await adapter.reconcile(step, "key")).kind, "unknown");
  assert.equal(calls, 1);
  calls = 0;
  await adapter.apply(step, "key");
  assert.equal((await adapter.apply({ ...step, payload: { description: "changed" } }, "key")).kind, "unknown");
  assert.equal(calls, 1);
});

test("a concurrent call using the same key cannot create another POST", async () => {
  let finish!: (response: Response) => void;
  let calls = 0;
  const adapter = makeAdapter({ secretKey, transport: async () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const pending = adapter.apply(step, "key");
  assert.equal((await adapter.apply(step, "key")).kind, "unknown");
  await new Promise(resolve => setImmediate(resolve));
  finish(response({}, 500)); await pending;
  assert.equal(calls, 1);
});

test("invalid success evidence and network failures do not expose raw responses or secrets", async () => {
  for (const transport of [
    async () => response({ ...customer("wrong"), livemode: true }),
    async () => { throw new Error(secretKey); }
  ]) {
    const adapter = makeAdapter({ secretKey, transport });
    const outcome = await adapter.apply(step, "key");
    assert.equal(outcome.kind, "unknown");
    assert.equal(JSON.stringify(outcome).includes(secretKey), false);
  }
});

test("planning is pure and rejects unsupported field intent", () => {
  const adapter = makeAdapter({ secretKey, transport: async () => { assert.fail("plan made a network call"); } });
  assert.deepEqual(adapter.plan({ id: "draft", version: 1, fields: { description: { kind: "value", value: "Synthetic fixture" } } }), [step]);
  assert.throws(() => adapter.plan({ id: "draft", version: 1, fields: { description: { kind: "clear" } } }), /STRIPE_DESCRIPTION_REQUIRED/);
});

test("proven limiter refusal actually retries through graph publish and resume", async () => {
  const { createStagedWrite, defineDraftType } = await import("../src/index.js");
  let posts = 0, searches = 0;
  const keys: string[] = [];
  const adapter = makeAdapter({ secretKey, transport: async (_url, init) => {
    if (init.method !== "POST") { searches++; return response({}); }
    posts++; keys.push(new Headers(init.headers).get("Idempotency-Key")!);
    if (posts === 1) return new Response(JSON.stringify({ error: { type: "invalid_request_error" } }), { status: 429, headers: { "Stripe-Rate-Limited-Reason": "endpoint-rate" } });
    const body = new URLSearchParams(String(init.body));
    return response(customer(body.get("metadata[stagedwrite_attempt]")!));
  } });
  const definition = defineDraftType({ id: "stripe.customer", version: "1", nodeTypes: { customer: {
    valueSchema: { type: "object", properties: { description: { type: "string" } }, additionalProperties: false }, requiredAtPublish: ["description"]
  } }, relationTypes: {} });
  const selector = { type: definition.id, typeVersion: definition.version };
  const engine = createStagedWrite({ definitions: [definition], mode: "executable", executors: [adapter.graphExecutor(selector)] });
  let draft = engine.create(selector);
  draft = engine.edit(draft.id, 0, [{ op: "node.add", id: "customer", nodeType: "customer" }, { op: "set", nodeId: "customer", path: "/description", value: "fixture" }]);
  const run = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
  assert.equal(run.state, "blocked");
  const done = await engine.resume(run.id);
  assert.equal(done.state, "published"); assert.equal(posts, 2); assert.equal(searches, 0); assert.equal(keys[0], keys[1]);
});

test("typed parameter refusal is terminal without search; ambiguity stays unknown", async () => {
  let calls = 0;
  const adapter = makeAdapter({ secretKey, transport: async () => { calls++; return response({ error: { type: "invalid_request_error", code: "parameter_invalid_integer" } }, 400); } });
  const engine = new StagedWrite(adapter, []);
  let draft = engine.create(); draft = engine.edit(draft.id, 0, [{ op: "set", path: "/description", value: "fixture" }]);
  const run = await engine.publish(draft.id, engine.preflight(draft.id).certificate!);
  assert.equal(run.state, "failed"); assert.equal((await engine.resume(run.id)).state, "failed"); assert.equal(calls, 1);
  assert.equal((await adapter.apply(run.steps[0]!, run.steps[0]!.key)).kind, "not_applied"); assert.equal(calls, 1);
  for (const [status, type, code] of [[409, "invalid_request_error", "idempotency_key_in_use"], [500, "api_error", ""], [400, "idempotency_error", ""], [429, "invalid_request_error", "lock_timeout"]] as const) {
    const a = makeAdapter({ secretKey, transport: async () => response({ error: { type, code } }, status) });
    assert.equal((await a.apply(step, "key")).kind, "unknown");
  }
});

test("fresh adapter recovers without local attempts but rejects changed request context", async () => {
  let remote: unknown;
  const first = makeAdapter({ secretKey, transport: async (_url, init) => {
    const body = new URLSearchParams(String(init.body));
    remote = customer(body.get("metadata[stagedwrite_attempt]")!); throw new Error("committed then lost");
  } });
  await first.apply(step, "recover-key");
  let searches = 0;
  const transport: StripeTransport = async (_url, init) => { assert.equal(init.method, "GET"); searches++; return response({ object: "search_result", has_more: false, data: [remote] }); };
  const fresh = makeAdapter({ secretKey, transport });
  assert.equal((await fresh.reconcile(step, "recover-key")).kind, "applied");
  assert.equal((await fresh.reconcile(step, "recover-key")).kind, "applied"); assert.equal(searches, 1);
  const changed = makeAdapter({ secretKey, transport });
  assert.equal((await changed.reconcile({ ...step, payload: { description: "different" } }, "recover-key")).kind, "unknown");
});

test("account mismatch cannot dispatch or claim a recovered customer", async () => {
  let creates = 0;
  const adapter = new StripeTestCustomerAdapter({ secretKey, accountId: "acct_expected", transport: async (url) => {
    if (url !== "https://api.stripe.com/v1/account") creates++;
    return response({ object: "account", id: "acct_other" });
  } });
  const refusal = await adapter.apply(step, "key");
  assert.equal(refusal.kind, "not_applied");
  assert.equal((await adapter.reconcile(step, "key")).kind, "unknown"); assert.equal(creates, 0);
});
