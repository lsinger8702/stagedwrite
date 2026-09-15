import { selector } from './schema.mjs';
import { listAll, requestKey } from './transport.mjs';

export function requestBody(step, key, experiment) {
  const p = step.payload;
  const metadata = { 'metadata[experiment]': experiment, 'metadata[node]': step.id, 'metadata[request_hash]': requestKey(key) };
  return step.id === 'product'
    ? { name: p.name, ...metadata }
    : { product: p.product, currency: p.currency, unit_amount: p.amount, 'recurring[interval]': p.interval, ...metadata };
}

function matches(object, step, key, experiment) {
  const p = step.payload;
  return typeof object.id === 'string' && object.livemode === false &&
    object.metadata?.experiment === experiment && object.metadata?.node === step.id &&
    object.metadata?.request_hash === requestKey(key) && (step.id === 'product'
      ? object.object === 'product' && object.name === p.name
      : object.object === 'price' && object.product === p.product && object.currency === p.currency &&
        object.unit_amount === p.amount && object.recurring?.interval === p.interval);
}

// Educational adapter for this three-node catalog, not a complete Stripe provider.
export function createCatalogExecutor({ request, experiment, target, loseAnnualReceipt = false }) {
  return {
    ...selector, id: 'example.stripe-catalog', version: '1', target,
    plan(draft) {
      return ['product', 'monthly', 'annual'].map(id => {
        const node = draft.graph.nodes[id];
        if (!node || (id === 'product' ? node.nodeType !== 'product' : node.nodeType !== 'price')) throw new Error('Unexpected sample graph');
        const parent = Object.values(draft.graph.edges).find(edge => edge.to === id && edge.relationType === 'pricedBy')?.from;
        if (id !== 'product' && parent !== 'product') throw new Error('Price must reference the Product');
        return { id, effect: { kind: 'create', nodeId: id }, payload: { ...node.fields },
          ...(parent ? { dependsOn: [parent], inputRefs: { product: parent } } : {}) };
      });
    },
    async apply(step, key, { signal }) {
      const result = await request('POST', step.id === 'product' ? '/v1/products' : '/v1/prices', requestBody(step, key, experiment), key, signal);
      if (result.status === 200 && matches(result.data, step, key, experiment)) {
        if (loseAnnualReceipt && step.id === 'annual') return {
          kind: 'unknown', code: 'INJECTED_RECEIPT_LOSS',
          reason: 'Test driver deliberately withheld a real successful response',
          message: 'Receipt loss was injected after creation; resume must read back the original request outcome.',
        };
        return { kind: 'applied', remoteRef: result.data.id };
      }
      const error = result.data.error;
      // This exact validation failure happens before endpoint execution. Do not generalize
      // this to every 400, idempotency error, timeout, or server error.
      if (step.id !== 'product' && result.status === 400 && error?.type === 'invalid_request_error' && error.param === 'currency') {
        const message = error.message || 'Stripe rejected the currency parameter';
        return { kind: 'not_applied', reason: message, code: 'STRIPE_CURRENCY_VALIDATION', message,
          diagnostics: [{ code: 'STRIPE_CURRENCY_VALIDATION', path: `/nodes/${step.id}/fields/currency`, message,
            candidates: [{ value: 'hkd', label: 'HKD', repairOps: [{ op: 'set', nodeId: step.id, path: '/currency', value: 'hkd' }] }] }] };
      }
      return { kind: 'unknown', reason: `Unclassified Stripe response (${result.status})`,
        message: error?.message || 'Response does not establish a matching successful effect' };
    },
    async reconcile(step, key, { signal }) {
      try {
        const objects = await listAll(request, step.id === 'product' ? '/v1/products' : '/v1/prices',
          step.id === 'product' ? {} : { product: step.payload.product }, signal);
        const found = objects.filter(object => matches(object, step, key, experiment));
        return found.length === 1 ? { kind: 'applied', remoteRef: found[0].id }
          : { kind: 'unknown', reason: 'No unique matching positive remote evidence' };
      } catch {
        return { kind: 'unknown', reason: 'Remote lookup incomplete or unavailable' };
      }
    },
  };
}
