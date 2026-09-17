import { createHash } from 'node:crypto';
import { defineDraftType } from '../../dist/src/index.js';
import { catalogRefs } from '../stripe/schema.mjs';
export { catalogRefs };
export const definition = defineDraftType({ id: 'stripe.catalog-update', version: '1', nodeTypes: {
  product: { valueSchema: { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false }, requiredAtPublish: ['name'] },
  price: { valueSchema: { type: 'object', properties: { amount: { type: 'integer', minimum: 0 }, currency: { type: 'string' }, interval: { type: 'string', enum: ['month', 'year'] } }, additionalProperties: false }, requiredAtPublish: ['amount', 'currency', 'interval'] },
}, relationTypes: { pricedBy: { from: ['product'], to: ['price'], ownership: 'owned', cardinality: 'many' } } });
export const selector = { type: definition.id, typeVersion: '1' };
export const initialIntent = { roots: [{ nodeType: 'product', fields: { name: 'StagedWrite catalog A' }, relations: { pricedBy: [
  { nodeType: 'price', fields: { amount: 1000, currency: 'hkd', interval: 'month' } },
  { nodeType: 'price', fields: { amount: 10000, currency: 'hkd', interval: 'year' } },
] } }] };
const fields = role => role === 'product' ? ['name'] : ['amount', 'currency', 'interval'];
const projection = role => role === 'product' ? 'product-name-v1' : 'price-fixed-v1';
const fingerprint = step => createHash('sha256').update(JSON.stringify(step)).digest('hex');
function normalized(role, data) {
  const values = role === 'product' ? { name: data.name } : { amount: data.unit_amount, currency: data.currency, interval: data.recurring?.interval };
  if (typeof data.id !== 'string' || data.livemode !== false || data.object !== (role === 'product' ? 'product' : 'price') ||
      (role === 'product' ? typeof values.name !== 'string' : !Number.isSafeInteger(values.amount) || typeof values.currency !== 'string' || !['month','year'].includes(values.interval))) throw Error('Invalid test-mode resource receipt');
  return Object.fromEntries(Object.entries(values).map(([k,v]) => [k, { kind: 'value', value: v }]));
}
// One Product and two recurring Prices. No Price replacement, payment or subscription writes.
export function catalogExecutor({ request, target, receiptStore }) {
  return { ...selector, id: 'stripe.catalog-update', version: '1', target, updateWrites: true,
    plan(d) { const refs = catalogRefs(d); return Object.entries(refs).map(([role, ref]) => ({ id: role, payload: { ...d.graph.nodes[ref].fields }, effect: { kind: 'create', nodeId: ref }, ...(role === 'product' ? {} : { dependsOn: ['product'], inputRefs: { product: 'product' } }) })); },
    update: {
      async inspect(d, { bindings, signal }) {
        const refs = catalogRefs(d), projections = [], observations = [], diagnostics = [];
        for (const [role, ref] of Object.entries(refs)) {
          const remoteId = bindings[ref].remoteId;
          const result = await request('GET', `/v1/${role === 'product' ? 'products' : 'prices'}/${remoteId}`, {}, undefined, signal);
          if (result.status !== 200 || result.data.id !== remoteId || role !== 'product' && result.data.product !== bindings[refs.product].remoteId) throw Error('Remote identity/relationship mismatch');
          const values = normalized(role, result.data);
          projections.push({ nodeId: ref, projectionDigest: projection(role), fields: Object.fromEntries(fields(role).map(field => [field, { path: `/${field}`, writable: role === 'product', ...(d.fieldIntents[ref]?.[`/${field}`] ? { desired: { kind: 'value', value: d.graph.nodes[ref].fields[field] ?? null } } : {}) }])) });
          observations.push({ id: `read:${ref}`, nodeId: ref, targetId: target, remoteId, projectionDigest: projection(role), values, observedAt: new Date().toISOString() });
          if (role !== 'product') for (const field of fields(role)) {
            if (d.fieldIntents[ref]?.[`/${field}`] && d.graph.nodes[ref].fields[field] !== values[field].value) diagnostics.push({ code: 'STRIPE_PRICE_IMMUTABLE', path: `/nodes/${ref}/fields/${field}`, message: `This Price's ${field} cannot be changed in place.`, hint: 'Restore the published value with reset. Replacing a Price and switching references is outside this sample.', repairs: [{ message: 'Restore published intent', ops: { patches: [{ op: 'reset', ref, scope: 'canonical', path: `/${field}` }] } }] });
          }
        }
        return { status: 'complete', projections, observations, diagnostics };
      },
      plan(d, c) { return Object.entries(catalogRefs(d)).map(([role, ref]) => { const slot = c.slots.find(s => s.nodeId === ref); return { id: role, payload: slot.kind === 'update' ? { ...d.graph.nodes[ref].fields } : {}, effect: { kind: slot.kind, nodeId: ref, remoteId: slot.remoteId }, ...(role === 'product' ? {} : { dependsOn: ['product'] }) }; }); },
    },
    async apply(step, key, { signal }) {
      const product = step.id === 'product';
      if (!product && step.effect.kind !== 'create') throw Error('Price writes are creation-only; the compiler must block immutable changes');
      const body = product ? { name: step.payload.name } : { product: step.payload.product, unit_amount: step.payload.amount, currency: step.payload.currency, 'recurring[interval]': step.payload.interval };
      const path = step.effect.kind === 'create' ? `/v1/${product ? 'products' : 'prices'}` : `/v1/products/${step.effect.remoteId}`;
      const result = await request('POST', path, body, key, signal);
      const error = result.data?.error;
      if (product && result.status === 400 && error?.type === 'invalid_request_error' && error.param === 'name') return { kind: 'not_applied', reason: error.message, diagnostics: [{ code: 'STRIPE_NAME_INVALID', path: `/nodes/${step.effect.nodeId}/fields/name`, message: error.message, hint: 'Set a nonempty name consistent with the user goal, then resume this same Run.' }] };
      try {
        if (result.status !== 200 || step.effect.kind === 'update' && result.data.id !== step.effect.remoteId || !product && result.data.product !== step.payload.product) throw Error('Receipt identity mismatch');
        const values = normalized(step.id, result.data);
        if (fields(step.id).some(field => values[field].value !== step.payload[field])) throw Error('Receipt values mismatch');
        const outcome = { kind: 'applied', remoteRef: result.data.id, confirmed: { projectionDigest: projection(step.id), values } };
        await receiptStore.set(key, { fingerprint: fingerprint(step), outcome }); return outcome;
      } catch { return { kind: 'unknown', reason: 'Response or durable receipt does not prove this original request succeeded' }; }
    },
    async reconcile(step, key) { const saved = await receiptStore.get(key); return saved?.fingerprint === fingerprint(step) ? saved.outcome : { kind: 'unknown', reason: 'No durable original receipt; preserve this Run, never infer success from current equality' }; },
  };
}
