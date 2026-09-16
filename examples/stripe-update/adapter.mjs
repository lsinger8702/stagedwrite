import { createHash } from 'node:crypto';
import { defineDraftType } from '../../dist/src/index.js';
export const definition = defineDraftType({ id: 'stripe.product-update', version: '1', nodeTypes: { product: { valueSchema: { type: 'object', properties: { name: { type: 'string' } }, additionalProperties: false } } }, relationTypes: {} });
export const selector = { type: definition.id, typeVersion: '1' };
const fingerprint = step => createHash('sha256').update(JSON.stringify(step)).digest('hex');
const values = product => ({ name: { kind: 'value', value: product.name } });
// receiptStore must persist before set() returns. It stores actual successful HTTP
// receipts, not inferred remote equality. Absence never establishes no_effect.
export function productExecutor({ request, target, receiptStore, loseUpdateReceipt = () => false }) {
  function applied(result) {
    if (result.status !== 200 || result.data?.object !== 'product' || result.data.livemode !== false || typeof result.data.id !== 'string' || typeof result.data.name !== 'string') return { kind: 'unknown', reason: 'No authoritative test Product receipt' };
    return { kind: 'applied', remoteRef: result.data.id, confirmed: { projectionDigest: 'product-name-v1', values: values(result.data) } };
  }
  return {
    ...selector, id: 'stripe.product-update', version: '1', target, updateWrites: true,
    plan: d => Object.values(d.graph.nodes).map(n => ({ id: n.id, payload: { name: n.fields.name }, effect: { kind: 'create', nodeId: n.id } })),
    update: {
      async inspect(draft, { bindings, signal }) {
        const projections = [], observations = [];
        for (const n of Object.values(draft.graph.nodes)) {
          const b = bindings[n.id], result = await request('GET', `/v1/products/${b.remoteId}`, {}, undefined, signal);
          if (applied(result).kind !== 'applied') throw Error('Remote inspection failed');
          projections.push({ nodeId: n.id, projectionDigest: 'product-name-v1', fields: { name: { path: '/name', writable: true, ...(draft.fieldIntents[n.id]?.['/name'] ? { desired: { kind: 'value', value: n.fields.name ?? null } } : {}) } } });
          observations.push({ id: `read:${n.id}`, nodeId: n.id, targetId: target, remoteId: b.remoteId, projectionDigest: 'product-name-v1', values: values(result.data), observedAt: new Date().toISOString() });
        }
        return { status: 'complete', projections, observations };
      },
      plan: (d, c) => Object.values(d.graph.nodes).map(n => { const slot = c.slots.find(s => s.nodeId === n.id); return { id: n.id, payload: slot.kind === 'update' ? { name: n.fields.name } : {}, effect: { kind: slot.kind, nodeId: n.id, remoteId: slot.remoteId } }; })
    },
    async apply(step, key, { signal }) {
      const path = step.effect.kind === 'create' ? '/v1/products' : `/v1/products/${step.effect.remoteId}`;
      const result = await request('POST', path, step.payload, key, signal);
      if (result.status === 400 && result.data?.error?.type === 'invalid_request_error' && result.data.error.param === 'name') return { kind: 'not_applied', reason: result.data.error.message, diagnostics: [{ code: 'STRIPE_NAME_INVALID', path: `/nodes/${step.effect.nodeId}/fields/name`, message: result.data.error.message, hint: 'Set a nonempty product name, then resume this Run.' }] };
      const outcome = applied(result);
      if (outcome.kind === 'applied') {
        await receiptStore.set(key, { fingerprint: fingerprint(step), outcome });
        if (step.effect.kind === 'update' && loseUpdateReceipt()) return { kind: 'unknown', reason: 'Injected receipt loss after storing the actual Stripe response' };
      }
      return outcome;
    },
    async reconcile(step, key) {
      const saved = await receiptStore.get(key);
      return saved?.fingerprint === fingerprint(step) ? saved.outcome : { kind: 'unknown', reason: 'No durable original response; remote equality is not evidence that this request finished' };
    }
  };
}
