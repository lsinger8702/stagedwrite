import assert from "node:assert/strict";
import { StagedWrite } from "../src/index.js";
import { MockAdapter, subscriptionRule } from "../src/adapters/mock.js";

const remote = new MockAdapter();
const engine = new StagedWrite(remote, [subscriptionRule]);
let draft = engine.create();
draft = engine.edit(draft.id, draft.version, [
  { op: "set", path: "/seats", value: 200 },
  { op: "set", path: "/timing", value: "now" }
]);
let check = engine.preflight(draft.id);
console.log("1. Preflight blocks:", check.diagnostics[0]?.message);
const repair = check.diagnostics[0]?.resolution;
assert.equal(repair?.kind, "ops");
if (repair?.kind !== "ops") throw new Error("Expected repair");
console.log("2. Demo user explicitly chooses deferral; apply suggested ops.");
draft = engine.edit(draft.id, draft.version, repair.ops);
check = engine.preflight(draft.id);
assert.ok(check.certificate);
let run = await engine.publish(draft.id, check.certificate);
assert.equal(run.state, "unknown");
console.log("3. Remote committed, response lost:", run.state, "effects:", remote.effectCount);
run = await engine.resume(run.id);
assert.equal(run.state, "published");
assert.equal(remote.effectCount, 2);
assert.equal(remote.applyCalls, 2);
console.log("4. Reconciled:", run.state, "effects:", remote.effectCount, "apply calls:", remote.applyCalls);
console.table(run.events);
console.log("In-memory simulation only. No real payment and no process-restart recovery.");
