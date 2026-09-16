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
    nodes: {
      product: { id: 'product', nodeType: 'product', fields: { name: `StagedWrite test ${experiment}` } },
      // Deliberately valid local shape but invalid remote currency, to exercise repair.
      monthly: { id: 'monthly', nodeType: 'price', fields: { currency: 'zzz', amount: 1000, interval: 'month' } },
      annual: { id: 'annual', nodeType: 'price', fields: { currency: 'hkd', amount: 10000, interval: 'year' } },
    },
    edges: {
      monthly: { id: 'monthly', relationType: 'pricedBy', from: 'product', to: 'monthly' },
      annual: { id: 'annual', relationType: 'pricedBy', from: 'product', to: 'annual' },
    },
  };
}
