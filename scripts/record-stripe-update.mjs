// Export a reviewed, completed live trace. Never export raw responses or credentials.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
export const digest = data => createHash('sha256').update(data).digest('hex');
export const sampleDigest = () => digest(['adapter.mjs', 'transport.mjs', 'run.mjs'].map(p => readFileSync(new URL('../examples/stripe-update/' + p, import.meta.url))).join('\n'));
export function summarize(trace, recordedAt) {
  assert.equal(trace.mode, 'Real Stripe sandbox: injected update receipt loss');
  assert.equal(trace.sourceDigest, sampleDigest(), 'Source changed: rerun sandbox; never rewrite the historical digest');
  assert.deepEqual(trace.steps.map(s => s.method), ['create','preflight','publish','edit','preflight','publish','resume','preflight','publish']);
  const results = trace.steps.filter(s => ['publish','resume'].includes(s.method));
  assert.deepEqual(results.map(s => [s.output.kind, s.output.state]), [['initial_create','published'],['update','unknown'],['update','published'],['noop','published']]);
  assert.equal(results[1].output.id, results[2].output.id);
  assert.notEqual(results[0].output.id, results[1].output.id);
  assert.equal(results[3].output.id, null);
  const posts = trace.http.filter(h => h.method === 'POST');
  assert.equal(posts.length, 2);
  const remoteId = posts[0].data.id;
  assert.match(remoteId, /^prod_[A-Za-z0-9]+$/);
  assert.equal(posts[0].path, '/v1/products');
  assert.equal(posts[1].path, '/v1/products/' + remoteId);
  assert.equal(posts[0].data.name, 'StagedWrite update example A');
  assert.equal(posts[1].data.name, 'StagedWrite update example B');
  assert.notEqual(posts[0].wireKey, posts[1].wireKey);
  for (const h of trace.http) {
    assert.equal(h.status, 200); assert.equal(h.data.object, 'product');
    assert.equal(h.data.livemode, false); assert.equal(h.data.id, remoteId);
    assert.ok(h.path === '/v1/products' || h.path === '/v1/products/' + remoteId);
  }
  assert.equal(trace.http.at(-1).method, 'GET');
  assert.equal(trace.http.at(-1).data.name, 'StagedWrite update example B');
  assert.deepEqual(trace.assertions, { sameRemoteId: true, noopWithoutWrite: true, completed: true });
  return { formatVersion: 1, recordedAt, sampleSourceDigest: trace.sourceDigest,
    scenario: 'Real Stripe sandbox Product update; injected receipt loss after a real successful write; SQLite reopened before same-Run resume; no LLM or payments',
    states: results.map(s => ({ method: s.method, kind: s.output.kind, state: s.output.state })),
    http: trace.http.map(h => ({ method: h.method, path: h.path === '/v1/products' ? h.path : '/v1/products/:id', status: h.status, name: h.data.name, livemode: h.data.livemode })),
    assertions: { sameRemoteId: true, sameUpdateRun: true, oneCreatePost: true, oneUpdatePost: true, finalReadIsUpdated: true, noopWithoutWrite: true, allTestMode: true } };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.ok(process.argv[2], 'Supply existing live state directory');
  const path = join(process.argv[2], 'trace.json');
  const output = new URL('../docs/examples/stripe-update-sandbox-result.json', import.meta.url);
  writeFileSync(output, JSON.stringify(summarize(JSON.parse(readFileSync(path, 'utf8')), statSync(path).mtime.toISOString()), null, 2) + '\n');
  console.log('Wrote allowlisted Stripe update evidence; raw trace remains local.');
}
