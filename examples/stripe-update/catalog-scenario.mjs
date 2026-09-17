import assert from 'node:assert/strict';
import { selector, initialIntent, catalogRefs } from './catalog-adapter.mjs';
export async function exerciseCatalog({ engine, request, state, trace, save }) {
  const call = async (method, args) => {
    const entry = { phase: state.phase, method, input: args, httpStart: trace.http.length };
    entry.output = await engine[method](...args); entry.httpEnd = trace.http.length;
    trace.steps.push(entry); save(); return entry.output;
  };
  const next = phase => { state.phase = phase; save(); };
  const edit = async (ref, path, value, op = 'set') => {
    const d = await engine.getDraft(state.draftId);
    return call('edit', [d.id, d.version, { patches: [{ op, ref, scope: 'canonical', path, ...(op === 'set' ? { value } : {}) }] }]);
  };
  const posts = () => trace.http.filter(h => h.method === 'POST').length;
  if (!state.draftId) { const r = await call('create', [selector, initialIntent]); state.draftId = r.draft.id; save(); }
  const refs = catalogRefs(await engine.getDraft(state.draftId));
  if (state.phase === 'create') {
    const d = await engine.getDraft(state.draftId);
    const check = d.currentRunId ? null : await call('preflight', [d.id]);
    const result = d.currentRunId ? await call('resume', [d.currentRunId]) : await call('publish', [d.id, check.certificate]);
    assert.equal(result.state, 'published', 'Preserve state directory: initial creation unresolved');
    state.bindings = await engine.getBindings(d.id); next('immutable');
  }
  if (state.phase === 'immutable') {
    if ((await engine.getDraft(state.draftId)).graph.nodes[refs.monthly].fields.amount !== 2000) await edit(refs.monthly, '/amount', 2000);
    const before = posts(), check = await call('preflight', [state.draftId]);
    assert.equal(check.status, 'blocked', JSON.stringify(check.diagnostics)); assert.equal(check.certificate, undefined);
    const diagnostic = check.diagnostics.find(d => d.code === 'STRIPE_PRICE_IMMUTABLE');
    assert.equal(diagnostic?.path, `/nodes/${refs.monthly}/fields/amount`, JSON.stringify(check.diagnostics)); assert.ok(diagnostic.message); assert.ok(diagnostic.hint);
    assert.ok(check.diagnostics.some(d => d.code === 'update.immutable_field'));
    assert.equal(posts(), before); next('reset');
  }
  if (state.phase === 'reset') {
    if ((await engine.getDraft(state.draftId)).graph.nodes[refs.monthly].fields.amount !== 1000) await edit(refs.monthly, '/amount', undefined, 'reset');
    const check = await call('preflight', [state.draftId]), before = posts();
    const result = await call('publish', [state.draftId, check.certificate]);
    assert.equal(result.kind, 'noop'); assert.equal(result.id, null); assert.equal(posts(), before); next('reject');
  }
  if (state.phase === 'reject') {
    const d = await engine.getDraft(state.draftId), current = await engine.getRun(d.currentRunId);
    let result;
    if (current.kind === 'update') {
      // Observe a saved rejection without resending the bad body on process restart.
      result = await call('publish', [d.id, 'observe-current-run']);
    } else {
      if (d.graph.nodes[refs.product].fields.name !== '') await edit(refs.product, '/name', '');
      const check = await call('preflight', [d.id]); assert.equal(check.status, 'passed');
      result = await call('publish', [d.id, check.certificate]);
    }
    assert.equal(result.state, 'blocked', 'Unexpected/unknown update outcome: preserve state and investigate');
    const diagnostic = result.diagnostics.find(d => d.code === 'STRIPE_NAME_INVALID');
    assert.equal(diagnostic?.path, `/nodes/${refs.product}/fields/name`); assert.ok(diagnostic.message); assert.ok(diagnostic.hint);
    state.updateRunId = result.id; next('repair');
  }
  if (state.phase === 'repair') {
    if ((await engine.getDraft(state.draftId)).graph.nodes[refs.product].fields.name !== 'StagedWrite catalog B') await edit(refs.product, '/name', 'StagedWrite catalog B');
    const result = await call('resume', [state.updateRunId]);
    assert.equal(result.id, state.updateRunId); assert.equal(result.state, 'published', 'Preserve state: repaired update unresolved');
    assert.deepEqual(await engine.getBindings(state.draftId), state.bindings);
    assert.ok(result.steps.filter(s => s.id !== 'product').every(s => s.status === 'satisfied'));
    next('verify');
  }
  if (state.phase === 'verify') {
    for (const [role, ref] of Object.entries(refs)) {
      const id = state.bindings[ref].remoteId;
      const r = await request('GET', `/v1/${role === 'product' ? 'products' : 'prices'}/${id}`);
      assert.equal(r.status, 200); assert.equal(r.data.id, id); assert.equal(r.data.livemode, false);
      if (role === 'product') assert.equal(r.data.name, 'StagedWrite catalog B');
      else { assert.equal(r.data.product, state.bindings[refs.product].remoteId); assert.equal(r.data.unit_amount, role === 'monthly' ? 1000 : 10000); }
    }
    const before = trace.http.length;
    assert.equal((await call('resume', [state.updateRunId])).state, 'published');
    assert.equal(trace.http.length, before);
    const creation = trace.steps.find(s => ['publish','resume'].includes(s.method) && s.phase === 'create' && s.output.state === 'published');
    assert.ok(creation);
    assert.equal(trace.http.filter(h => h.method === 'POST' && h.path === '/v1/prices').length, 2);
    assert.equal(trace.http.slice(creation.httpEnd).filter(h => h.method === 'POST' && h.path.startsWith('/v1/prices')).length, 0);
    const writes = trace.http.filter(h => h.method === 'POST' && h.path.startsWith('/v1/products/'));
    assert.deepEqual(writes.map(h => h.status), [400, 200]);
    assert.equal(writes[0].path, writes[1].path); assert.notEqual(writes[0].wireKey, writes[1].wireKey);
    trace.assertions = { sameBindings: true, pricePostsOnlyDuringCreate: true, immutableAmountBlocked: true, resetNoopWithoutWrite: true, actualUpdateRejection: true, repairSameRun: true, repairedKeyChanged: true, finalReadMatchesIntent: true, completedResumeWithoutHttp: true };
    next('done');
  }
  return trace;
}
