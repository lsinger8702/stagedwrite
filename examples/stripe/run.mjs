import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { resolve, join, dirname } from 'node:path';
import { createStagedWrite, createSqliteBackend } from '../../dist/src/index.js';
import { definition, selector, initialIntent } from './schema.mjs';
import { createCatalogExecutor } from './adapter.mjs';
import { assertTestKey, createTransport, listAll, requestKey } from './transport.mjs';
import { sourceDigest, publicSummary } from './report.mjs';

const argv = process.argv.slice(2);
if (argv.includes('--help') || !argv.includes('--allow-test-writes')) {
  console.log('Sandbox only. Set STRIPE_SECRET_KEY and STRIPE_SANDBOX_ACCOUNT.\n' +
    'node examples/stripe/run.mjs --allow-test-writes --state-dir=./.stripe-example/one [--resume] [--summary=path.json]\n' +
    'A fresh state directory creates 1 Product + 2 Prices. Reuse it with --resume after interruption.');
  process.exit(argv.includes('--help') ? 0 : 1);
}
if (argv.some(arg => !['--allow-test-writes', '--resume'].includes(arg) && !/^--(state-dir|summary)=.+/.test(arg))) throw new Error('Unknown argument');
const secret = process.env.STRIPE_SECRET_KEY;
assertTestKey(secret);
const account = process.env.STRIPE_SANDBOX_ACCOUNT;
if (!/^acct_[A-Za-z0-9]+$/.test(account ?? '')) throw new Error('STRIPE_SANDBOX_ACCOUNT is required (non-secret target identity)');
const stateArg = argv.find(arg => arg.startsWith('--state-dir='))?.slice(12);
if (!stateArg) throw new Error('--state-dir is required; choose it once and preserve it');
const directory = resolve(stateArg), continuing = argv.includes('--resume');
const manifestPath = join(directory, 'manifest.json');
if (continuing ? !existsSync(manifestPath) : existsSync(directory)) throw new Error('New runs need a nonexistent directory; existing runs require --resume and their manifest');
if (!continuing) {
  mkdirSync(dirname(directory), { recursive: true, mode: 0o700 });
  // Exclusive directory creation prevents two initializers from creating two Drafts.
  mkdirSync(directory, { mode: 0o700 });
}
function writeJson(path, value) {
  writeFileSync(path + '.tmp', JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
  renameSync(path + '.tmp', path);
}
const digest = sourceDigest();
const manifest = continuing ? JSON.parse(readFileSync(manifestPath, 'utf8'))
  : { experiment: randomUUID(), target: `stripe-sandbox:${account}`, credentialDigest: requestKey(secret), sampleSourceDigest: digest };
if (manifest.target !== `stripe-sandbox:${account}` || manifest.credentialDigest !== requestKey(secret) || manifest.sampleSourceDigest !== digest) {
  throw new Error('Keep the same target, credential and sample source when resuming this example');
}
writeJson(manifestPath, manifest);
const tracePath = join(directory, 'trace.json');
const report = continuing && existsSync(tracePath) ? JSON.parse(readFileSync(tracePath, 'utf8'))
  : { runtime: process.version, startedAt: new Date().toISOString(), sampleSourceDigest: digest, http: [], calls: [] };
const save = () => writeJson(tracePath, report);
const request = createTransport(secret, response => { report.http.push(response); save(); });
const executor = createCatalogExecutor({ request, experiment: manifest.experiment, target: manifest.target, loseAnnualReceipt: true });
let engine;
function open() { engine = createStagedWrite({ definitions: [definition], executors: [executor], ...createSqliteBackend(join(directory, 'state.sqlite')) }); }
async function call(method, input, action) {
  const from = report.http.length;
  const output = await action();
  report.calls.push({ method, input, output, httpFrom: from, httpTo: report.http.length }); save();
  console.log(JSON.stringify({ method, state: output.state ?? output.status, version: output.version }));
  return output;
}
async function reopen() { await engine.close(); open(); report.reopens = (report.reopens ?? 0) + 1; save(); }
open();
try {
  if (!manifest.draftId) {
    if (continuing) throw new Error('Initialization interrupted before recording Draft identity; no publish was started. Inspect the local database.');
    const initial = initialIntent(manifest.experiment);
    const draft = await call('create', [selector, initial], () => engine.create(selector, initial));
    manifest.draftId = draft.id; writeJson(manifestPath, manifest);
  }
  let draft = await engine.getDraft(manifest.draftId);
  let run;
  if (!draft.currentRunId) {
    const check = await call('preflight', [draft.id], () => engine.preflight(draft.id));
    assert.equal(check.status, 'passed');
    manifest.certificate = check.certificate; writeJson(manifestPath, manifest);
    run = await call('publish', [draft.id, check.certificate], () => engine.publish(draft.id, check.certificate));
  } else {
    run = await engine.getRun(draft.currentRunId);
  }
  const runId = run.id;
  const beforeRepeat = report.http.length;
  const observed = await call('publish-observe', [draft.id, manifest.certificate], () => engine.publish(draft.id, manifest.certificate));
  assert.equal(observed.id, runId); assert.equal(report.http.length, beforeRepeat);
  // The sample caller explicitly chooses the documented HKD repair. No LLM is called.
  for (let turn = 0; turn < 4 && run.state !== 'published'; turn++) {
    draft = await engine.getDraft(draft.id);
    if (run.state === 'blocked') {
      if (draft.graph.nodes.monthly.fields.currency !== 'zzz' || !run.diagnostics.some(d => d.code === 'STRIPE_CURRENCY_VALIDATION')) {
        throw new Error('Unexpected refusal: inspect trace and repair the original Draft; do not create a replacement');
      }
      report.refusedKey = run.steps.find(s => s.id === 'monthly').key;
      const ops = { patches: [{ op: 'set', ref: 'monthly', scope: "canonical", path: '/currency', value: 'hkd' }] };
      await call('edit', [draft.id, draft.version, ops], () => engine.edit(draft.id, draft.version, ops));
    }
    await reopen();
    const posts = report.http.filter(r => r.method === 'POST').length;
    const prior = run.state;
    run = await call('resume', [runId], () => engine.resume(runId));
    assert.equal(run.id, runId);
    if (prior === 'unknown' && run.state === 'published') report.unknownRecoveryNoPosts = report.http.filter(r => r.method === 'POST').length === posts;
    if (run.state === 'unknown' && prior === 'unknown') throw new Error('No conclusive evidence yet. Preserve state; retry the same --state-dir with --resume later.');
  }
  assert.equal(run.state, 'published');
  const finalDraft = await call('getDraft', [draft.id], () => engine.getDraft(draft.id));
  assert.equal(finalDraft.status, 'published');
  const bindings = await call('getBindings', [draft.id], () => engine.getBindings(draft.id));
  const products = (await listAll(request, '/v1/products', {})).filter(p => p.metadata?.experiment === manifest.experiment);
  assert.equal(products.length, 1);
  const prices = await listAll(request, '/v1/prices', { product: products[0].id });
  assert.equal(prices.length, 2); assert.equal(Object.keys(bindings).length, 3);
  assert.ok([...products, ...prices].every(p => p.livemode === false && p.metadata?.experiment === manifest.experiment));
  for (const binding of Object.values(bindings)) assert.ok([...products, ...prices].some(p => p.id === binding.remoteId));
  const beforeFinalRepeat = report.http.length;
  await call('publish-after-success', [draft.id, manifest.certificate], () => engine.publish(draft.id, manifest.certificate));
  await call('resume-after-success', [runId], () => engine.resume(runId));
  assert.equal(report.http.length, beforeFinalRepeat);
  assert.ok(report.refusedKey && report.refusedKey !== run.steps.find(s => s.id === 'monthly').key);
  assert.ok(report.unknownRecoveryNoPosts); assert.ok(report.reopens >= 2);
  report.assertions = { passed: true, products: 1, prices: 2, bindings: 3, singleRun: true,
    reopenedTwice: true, repeatedPublishNoRequests: true, unknownRecoveryNoPosts: true, allTestMode: true, repairedKeyChanged: true };
  report.finishedAt = new Date().toISOString(); delete report.failure; save();
  const summaryPath = argv.find(arg => arg.startsWith('--summary='))?.slice(10);
  if (summaryPath) writeJson(resolve(summaryPath), publicSummary(report));
  console.log(JSON.stringify({ passed: true, products: 1, prices: 2, trace: tracePath }));
} catch (error) {
  report.failure = { message: error.message }; save();
  console.error(`Stopped: ${error.message}\nPreserved state: ${directory}\nContinue this directory with --resume; do not start a replacement run.`);
  process.exitCode = 1;
} finally { await engine.close(); }
