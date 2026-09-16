import { defineDraftType } from '../../dist/src/index.js';

export const definition = defineDraftType({
  id: 'example.stripe-catalog', version: '1',
  nodeTypes: {
    product: {
      valueSchema: { type: 'object', properties: { name: { type: 'string', minLength: 1 } }, additionalProperties: false },
      requiredAtPublish: ['name'],
    },
    price: {
      valueSchema: { type: 'object', properties: {
        currency: { type: 'string', minLength: 3, maxLength: 3 },
        amount: { type: 'integer', minimum: 0 },
        interval: { type: 'string', enum: ['month', 'year'] },
      }, additionalProperties: false },
      requiredAtPublish: ['currency', 'amount', 'interval'],
    },
  },
  relationTypes: { pricedBy: { from: ['product'], to: ['price'], ownership: 'owned', cardinality: 'many' } },
});
export const selector = { type: definition.id, typeVersion: definition.version };

export function initialIntent(experiment) {
  return {
    roots: [{ nodeType: 'product', fields: { name: `StagedWrite test ${experiment}` }, relations: { pricedBy: [
      // Valid local shape, deliberately invalid remote currency, to exercise repair.
      { nodeType: 'price', fields: { currency: 'zzz', amount: 1000, interval: 'month' } },
      { nodeType: 'price', fields: { currency: 'hkd', amount: 10000, interval: 'year' } },
    ] } }],
  };
}

// Business roles are separate from generated node refs. This sample has exactly
// one Product and one Price for each immutable interval; ambiguity is rejected.
export function catalogRefs(draft) {
  const nodes = Object.values(draft.graph.nodes);
  const one = predicate => { const found = nodes.filter(predicate); if (found.length !== 1) throw new Error('Unexpected sample graph'); return found[0].id; };
  const product = one(n => n.nodeType === 'product');
  const monthly = one(n => n.nodeType === 'price' && n.fields.interval === 'month');
  const annual = one(n => n.nodeType === 'price' && n.fields.interval === 'year');
  if (nodes.length !== 3) throw new Error('Unexpected sample graph');
  for (const ref of [monthly, annual]) {
    const edges = Object.values(draft.graph.edges).filter(e => e.to === ref);
    if (edges.length !== 1 || edges[0].from !== product || edges[0].relationType !== 'pricedBy') throw new Error('Price must reference the Product');
  }
  return { product, monthly, annual };
}
