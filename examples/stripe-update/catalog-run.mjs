import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { createStagedWrite, createSqliteBackend } from '../../dist/src/index.js';
import { definition, catalogExecutor } from './catalog-adapter.mjs';
import { createTransport, assertTestKey, requestKey } from './catalog-transport.mjs';
import { exerciseCatalog } from './catalog-scenario.mjs';
const args = process.argv.slice(2), offline = args.includes('--offline');
if (!offline && !args.includes('--allow-test-writes')) throw Error('Use --offline or --allow-test-writes --state-dir=PATH [--resume] with test credentials');
if (args.some(a => !['--offline','--allow-test-writes','--resume'].includes(a) && !a.startsWith('--state-dir='))) throw Error('Unknown argument');
const sourceFiles = ['catalog-adapter.mjs','catalog-transport.mjs','catalog-scenario.mjs','catalog-run.mjs','../stripe/schema.mjs'];
const sourceDigest = createHash('sha256').update(sourceFiles.map(p => readFileSync(new URL(p, import.meta.url))).join('\n')).digest('hex');
const target = offline ? 'mock:catalog' : process.env.STRIPE_SANDBOX_ACCOUNT;
if (!offline) { assertTestKey(process.env.STRIPE_SECRET_KEY); if (!/^acct_[A-Za-z0-9]+$/.test(target ?? '')) throw Error('STRIPE_SANDBOX_ACCOUNT required'); }
const dirArg = args.find(a => a.startsWith('--state-dir='))?.slice(12);
if (!offline && !dirArg) throw Error('Choose and preserve --state-dir');
const directory = offline ? mkdtempSync(join(tmpdir(), 'sw-catalog-')) : resolve(dirArg);
const manifestPath = join(directory, 'manifest.json'), tracePath = join(directory, 'trace.json');
if (!offline && existsSync(directory) && !args.includes('--resume')) throw Error('Existing state: use --resume, never replace unresolved state');
if (!offline && args.includes('--resume') && !existsSync(manifestPath)) throw Error('Missing manifest: investigate, do not start a replacement');
mkdirSync(directory, { recursive: true, mode: 0o700 });
const write = (p,v) => { writeFileSync(p+'.tmp', JSON.stringify(v,null,2), { mode: 0o600 }); renameSync(p+'.tmp',p); };
const credentialDigest = offline ? 'mock' : requestKey(process.env.STRIPE_SECRET_KEY);
const state = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath)) : { phase: 'create', sourceDigest, credentialDigest, target };
if (state.sourceDigest !== sourceDigest || state.target !== target || state.credentialDigest !== credentialDigest) throw Error('Source/target/credential changed: preserve original state');
const trace = existsSync(tracePath) ? JSON.parse(readFileSync(tracePath)) : { mode: offline ? 'Offline mock catalog' : 'Real Stripe sandbox catalog update rejection and repair', sourceDigest, startedAt: new Date().toISOString(), steps: [], http: [] };
const save = () => { write(tracePath, trace); write(manifestPath, state); };
const record = r => { trace.http.push(r); save(); };
const receiptsPath = join(directory, 'receipts.json');
const receiptStore = { get: key => existsSync(receiptsPath) ? JSON.parse(readFileSync(receiptsPath))[key] : undefined, set: (key,v) => { const all = existsSync(receiptsPath) ? JSON.parse(readFileSync(receiptsPath)) : {}; all[key] = v; write(receiptsPath, all); } };
const products = new Map(), prices = new Map();
const mock = async (method, path, params = {}, key) => {
  let data, status = 200;
  if (method === 'GET') data = (path.includes('/products/') ? products : prices).get(path.split('/').at(-1));
  else if (path.startsWith('/v1/products')) {
    if (params.name === '') { status = 400; data = { error: { type: 'invalid_request_error', param: 'name', message: 'A product name cannot be empty.' } }; }
    else { const id = path === '/v1/products' ? 'prod_mock' : path.split('/').at(-1); data = { object: 'product', id, livemode: false, name: params.name }; products.set(id,data); }
  } else { const id = 'price_mock'+prices.size; data = { object: 'price', id, livemode: false, product: params.product, unit_amount: Number(params.unit_amount), currency: params.currency, recurring: { interval: params['recurring[interval]'] } }; prices.set(id,data); }
  const result = { status, data: structuredClone(data) }; record({ method, path, params, wireKey: key ? requestKey(key) : undefined, ...result }); return result;
};
const request = offline ? mock : createTransport(process.env.STRIPE_SECRET_KEY, record);
const engine = createStagedWrite({ definitions: [definition], ...createSqliteBackend(join(directory,'state.sqlite')), executors: [catalogExecutor({ request, target, receiptStore })], preflightTimeoutMs: 30000 });
try {
  await exerciseCatalog({ engine, request, state, trace, save });
  trace.finishedAt ??= new Date().toISOString(); save();
  console.log(JSON.stringify({ mode: trace.mode, phase: state.phase, assertions: trace.assertions }));
} finally { await engine.close(); if (offline) rmSync(directory,{recursive:true,force:true}); }
