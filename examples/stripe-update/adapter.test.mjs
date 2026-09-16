import test from 'node:test';
import assert from 'node:assert/strict';
import { productExecutor } from './adapter.mjs';
test('Product update loss reconciles only a durable exact request receipt', async () => {
  const journal = new Map(); let calls = 0;
  const e = productExecutor({ target: 'test', request: async () => { calls++; return { status: 200, data: { object: 'product', id: 'prod_test', name: 'B', livemode: false } }; }, receiptStore: { get: k => journal.get(k), set: (k, v) => journal.set(k, v) }, loseUpdateReceipt: () => true });
  const step = { id: 'node', payload: { name: 'B' }, effect: { kind: 'update', nodeId: 'node', remoteId: 'prod_test' } };
  assert.equal((await e.apply(step, 'same-key', {})).kind, 'unknown');
  assert.equal((await e.reconcile(step, 'same-key')).kind, 'applied');
  assert.equal(calls, 1);
  assert.equal((await e.reconcile({ ...step, payload: { name: 'C' } }, 'same-key')).kind, 'unknown');
  assert.equal((await e.reconcile(step, 'missing')).kind, 'unknown');
});
test('Product update never guesses success from a malformed or live response', async () => {
  for (const data of [{ object: 'product', id: 'prod_test', name: 'B', livemode: true }, { object: 'product', id: 'prod_test', livemode: false }]) {
    const e = productExecutor({ target: 'test', request: async () => ({ status: 200, data }), receiptStore: { set: () => assert.fail('must not save success'), get: () => null } });
    assert.equal((await e.apply({ payload: { name: 'B' }, effect: { kind: 'update', remoteId: 'prod_test' } }, 'key', {})).kind, 'unknown');
  }
});
