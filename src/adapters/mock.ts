import type { Adapter, Draft, Outcome, ReconcileOutcome, Rule, Step } from "../types.js";

/** Teaching fixture only: these prices and controls do not describe Stripe. */
export const subscriptionRule: Rule = draft => {
  const seats = draft.fields.seats;
  if (seats?.kind !== "value" || typeof seats.value !== "number" || !Number.isSafeInteger(seats.value) || seats.value < 1) {
    return [{ code: "seats.required", path: "/seats", message: "Specify a positive integer seat count.",
      resolution: { kind: "blocked", reason: "human_intent" } }];
  }
  if (draft.fields.timing?.kind !== "value" || !["now", "next_cycle"].includes(String(draft.fields.timing.value))) {
    return [{ code: "timing.required", path: "/timing", message: "Choose when the change takes effect.",
      resolution: { kind: "blocked", reason: "human_intent" } }];
  }
  if (draft.fields.timing.value === "now" && seats.value * 50 > 1000) {
    return [{ code: "policy.immediate_limit", path: "/timing",
      message: "Mock immediate charge exceeds the configured $1,000 limit. Deferral requires user agreement.",
      resolution: { kind: "ops", ops: [{ op: "set", path: "/timing", value: "next_cycle" }] } }];
  }
  return [];
};

export class MockAdapter implements Adapter {
  private effects = new Map<string, string>();
  applyCalls = 0;
  constructor(private readonly mode: "normal" | "commit_then_timeout" | "unresolved" = "commit_then_timeout") {}
  get effectCount(): number { return this.effects.size; }
  plan(draft: Draft): Step[] {
    return [
      { id: "change_subscription", payload: { seats: draft.fields.seats?.kind === "value" ? draft.fields.seats.value : null } },
      { id: "record_change", payload: { timing: draft.fields.timing?.kind === "value" ? draft.fields.timing.value : null } }
    ];
  }
  async apply(step: Step, key: string): Promise<Outcome> {
    this.applyCalls++;
    const previous = this.effects.get(key);
    if (previous) return { kind: "applied", remoteRef: previous };
    if (this.mode === "unresolved") return { kind: "unknown", reason: "No authoritative evidence" };
    const remoteRef = `mock_${this.effects.size + 1}`;
    this.effects.set(key, remoteRef);
    if (this.mode === "commit_then_timeout" && step.id === "record_change") throw new Error("Simulated lost response");
    return { kind: "applied", remoteRef };
  }
  async reconcile(_step: Step, key: string): Promise<ReconcileOutcome> {
    const remoteRef = this.effects.get(key);
    // This fake remote is synchronous and authoritative; real APIs need stronger evidence.
    return remoteRef ? { kind: "applied", remoteRef } : { kind: "unknown", reason: "Unresolved" };
  }
}
