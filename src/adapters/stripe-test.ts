import { createHash } from "node:crypto";
import type { Adapter, ApplyOutcome, Draft, ReconcileOutcome, Step } from "../types.js";

export type StripeTransport = (url: string, init: RequestInit) => Promise<Response>;
export const STRIPE_EXPERIMENT_API_VERSION = "2026-08-26.dahlia";
interface Attempt { body: string; marker: string; remoteRef?: string }
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);

/** Narrow test-mode experiment on the existing execution prototype, not graph publication.
 * Never retries an ambiguous POST or infers no_effect from customer search results. */
export class StripeTestCustomerAdapter implements Adapter {
  #secretKey: string;
  #transport: StripeTransport;
  #timeoutMs: number;
  #attempts = new Map<string, Attempt>();
  constructor(options: { secretKey: string; transport?: StripeTransport; timeoutMs?: number }) {
    if (typeof options.secretKey !== "string" || !/^(sk|rk)_test_[A-Za-z0-9]+$/.test(options.secretKey)) throw new Error("STRIPE_TEST_KEY_REQUIRED");
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
  #body(step: Step, key: string): { body: string; marker: string } {
    if (typeof key !== "string" || !/^[\x21-\x7e]{1,255}$/.test(key)) throw new Error("INVALID_IDEMPOTENCY_KEY");
    if (step.id !== "create_test_customer" || !object(step.payload) || Object.keys(step.payload).length !== 1 ||
        typeof step.payload.description !== "string" || !step.payload.description.trim() || step.payload.description.length > 500) throw new Error("INVALID_STRIPE_STEP");
    const marker = createHash("sha256").update(key).digest("hex");
    return { marker, body: new URLSearchParams({ description: step.payload.description, "metadata[stagedwrite_attempt]": marker }).toString() };
  }
  #request(url: string, method: "POST" | "GET", key?: string, body?: string): Promise<Response> {
    return this.#transport(url, {
      method, redirect: "error", signal: AbortSignal.timeout(this.#timeoutMs),
      headers: { Authorization: `Bearer ${this.#secretKey}`, "Stripe-Version": STRIPE_EXPERIMENT_API_VERSION,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": key! } : {}) },
      ...(body === undefined ? {} : { body })
    });
  }
  #customer(value: unknown, marker: string): string | undefined {
    return object(value) && value.object === "customer" && value.livemode === false &&
      typeof value.id === "string" && /^cus_[A-Za-z0-9]+$/.test(value.id) && object(value.metadata) &&
      value.metadata.stagedwrite_attempt === marker ? value.id : undefined;
  }
  async apply(step: Step, key: string): Promise<ApplyOutcome> {
    const request = this.#body(step, key);
    const existing = this.#attempts.get(key);
    if (existing) {
      if (existing.body !== request.body) return { kind: "unknown", reason: "Idempotency key payload mismatch" };
      return existing.remoteRef ? { kind: "applied", remoteRef: existing.remoteRef } : { kind: "unknown", reason: "An earlier dispatch is unresolved; use reconciliation" };
    }
    // Record dispatch intent before awaiting network; same-instance calls cannot race a second POST.
    const attempt: Attempt = { ...request };
    this.#attempts.set(key, attempt);
    try {
      const response = await this.#request("https://api.stripe.com/v1/customers", "POST", key, request.body);
      if (!response.ok) return { kind: "unknown", reason: `Stripe create returned HTTP ${response.status}; no no-effect claim` };
      const remoteRef = this.#customer(await response.json(), attempt.marker);
      if (!remoteRef) return { kind: "unknown", reason: "Stripe response did not establish a matching test customer" };
      attempt.remoteRef = remoteRef;
      return { kind: "applied", remoteRef };
    } catch { return { kind: "unknown", reason: "Stripe create response unavailable" }; }
  }
  async reconcile(step: Step, key: string): Promise<ReconcileOutcome> {
    const request = this.#body(step, key);
    const attempt = this.#attempts.get(key);
    if (!attempt || attempt.body !== request.body) return { kind: "unknown", reason: "Matching in-memory dispatch record is unavailable" };
    if (attempt.remoteRef) return { kind: "applied", remoteRef: attempt.remoteRef };
    const query = new URLSearchParams({ query: `metadata['stagedwrite_attempt']:'${attempt.marker}'`, limit: "100" });
    try {
      const response = await this.#request(`https://api.stripe.com/v1/customers/search?${query}`, "GET");
      if (!response.ok) return { kind: "unknown", reason: `Stripe search returned HTTP ${response.status}` };
      const result: unknown = await response.json();
      if (!object(result) || result.object !== "search_result" || result.has_more !== false || !Array.isArray(result.data) || result.data.length !== 1) {
        return { kind: "unknown", reason: "Search is empty, ambiguous or incomplete; absence is not no-effect evidence" };
      }
      const remoteRef = this.#customer(result.data[0], attempt.marker);
      if (!remoteRef) return { kind: "unknown", reason: "Search result did not establish matching test-customer identity" };
      attempt.remoteRef = remoteRef;
      return { kind: "applied", remoteRef };
    } catch { return { kind: "unknown", reason: "Stripe search evidence unavailable" }; }
  }
}
