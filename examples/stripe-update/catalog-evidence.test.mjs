import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { digest, sampleDigest, summarizeCatalog, diagnosticAt } from '../../scripts/record-stripe-catalog-update.mjs';
const bytes = readFileSync(new URL('../../docs/examples/stripe-catalog-update-result.json',import.meta.url));
const report = JSON.parse(bytes);
test('reviewed catalog recording preserves source, bytes and actual rejection sequence', () => {
  assert.equal(digest(bytes), '8898bd25bfb2439c3844c47349f05bab5e590cccfed4b04a4db1f10ccb975d01', 'Review the source trace and export diff before accepting changed evidence; changed sample source requires a new live run');
  assert.equal(report.sampleSourceDigest,sampleDigest(),'Sample changed: rerun sandbox; never rewrite the historical digest');
  assert.deepEqual(report.http.filter(h => h.method === 'POST').map(h => [h.path,h.status]), [['/v1/products',200],['/v1/prices',200],['/v1/prices',200],['/v1/products/:id',400],['/v1/products/:id',200]]);
  assert.ok(report.diagnostics.every(d => d.message && d.hint));
  assert.deepEqual(report.diagnostics.map(d => [d.code, d.path]), [
    ['STRIPE_PRICE_IMMUTABLE', '/nodes/:monthly/fields/amount'],
    ['STRIPE_NAME_INVALID', '/nodes/:product/fields/name'],
  ]);
  assert.ok(Object.values(report.assertions).every(v => v === true));
});
test('catalog evidence exporter refuses mock and incomplete evidence', () => {
  assert.throws(() => summarizeCatalog({mode:'Offline mock catalog'}));
  assert.throws(() => summarizeCatalog({mode:'Real Stripe sandbox catalog update rejection and repair',sourceDigest:sampleDigest(),finishedAt:'date',steps:[]}));
});

test('diagnostic normalization rejects wrong or missing coordinates instead of masking them', () => {
  const base = { code: 'PRICE', path: '/nodes/ref~1monthly~0/fields/amount', message: 'Immutable amount', hint: 'Reset' };
  assert.deepEqual(diagnosticAt(base, 'ref/monthly~', 'monthly', 'amount'), { ...base, path: '/nodes/:monthly/fields/amount' });
  for (const path of [undefined, '/nodes/other/fields/amount', '/nodes/ref~1monthly~0/fields/currency', '/nodes/ref~1monthly~0/fields/amount/child']) {
    assert.throws(() => diagnosticAt({ ...base, path }, 'ref/monthly~', 'monthly', 'amount'), /expected node and field/);
  }
});
