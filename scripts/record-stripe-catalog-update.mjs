import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { catalogRefs } from '../examples/stripe/schema.mjs';
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
export const sampleDigest = () => digest(['catalog-adapter.mjs','catalog-transport.mjs','catalog-scenario.mjs','catalog-run.mjs','../stripe/schema.mjs'].map(p => readFileSync(new URL('../examples/stripe-update/'+p,import.meta.url))).join('\n'));
// Validate the exact original coordinate before replacing only its generated ref.
export function diagnosticAt(diagnostic, ref, role, field) {
  assert.ok(typeof ref === 'string' && ref.length);
  assert.ok(['product', 'monthly', 'annual'].includes(role));
  const pointer = value => value.replaceAll('~', '~0').replaceAll('/', '~1');
  assert.equal(diagnostic.path, `/nodes/${pointer(ref)}/fields/${pointer(field)}`, 'Diagnostic must identify the expected node and field');
  return { code: diagnostic.code, path: `/nodes/:${role}/fields/${pointer(field)}`, message: diagnostic.message, hint: diagnostic.hint };
}
export function summarizeCatalog(trace) {
  assert.equal(trace.mode, 'Real Stripe sandbox catalog update rejection and repair');
  assert.ok(trace.finishedAt); assert.equal(trace.sourceDigest, sampleDigest(), 'Rerun changed source; never overwrite the historical digest');
  const find = (phase, method) => { const s = trace.steps.find(s => s.phase === phase && s.method === method); assert.ok(s, `${phase}/${method}`); return s; };
  const refs = catalogRefs(find('create','create').output.draft);
  const create = find('create','publish'), immutable = find('immutable','preflight'), noop = find('reset','publish'), rejected = find('reject','publish'), repair = find('repair','resume');
  assert.equal(create.output.state, 'published');
  assert.equal(immutable.output.status, 'blocked'); assert.equal(immutable.output.certificate, undefined);
  const diagnostic = immutable.output.diagnostics.find(d => d.code === 'STRIPE_PRICE_IMMUTABLE');
  assert.ok(diagnostic?.message); assert.ok(diagnostic?.hint);
  assert.equal(noop.output.kind, 'noop'); assert.equal(noop.output.id, null);
  assert.equal(rejected.output.state, 'blocked'); assert.equal(repair.output.state, 'published'); assert.equal(repair.output.id, rejected.output.id);
  assert.notEqual(repair.output.id, create.output.id);
  assert.ok(repair.output.steps.filter(s => s.id !== 'product').every(s => s.status === 'satisfied'));
  const during = s => trace.http.slice(s.httpStart,s.httpEnd);
  for (const s of [immutable,noop]) assert.ok(during(s).every(h => h.method === 'GET'));
  const creates = during(create).filter(h => h.method === 'POST');
  assert.equal(creates.length, 3);
  const product = creates.find(h => h.path === '/v1/products').data.id;
  const prices = creates.filter(h => h.path === '/v1/prices'); assert.equal(prices.length, 2);
  for (const p of prices) { assert.equal(p.status,200); assert.equal(p.data.product,product); }
  assert.equal(trace.http.filter(h => h.method === 'POST' && h.path === '/v1/prices').length,2);
  assert.equal(trace.http.slice(create.httpEnd).filter(h => h.method === 'POST' && h.path.startsWith('/v1/prices')).length,0);
  const bad = during(rejected).filter(h => h.method === 'POST'), good = during(repair).filter(h => h.method === 'POST');
  assert.equal(bad.length,1); assert.equal(good.length,1);
  assert.equal(bad[0].path,`/v1/products/${product}`); assert.equal(good[0].path,bad[0].path);
  assert.equal(bad[0].status,400); assert.equal(bad[0].data.error.type,'invalid_request_error'); assert.equal(bad[0].data.error.param,'name');
  assert.equal(good[0].status,200); assert.equal(good[0].data.name,'StagedWrite catalog B'); assert.equal(good[0].data.id,product);
  assert.notEqual(bad[0].wireKey,good[0].wireKey);
  const remoteError = rejected.output.diagnostics.find(d => d.code === 'STRIPE_NAME_INVALID');
  assert.equal(remoteError?.message,bad[0].data.error.message); assert.ok(remoteError.hint);
  const lastRead = id => trace.http.filter(h => h.method === 'GET' && h.data?.id === id).at(-1);
  assert.equal(lastRead(product).data.name,'StagedWrite catalog B');
  for (const p of prices) { const last = lastRead(p.data.id); assert.equal(last.data.product,product); assert.equal(last.data.unit_amount,p.data.unit_amount); }
  for (const h of trace.http.filter(h => h.status === 200)) assert.equal(h.data.livemode,false);
  const observed = find('verify','resume'); assert.equal(observed.httpStart,observed.httpEnd);
  // Only explicitly selected fields leave the local trace. No target/key/receipt bodies.
  return { formatVersion: 1, recordedAt: trace.finishedAt, sampleSourceDigest: trace.sourceDigest,
    scenario: 'Real Stripe sandbox: Product plus two Prices; immutable amount blocked locally; real empty-name update refusal; explicit edit and same-Run resume. No injected rejection, no LLM, no payments.',
    states: trace.steps.filter(s => ['preflight','publish','resume'].includes(s.method)).map(s => ({ phase: s.phase, method: s.method, ...(s.output.status ? {status:s.output.status} : {kind:s.output.kind,state:s.output.state}) })),
    diagnostics: [diagnosticAt(diagnostic, refs.monthly, 'monthly', 'amount'), diagnosticAt(remoteError, refs.product, 'product', 'name')],
    http: trace.http.map(h => ({ method:h.method,path:h.path.replace(/\/(prod|price)_[A-Za-z0-9]+$/, '/:id'),status:h.status,...(h.data.error ? {errorType:h.data.error.type,errorParam:h.data.error.param} : {object:h.data.object,livemode:h.data.livemode}) })),
    assertions: { priceIdentityAndAmountPreserved:true,noPricePostsAfterCreate:true,immutableAmountHasNoCertificate:true,immutableAndResetNoPost:true,realUpdateRefusal:true,repairedWithinSameRun:true,repairedKeyChanged:true,finalReadMatchesIntent:true,completedResumeWithoutHttp:true } };
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  assert.ok(process.argv[2], 'Supply the existing live state directory');
  const trace = JSON.parse(readFileSync(join(process.argv[2],'trace.json')));
  writeFileSync(new URL('../docs/examples/stripe-catalog-update-result.json',import.meta.url), JSON.stringify(summarizeCatalog(trace),null,2)+'\n');
  console.log('Recorded allowlisted catalog update evidence; raw state remains local.');
}
