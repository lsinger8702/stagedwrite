import assert from "node:assert/strict";
import test from "node:test";
import { StagedWrite } from "../src/index.js";
import type { ApplyOutcome } from "../src/index.js";
test("failure source points to the exact remote, manual or stop event", async () => {
  for (const mode of ["remote_refusal", "manual_no_effect", "retry_stopped"] as const) {
    const engine = new StagedWrite({ plan: () => [{ id: "one", payload: {} }],
      apply: async (): Promise<ApplyOutcome> => mode === "manual_no_effect" ? { kind: "unknown", reason: "lost" } : { kind: "not_applied", reason: "refused", retryable: mode === "retry_stopped" },
      reconcile: async () => ({ kind: "unknown", reason: "no lookup" }) }, []);
    const d = engine.create(); let run = await engine.publish(d.id, engine.preflight(d.id).certificate!);
    if (mode === "manual_no_effect") run = engine.adjudicate(run.id, "one", { requestId: "manual", expectedSequence: run.events.length, actor: "operator", evidence: "receipt", note: "Verified no effect", decision: { kind: "no_effect", next: "stop" } });
    if (mode === "retry_stopped") run = engine.stopRetry(run.id, { requestId: "stop", expectedSequence: run.events.length, actor: "operator", reason: "budget" });
    const step = run.steps[0]!; assert.equal(step.failureReason, mode);
    assert.equal(run.events[step.failureEventSequence! - 1]?.kind, mode === "remote_refusal" ? "not_applied" : mode === "manual_no_effect" ? "adjudicated" : "retry_stopped");
  }
});
