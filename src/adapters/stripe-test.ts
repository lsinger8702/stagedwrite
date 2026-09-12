import { createHash } from "node:crypto";
import type { Adapter, ApplyOutcome, Draft, ReconcileOutcome, Step } from "../types.js";

export type StripeTransport = (url: string, init: RequestInit) => Promise<Response>;
export const STRIPE_EXPERIMENT_API_VERSION = "2026-08-26.dahlia";
const executorVersion = "2";
interface Attempt { body: string; marker: string; context: string; remoteRef?: string; refusal?: Extract<ApplyOutcome, { kind: "not_applied" }> }
const rateReasons = new Set(["global-rate", "endpoint-rate", "global-concurrency", "endpoint-concurrency", "resource-specific"]);
function refusal(response: Response, body: unknown): Attempt["refusal"] {
  const error = object(body) && object(body.error) ? body.error : undefined;
  // Stripe's raw error.type is not the same as the SDK error class name.
  if (response.status === 429 && error?.type === "invalid_request_error" && error.code !== "lock_timeout" &&
      rateReasons.has(response.headers.get("Stripe-Rate-Limited-Reason") ?? "")) {
    return { kind: "not_applied", retryable: true, reason: "Stripe rate limiter refused this customer create before execution" };
  }
  if ([400, 401, 403].includes(response.status) && error?.type === "invalid_request_error" &&
      error.code !== "idempotency_key_in_use") {
    return { kind: "not_applied", retryable: false, reason: `Stripe rejected this customer create (HTTP ${response.status})` };
  }
  return undefined;
}
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Test Customer adapter for graph execution; legacy scalar planning remains available.
 * Never retries an ambiguous POST or infers no_effect from customer search results. */
export class StripeTestCustomerAdapter implements Adapter {
  #secretKey: string;
  #accountId: string;
  #accountVerified?: Promise<boolean>;
  #transport: StripeTransport;
  #timeoutMs: number;
  #attempts = new Map<string, Attempt>();
  constructor(options: { accountId: string; secretKey: string; transport?: StripeTransport; timeoutMs?: number }) {
    if (typeof options.secretKey !== "string" || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(options.secretKey)) throw new Error("STRIPE_TEST_KEY_REQUIRED");
    if (!/^acct_[A-Za-z0-9]+$/.test(options.accountId)) throw new Error("STRIPE_ACCOUNT_REQUIRED");
    this.#accountId = options.accountId;
    const timeoutMs = options.timeoutMs ?? 10000;
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw new Error("INVALID_TIMEOUT");
    this.#secretKey = options.secretKey;
    this.#transport = options.transport ?? ((url, init) => fetch(url, init));
    this.#timeoutMs = timeoutMs;
  }
  plan(draft: Draft): Step[] {
    if (Object.keys(draft.fields).some(k => k !== "description")) throw new Error("UNSUPPORTED_STRIPE_FIELD");
    const description = draft.fields.description;
    if (description?.kind !== "value" || typeof description.value !== "string" || !description.value.trim() || description.value.length > 500) throw new Error("STRIPE_DESCRIPTION_REQUIRED");
    return [{ id: "create_test_customer", payload: { description: description.value } }];
  }
  #body(step: Step, key: string): Pick<Attempt, "body" | "marker" | "context"> {
    if (typeof key !== "string" || !/^[\x21-\x7e]{1,255}$/.test(key)) throw new Error("INVALID_IDEMPOTENCY_KEY");
    if (step.id !== "create_test_customer" || !object(step.payload) || Object.keys(step.payload).length !== 1 ||
        typeof step.payload.description !== "string" || !step.payload.description.trim() || step.payload.description.length > 500) throw new Error("INVALID_STRIPE_STEP");
    const marker = createHash("sha256").update(key).digest("hex");
    const context = createHash("sha256").update(JSON.stringify([this.#accountId, executorVersion, STRIPE_EXPERIMENT_API_VERSION, step.id, step.payload.description])).digest("hex");
    return { marker, context, body: new URLSearchParams({ description: step.payload.description,
      "metadata[stagedwrite_attempt]": marker, "metadata[stagedwrite_context]": context }).toString() };
  }
  #request(url: string, method: "POST" | "GET", key?: string, body?: string): Promise<Response> {
    return this.#transport(url, {
      method, redirect: "error", signal: AbortSignal.timeout(this.#timeoutMs),
      headers: { Authorization: `Bearer ${this.#secretKey}`, "Stripe-Version": STRIPE_EXPERIMENT_API_VERSION,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": key! } : {}) },
      ...(body === undefined ? {} : { body })
    });
  }
  async #verifyAccount(): Promise<boolean> {
    if (!this.#accountVerified) this.#accountVerified = (async () => {
      try {
        const response = await this.#request("https://api.stripe.com/v1/account", "GET");
        const account: unknown = await response.json();
        return response.ok && object(account) && account.object === "account" && account.id === this.#accountId;
      } catch { return false; }
    })();
    const verified = await this.#accountVerified;
    if (!verified) this.#accountVerified = undefined;
    return verified;
  }
  get target(): string { return `stripe:test:${this.#accountId}`; }
  graphExecutor(selector: import("../registry/types.js").DefinitionSelector): import("../execution/graph.js").GraphExecutor {
    return { ...selector, id: "stripe.test-customer", version: executorVersion, target: this.target,
      plan: draft => {
        const nodes = Object.values(draft.nodes);
        if (nodes.length !== 1 || nodes[0]!.nodeType !== "customer" || Object.keys(draft.edges).length) throw new Error("UNSUPPORTED_STRIPE_GRAPH");
        return this.plan({ id: draft.id, version: draft.version, fields: nodes[0]!.fields });
      },
      apply: (step, key) => this.apply(step, key), reconcile: (step, key) => this.reconcile(step, key)
    };
  }
  #customer(value: unknown, marker: string, context: string): string | undefined {
    return object(value) && value.object === "customer" && value.livemode === false &&
      typeof value.id === "string" && /^cus_[A-Za-z0-9]+$/.test(value.id) && object(value.metadata) &&
      value.metadata.stagedwrite_attempt === marker && value.metadata.stagedwrite_context === context ? value.id : undefined;
  }
  async apply(step: Step, key: string): Promise<ApplyOutcome> {
    const request = this.#body(step, key);
    const existing = this.#attempts.get(key);
    if (existing) {
      if (existing.body !== request.body) return { kind: "unknown", reason: "Idempotency key payload mismatch" };
      if (existing.refusal && !existing.refusal.retryable) return { ...existing.refusal };
      if (!existing.refusal?.retryable) return existing.remoteRef ? { kind: "applied", remoteRef: existing.remoteRef } : { kind: "unknown", reason: "An earlier dispatch is unresolved; use reconciliation" };
    }
    // Record dispatch intent before awaiting network; same-instance calls cannot race a second POST.
    const attempt: Attempt = { ...request };
    this.#attempts.set(key, attempt);
    try {
      if (!await this.#verifyAccount()) {
        attempt.refusal = { kind: "not_applied", retryable: true, reason: "Account verification failed before any customer dispatch" };
        return { ...attempt.refusal };
      }
      const response = await this.#request("https://api.stripe.com/v1/customers", "POST", key, request.body);
      if (!response.ok) {
        const rejected = refusal(response, await response.json().catch(() => undefined));
        if (rejected) { attempt.refusal = rejected; return { ...rejected }; }
        return { kind: "unknown", reason: `Stripe create returned HTTP ${response.status}; no no-effect claim` };
      }
      const remoteRef = this.#customer(await response.json(), attempt.marker, attempt.context);
      if (!remoteRef) return { kind: "unknown", reason: "Stripe response did not establish a matching test customer" };
      attempt.remoteRef = remoteRef;
      return { kind: "applied", remoteRef };
    } catch { return { kind: "unknown", reason: "Stripe create response unavailable" }; }
  }
  async reconcile(step: Step, key: string): Promise<ReconcileOutcome> {
    const request = this.#body(step, key);
    const attempt = this.#attempts.get(key);
    if (attempt && attempt.body !== request.body) return { kind: "unknown", reason: "Idempotency key payload mismatch" };
    if (attempt?.remoteRef) return { kind: "applied", remoteRef: attempt.remoteRef };
    const query = new URLSearchParams({ query: `metadata['stagedwrite_attempt']:'${request.marker}'`, limit: "100" });
    try {
      if (!await this.#verifyAccount()) return { kind: "unknown", reason: "Matching Stripe account could not be verified" };
      const response = await this.#request(`https://api.stripe.com/v1/customers/search?${query}`, "GET");
      if (!response.ok) return { kind: "unknown", reason: `Stripe search returned HTTP ${response.status}` };
      const result: unknown = await response.json();
      if (!object(result) || result.object !== "search_result" || result.has_more !== false || !Array.isArray(result.data) || result.data.length !== 1) {
        return { kind: "unknown", reason: "Search is empty, ambiguous or incomplete; absence is not no-effect evidence" };
      }
      const remoteRef = this.#customer(result.data[0], request.marker, request.context);
      if (!remoteRef) return { kind: "unknown", reason: "Search result did not establish matching test-customer identity" };
      this.#attempts.set(key, { ...request, remoteRef });
      return { kind: "applied", remoteRef };
    } catch { return { kind: "unknown", reason: "Stripe search evidence unavailable" }; }
  }
}
