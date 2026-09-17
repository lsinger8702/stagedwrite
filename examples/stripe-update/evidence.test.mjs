import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest, sampleDigest, summarize } from '../../scripts/record-stripe-update.mjs';
const bytes = readFileSync(new URL('../../docs/examples/stripe-update-sandbox-result.json', import.meta.url));
const report = JSON.parse(bytes);
test('live update recording matches the reviewed bytes and current sample source', () => {
  assert.equal(digest(bytes), 'f320ff1728e52b79f4323fd36b0293c60e01787a752623fd779ad49f6a1207c1', 'Recording changed: review a new live experiment, never just update the hash');
  assert.equal(report.sampleSourceDigest, sampleDigest(), 'Sample changed: rerun sandbox; never rewrite the historical source digest');
  assert.deepEqual(report.states.map(s => s.state), ['published', 'unknown', 'published', 'published']);
  assert.deepEqual(report.http.filter(h => h.method === 'POST').map(h => h.path), ['/v1/products', '/v1/products/:id']);
  assert.ok(report.http.every(h => h.status === 200 && h.livemode === false));
  assert.ok(Object.values(report.assertions).every(v => v === true));
});
test('evidence exporter refuses mock or incomplete traces', () => {
  assert.throws(() => summarize({ mode: 'Offline mock: no Stripe calls' }, 'date'));
  assert.throws(() => summarize({ mode: 'Real Stripe sandbox: injected update receipt loss', sourceDigest: sampleDigest(), steps: [] }, 'date'));
});
