import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { catalogExecutor } from './catalog-adapter.mjs';
test('catalog public lifecycle blocks immutable amounts and repairs update without recreating Prices', () => {
  const output = execFileSync(process.execPath, ['examples/stripe-update/catalog-run.mjs','--offline'], { encoding: 'utf8', timeout: 15000, stdio: ['ignore','pipe','pipe'] });
  const result = JSON.parse(output);
  assert.equal(result.mode, 'Offline mock catalog'); assert.equal(result.phase, 'done');
  assert.equal(Object.keys(result.assertions).length, 9); assert.ok(Object.values(result.assertions).every(v => v === true));
});
test('catalog classifies only the exact Product name validation refusal as not_applied', async () => {
  const step = { id: 'product', payload: { name: '' }, effect: { kind: 'update', nodeId: 'node', remoteId: 'prod_test' } };
  for (const [status, type, param, expected] of [[400,'invalid_request_error','name','not_applied'],[400,'idempotency_error','name','unknown'],[500,'api_error','name','unknown'],[400,'invalid_request_error','other','unknown']]) {
    const e = catalogExecutor({ target: 'mock', request: async () => ({ status, data: { error: { type, param, message: 'Name is invalid' } } }), receiptStore: { set: () => assert.fail('no success to journal') } });
    const result = await e.apply(step, 'key', {}); assert.equal(result.kind, expected);
    if (expected === 'not_applied') { assert.equal(result.diagnostics[0].path, '/nodes/node/fields/name'); assert.ok(result.diagnostics[0].message); assert.ok(result.diagnostics[0].hint); }
  }
});
test('catalog refuses Price update dispatch and mismatched successful receipts', async () => {
  const e = catalogExecutor({ target: 'mock', request: () => assert.fail('must not dispatch'), receiptStore: {} });
  await assert.rejects(e.apply({ id: 'monthly', effect: { kind: 'update' } }, 'key', {}), /creation-only/);
  const step = { id: 'product', payload: { name: 'B' }, effect: { kind: 'update', nodeId: 'node', remoteId: 'prod_test' } };
  for (const change of [{ id: 'prod_other' }, { name: 'C' }, { livemode: true }]) {
    const adapter = catalogExecutor({ target: 'mock', request: async () => ({ status: 200, data: { object: 'product', id: 'prod_test', name: 'B', livemode: false, ...change } }), receiptStore: { set: () => assert.fail('must not save mismatched receipt') } });
    assert.equal((await adapter.apply(step, 'key', {})).kind, 'unknown');
  }
});
