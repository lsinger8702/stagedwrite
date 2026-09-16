import crypto from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import assert from 'node:assert/strict';
const offline = process.argv.includes('--offline');
if (!offline && !process.argv.includes('--allow-test-writes')) { console.log('Use --offline [--write-report|--check], or --allow-test-writes --state-dir=PATH [--resume] with STRIPE_SECRET_KEY and STRIPE_SANDBOX_ACCOUNT.'); process.exit(0); }
if (offline) {
  let sequence = 0;
  crypto.randomUUID = () => `00000000-0000-4000-8000-${(++sequence).toString(16).padStart(12, '0')}`;
  syncBuiltinESMExports();
  const NativeDate = Date;
  globalThis.Date = class extends NativeDate { constructor(...args) { super(...(args.length ? args : ['2026-09-17T00:00:00.000Z'])); } static now() { return 1789603200000; } };
}
const { createStagedWrite, createSqliteBackend } = await import('../../dist/src/index.js');
const { definition, selector, productExecutor } = await import('./adapter.mjs');
const { createTransport, assertTestKey } = await import('./transport.mjs');
const { zipFiles } = await import('../../scripts/walkthrough-artifacts.mjs');
const sourceDigest = crypto.createHash('sha256').update(['adapter.mjs','transport.mjs','run.mjs'].map(p => readFileSync(new URL(p, import.meta.url))).join('\n')).digest('hex');
const target = offline ? 'mock:stripe-products' : process.env.STRIPE_SANDBOX_ACCOUNT;
if (!offline) { assertTestKey(process.env.STRIPE_SECRET_KEY); if (!/^acct_[A-Za-z0-9]+$/.test(target ?? '')) throw Error('STRIPE_SANDBOX_ACCOUNT required'); }
const credentialFingerprint = offline ? 'mock' : crypto.createHash('sha256').update(process.env.STRIPE_SECRET_KEY).digest('hex');
const directory = offline ? mkdtempSync(join(tmpdir(), 'sw-update-demo-')) : resolve(process.argv.find(a => a.startsWith('--state-dir='))?.slice(12) ?? '.stripe-example/product-update');
const manifestPath = join(directory, 'manifest.json');
if (!offline && existsSync(directory) && !process.argv.includes('--resume')) throw Error('Existing directory: use --resume, never replace unresolved execution state');
if (!offline && process.argv.includes('--resume') && !existsSync(manifestPath)) throw Error('Missing manifest: investigate existing state; do not create a replacement');
mkdirSync(directory, { recursive: true });
const write = (path, data) => { writeFileSync(`${path}.tmp`, JSON.stringify(data, null, 2)); renameSync(`${path}.tmp`, path); };
let manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
if (manifest && (manifest.sourceDigest !== sourceDigest || manifest.target !== target || manifest.credentialFingerprint !== credentialFingerprint)) throw Error('Source/target changed; do not reinterpret an existing request');
const receiptPath = join(directory, 'receipts.json');
const receiptStore = { get: key => existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8'))[key] : undefined, set: (key, value) => { const all = existsSync(receiptPath) ? JSON.parse(readFileSync(receiptPath, 'utf8')) : {}; all[key] = value; write(receiptPath, all); } };
const trace = existsSync(join(directory, 'trace.json')) ? JSON.parse(readFileSync(join(directory, 'trace.json'), 'utf8')) : { mode: offline ? 'Offline mock: no Stripe calls' : 'Real Stripe sandbox: injected update receipt loss', sourceDigest, steps: [], http: [] };
let mockProduct;
const request = offline ? async (method, path, params) => {
  if (method === 'POST') mockProduct = { object: 'product', id: 'prod_mock', livemode: false, name: params.name };
  const result = { status: 200, data: structuredClone(mockProduct) };
  trace.http.push({ method, path, params, status: result.status }); return result;
} : createTransport(process.env.STRIPE_SECRET_KEY, record => { trace.http.push(record); write(join(directory, 'trace.json'), trace); });
let inject = true;
const open = () => createStagedWrite({ definitions: [definition], ...createSqliteBackend(join(directory, 'state.sqlite')), executors: [productExecutor({ request, target, receiptStore, loseUpdateReceipt: () => { if (!inject) return false; inject = false; return true; } })] });
let engine = open();
const call = async (method, args) => { const result = await engine[method](...args); trace.steps.push({ method, input: args, output: result }); write(join(directory, 'trace.json'), trace); return result; };
try {
  if (!manifest) {
    const receipt = await call('create', [selector, { roots: [{ nodeType: 'product', fields: { name: 'StagedWrite update example A' } }] }]);
    manifest = { draftId: receipt.draft.id, target, credentialFingerprint, sourceDigest, stage: 'create' }; write(manifestPath, manifest);
  }
  if (manifest.stage === 'create') {
    const d = await engine.getDraft(manifest.draftId);
    let result;
    if (d.currentRunId) result = await call('resume', [d.currentRunId]);
    else { const check = await call('preflight', [d.id]); result = await call('publish', [d.id, check.certificate]); }
    if (result.state !== 'published') throw Error('Initial Run unresolved; preserve this directory and resume');
    manifest.remoteId = Object.values(await engine.getBindings(d.id))[0].remoteId;
    manifest.stage = 'update'; write(manifestPath, manifest);
  }
  if (manifest.stage === 'update') {
    let d = await engine.getDraft(manifest.draftId);
    if (Object.values(d.graph.nodes)[0].fields.name !== 'StagedWrite update example B') {
      await call('edit', [d.id, d.version, { patches: [{ op: 'set', ref: Object.keys(d.graph.nodes)[0], scope: 'canonical', path: '/name', value: 'StagedWrite update example B' }] }]);
      d = await engine.getDraft(d.id);
    }
    let current = await engine.getRun(d.currentRunId), result;
    if (current.kind === 'update') result = await call('resume', [current.id]);
    else { const check = await call('preflight', [d.id]); result = await call('publish', [d.id, check.certificate]); }
    if (result.state === 'unknown') { await engine.close(); engine = open(); result = await call('resume', [result.id]); }
    if (result.state !== 'published') throw Error('Update unresolved; preserve this directory and resume');
    assert.equal(Object.values(await engine.getBindings(d.id))[0].remoteId, manifest.remoteId);
    manifest.stage = 'noop'; write(manifestPath, manifest);
  }
  if (manifest.stage === 'noop') {
    const check = await call('preflight', [manifest.draftId]);
    const before = trace.http.filter(h => h.method === 'POST').length;
    const result = await call('publish', [manifest.draftId, check.certificate]);
    assert.equal(result.kind, 'noop'); assert.equal(result.id, null);
    assert.equal(trace.http.filter(h => h.method === 'POST').length, before);
    manifest.stage = 'done'; write(manifestPath, manifest);
  }
  trace.assertions = { sameRemoteId: true, noopWithoutWrite: true, completed: true };
  write(join(directory, 'trace.json'), trace);
  if (offline) {
    const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>StagedWrite update · actual I/O</title><style>body{font:16px system-ui;max-width:960px;margin:24px auto;padding:16px;background:#f5f7fa;color:#172238}details{background:white;padding:16px;margin:12px 0;border-radius:10px}summary{cursor:pointer;font-weight:700}pre{overflow:auto;font-size:13px;white-space:pre-wrap;overflow-wrap:anywhere}h1{font-size:28px}</style><h1>更新同一个远端资源</h1><p>实际执行 StagedWrite 与 SQLite。远端为 Stripe 形状的 Mock，无网络或大模型调用。包含创建、编辑、预检、更新回执丢失、重开后 resume、noop 发布。</p>${trace.steps.map((s,i)=>`<details><summary>${i+1}. ${escape(s.method)} · ${escape(s.output.state ?? s.output.status ?? '')}</summary><h3>输入</h3><pre>${escape(JSON.stringify(s.input,null,2))}</pre><h3>输出</h3><pre>${escape(JSON.stringify(s.output,null,2))}</pre></details>`).join('')}<details><summary>远端调用与断言</summary><pre>${escape(JSON.stringify({http:trace.http,assertions:trace.assertions},null,2))}</pre></details>`;
    const json = JSON.stringify(trace, null, 2)+'\n';
    const artifacts = [['update.html',html],['update-trace.json',json],['stagedwrite-update.zip',zipFiles([['update.html',html],['actual-input-output.json',json]])]];
    for (const [name, value] of artifacts) {
      const path = new URL(`../../docs/examples/${name}`, import.meta.url);
      if (process.argv.includes('--check')) assert.deepEqual(readFileSync(path), Buffer.from(value), `${name} is stale: run npm run demo:update`);
      else if (process.argv.includes('--write-report')) writeFileSync(path, value);
    }
  }
  console.log(JSON.stringify({ mode: trace.mode, stage: manifest.stage, methods: trace.steps.map(s => s.method), assertions: trace.assertions }));
} finally { await engine.close(); if (offline) rmSync(directory,{recursive:true,force:true}); }
