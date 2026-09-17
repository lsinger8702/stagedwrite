import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest, sampleDigest, summarizeCatalog } from '../../scripts/record-stripe-catalog-update.mjs';
const bytes = readFileSync(new URL('../../docs/examples/stripe-catalog-update-result.json',import.meta.url));
const report = JSON.parse(bytes);
test('reviewed catalog recording preserves source, bytes and actual rejection sequence', () => {
  assert.equal(digest(bytes), 'c3ca2046b809a228c51ef7d88a2323fac37d2a85375b0e4033207a089ef55a48', 'Review a new actual run before changing recorded evidence');
  assert.equal(report.sampleSourceDigest,sampleDigest(),'Sample changed: rerun sandbox; never rewrite the historical digest');
  assert.deepEqual(report.http.filter(h => h.method === 'POST').map(h => [h.path,h.status]), [['/v1/products',200],['/v1/prices',200],['/v1/prices',200],['/v1/products/:id',400],['/v1/products/:id',200]]);
  assert.ok(report.diagnostics.every(d => d.message && d.hint));
  assert.ok(Object.values(report.assertions).every(v => v === true));
});
test('catalog evidence exporter refuses mock and incomplete evidence', () => {
  assert.throws(() => summarizeCatalog({mode:'Offline mock catalog'}));
  assert.throws(() => summarizeCatalog({mode:'Real Stripe sandbox catalog update rejection and repair',sourceDigest:sampleDigest(),finishedAt:'date',steps:[]}));
});
