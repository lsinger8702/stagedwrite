import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createStagedWrite } from '../../dist/src/index.js';
import { definition, selector, initialIntent } from './schema.mjs';
import { createCatalogExecutor, requestBody } from './adapter.mjs';
import { assertTestKey, requestKey, listAll } from './transport.mjs';
import { publicSummary } from './report.mjs';

const step = { id: 'annual', effect: { kind: 'create', nodeId: 'annual' }, payload: { product: 'prod_test', currency: 'hkd', amount: 10000, interval: 'year' } };
const receipt = (step, key, id = 'price_test') => ({ id, object: 'price', livemode: false, product: step.payload.product,
  currency: step.payload.currency, unit_amount: step.payload.amount, recurring: { interval: step.payload.interval },
  metadata: { experiment: 'test', node: step.id, request_hash: requestKey(key) } });
const create = (request, extra = {}) => createCatalogExecutor({ request, experiment: 'test', target: 'mock:test', ...extra });
const context = { signal: new AbortController().signal };

test('sample refuses live/public/missing keys and requires explicit write opt-in', () => {
  for (const key of [undefined, 'sk_live_' + 'a'.repeat(30), 'pk_test_' + 'a'.repeat(30), 'rk_test_abc\nInjected: value']) assert.throws(() => assertTestKey(key));
  assert.doesNotThrow(() => assertTestKey('rk_test_' + 'a'.repeat(30)));
  const result = spawnSync(process.execPath, ['examples/stripe/run.mjs'], { encoding: 'utf8', env: { ...process.env, STRIPE_SECRET_KEY: '' } });
  assert.equal(result.status, 1); assert.match(result.stdout, /allow-test-writes/);
  assert.match(execFileSync(process.execPath, ['examples/stripe/run.mjs', '--help'], { encoding: 'utf8' }), /Sandbox only/);
});

test('quoted engine keys have stable distinct header-safe wire identities', () => {
  const a = '["run","product",0]', b = '["run","monthly",0]';
  assert.match(requestKey(a), /^[a-f0-9]{64}$/);
  assert.equal(requestKey(a), requestKey(a)); assert.notEqual(requestKey(a), requestKey(b));
  assert.notEqual(requestKey(b), requestKey('["run","monthly",1]'));
  const body = requestBody(step, a, 'test');
  assert.equal(body['metadata[request_hash]'], requestKey(a));
  assert.equal(body['recurring[interval]'], 'year'); assert.equal(body.product, 'prod_test');
});

test('currency refusal produces a graph-path message and optional repair OP', async () => {
  const result = await create(async () => ({ status: 400, data: { error: { type: 'invalid_request_error', param: 'currency', message: 'Invalid currency' } } })).apply(step, 'key', context);
  assert.equal(result.kind, 'not_applied'); assert.equal(result.diagnostics[0].path, '/nodes/annual/fields/currency');
  assert.equal(result.diagnostics[0].candidates[0].repairOps[0].value, 'hkd');
});

test('unclassified failures and inconsistent 200 receipts never prove no effect', async () => {
  for (const result of [
    { status: 500, data: { error: { type: 'api_error' } } },
    { status: 400, data: { error: { type: 'idempotency_error', param: 'currency' } } },
    { status: 200, data: { ...receipt(step, 'key'), livemode: true } },
    { status: 200, data: { ...receipt(step, 'key'), unit_amount: 7 } },
  ]) assert.equal((await create(async () => result).apply(step, 'key', context)).kind, 'unknown');
});

test('reconcile requires unique matching evidence; absent, ambiguous, wrong and incomplete stay unknown', async () => {
  for (const data of [[], [receipt(step, 'other')], [receipt(step, 'key'), receipt(step, 'key', 'price_second')], [{ ...receipt(step, 'key'), currency: 'usd' }]]) {
    const result = await create(async () => ({ status: 200, data: { object: 'list', data, has_more: false } })).reconcile(step, 'key', context);
    assert.equal(result.kind, 'unknown');
  }
  assert.equal((await create(async () => { throw new Error('timeout'); }).reconcile(step, 'key', context)).kind, 'unknown');
  assert.equal((await create(async () => ({ status: 200, data: { object: 'list', data: [receipt(step, 'key')], has_more: false } })).reconcile(step, 'key', context)).kind, 'applied');
});

test('lookup follows pagination and refuses a stalled cursor', async () => {
  const requests = [];
  const data = await listAll(async (_method, _path, params) => {
    requests.push(params);
    return { status: 200, data: { object: 'list', data: [{ id: params.starting_after ? 'second' : 'first' }], has_more: !params.starting_after } };
  }, '/v1/prices', { product: 'prod_test' });
  assert.deepEqual(data.map(x => x.id), ['first', 'second']); assert.equal(requests[1].starting_after, 'first');
  await assert.rejects(listAll(async () => ({ status: 200, data: { object: 'list', data: [{ id: 'same' }], has_more: true } }), '/v1/prices', {}), /pagination/);
});

test('real engine with offline transport repairs and reconciles without duplicate creates', async () => {
  const objects = [], requests = [];
  const request = async (method, path, params, key) => {
    requests.push({ method, path, params, key });
    if (method === 'GET') return { status: 200, data: { object: 'list', data: objects.filter(o => o.object === 'price'), has_more: false } };
    if (params.currency === 'zzz') return { status: 400, data: { error: { type: 'invalid_request_error', param: 'currency', message: 'Invalid currency' } } };
    const metadata = { experiment: params['metadata[experiment]'], node: params['metadata[node]'], request_hash: params['metadata[request_hash]'] };
    const object = path === '/v1/products' ? { id: 'prod_test', object: 'product', name: params.name, livemode: false, metadata }
      : { id: 'price_' + objects.length, object: 'price', product: params.product, currency: params.currency, unit_amount: params.unit_amount, recurring: { interval: params['recurring[interval]'] }, livemode: false, metadata };
    objects.push(object); return { status: 200, data: object };
  };
  const engine = createStagedWrite({ definitions: [definition], executors: [create(request, { loseAnnualReceipt: true })] });
  try {
    const d = await engine.create(selector, initialIntent('test'));
    const check = await engine.preflight(d.id);
    const blocked = await engine.publish(d.id, check.certificate); assert.equal(blocked.state, 'blocked');
    assert.equal(blocked.preview.nodes.monthly.fields["/currency"].value, 'zzz');
    await engine.edit(d.id, d.version, blocked.diagnostics[0].candidates[0].repairOps);
    const unknown = await engine.resume(blocked.id); assert.equal(unknown.state, 'unknown');
    const posts = requests.filter(r => r.method === 'POST').length;
    const done = await engine.resume(blocked.id); assert.equal(done.state, 'published');
    assert.equal(requests.filter(r => r.method === 'POST').length, posts);
    assert.equal(objects.length, 3); assert.equal(Object.keys(await engine.getBindings(d.id)).length, 3);
    const n = requests.length; await engine.publish(d.id, check.certificate); await engine.resume(done.id);
    assert.equal(requests.length, n);
  } finally { await engine.close(); }
});

test('public report excludes raw bodies, remote IDs, local paths and credentials', () => {
  const summary = publicSummary({ runtime: 'v22', sampleSourceDigest: 'hash', finishedAt: 'date',
    secret: 'PRIVATE_SENTINEL', calls: [{ method: 'publish', input: 'PRIVATE_SENTINEL', output: { state: 'blocked', id: 'PRIVATE_SENTINEL' } }],
    http: [{ method: 'POST', path: '/v1/prices', status: 400, params: 'PRIVATE_SENTINEL', data: { error: { type: 'invalid_request_error', param: 'currency', message: 'PRIVATE_SENTINEL' } } }],
    assertions: { passed: true, private: 'PRIVATE_SENTINEL' } });
  assert.ok(!JSON.stringify(summary).includes('PRIVATE_SENTINEL'));
  assert.throws(() => publicSummary({ assertions: { passed: false } }));
});


test('existing state cannot silently start a second Draft', () => {
  const directory = mkdtempSync(join(tmpdir(), 'stripe-example-'));
  try {
    const result = spawnSync(process.execPath, ['examples/stripe/run.mjs', '--allow-test-writes', '--state-dir=' + directory], {
      encoding: 'utf8', env: { ...process.env, STRIPE_SECRET_KEY: 'rk_test_' + 'a'.repeat(30), STRIPE_SANDBOX_ACCOUNT: 'acct_example' },
    });
    assert.equal(result.status, 1); assert.match(result.stderr, /existing runs require --resume/);
  } finally { rmSync(directory, { recursive: true }); }
});
