import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sourceDigest } from './report.mjs';

const recording = new URL('../../docs/testing/stripe-sandbox-result.json', import.meta.url);
const bytes = readFileSync(recording);
const digest = readFileSync(new URL('../../docs/testing/stripe-sandbox-result.sha256', import.meta.url), 'utf8').trim();
const summary = JSON.parse(bytes);
const sha256 = data => createHash('sha256').update(data).digest('hex');

function verifySource(report, currentDigest) {
  assert.equal(report.sampleSourceDigest, currentDigest,
    'Stripe sample source changed: rerun the sandbox and review a new recording; do not rewrite the historical source digest.');
}
function verifyBytes(data, expected) {
  assert.match(expected, /^[a-f0-9]{64}$/);
  assert.equal(sha256(data), expected, 'Stripe recording bytes changed; review the recording before updating its checksum.');
}
// This is the specific recorded scenario, not a general inference of execution from HTTP.
// The summary omits per-call ranges and the injected receipt loss; HTTP 200 alone cannot prove unknown.
function verifyScenario(report) {
  assert.deepEqual(Object.keys(report).sort(), ['formatVersion', 'recordedAt', 'runtime', 'sampleSourceDigest', 'scenario', 'states', 'http', 'assertions'].sort());
  assert.equal(report.formatVersion, 1);
  assert.match(report.recordedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(report.recordedAt).toISOString(), report.recordedAt);
  assert.match(report.runtime, /^v\d+\.\d+\.\d+$/);
  assert.match(report.sampleSourceDigest, /^[a-f0-9]{64}$/);
  assert.equal(report.scenario, 'Real Stripe sandbox; injected annual receipt loss; no LLM or real payment');
  assert.deepEqual(report.states, [
    { method: 'publish', state: 'blocked' },
    { method: 'resume', state: 'unknown' },
    { method: 'resume', state: 'published' },
  ]);
  assert.deepEqual(report.http, [
    { method: 'POST', path: '/v1/products', status: 200, object: 'product' },
    { method: 'POST', path: '/v1/prices', status: 400, errorType: 'invalid_request_error', errorParam: 'currency' },
    { method: 'POST', path: '/v1/prices', status: 200, object: 'price' },
    { method: 'POST', path: '/v1/prices', status: 200, object: 'price' },
    { method: 'GET', path: '/v1/prices', status: 200, object: 'list' },
    { method: 'GET', path: '/v1/products', status: 200, object: 'list' },
    { method: 'GET', path: '/v1/prices', status: 200, object: 'list' },
  ]);
  assert.deepEqual(report.assertions, {
    passed: true, products: 1, prices: 2, bindings: 3, singleRun: true, reopenedTwice: true,
    repeatedPublishNoRequests: true, unknownRecoveryNoPosts: true, allTestMode: true, repairedKeyChanged: true,
  });
}

test('recorded Stripe evidence matches the five runtime modules without credentials', () => {
  verifySource(summary, sourceDigest());
});
test('recorded Stripe evidence preserves reviewed bytes and scenario structure', () => {
  verifyBytes(bytes, digest);
  verifyScenario(summary);
});
test('Stripe evidence gate rejects a one-byte state typo and changed assertions or HTTP', () => {
  const typo = Buffer.from(bytes.toString('utf8').replace('"blocked"', '"bloc_ed"'));
  assert.notDeepEqual(typo, bytes);
  assert.throws(() => verifyBytes(typo, digest));
  // Updating only the checksum cannot conceal a semantically invalid recording.
  assert.throws(() => verifyScenario(JSON.parse(typo)));
  for (const mutate of [
    r => { r.http[1].status = 200; },
    r => { r.http.push({ method: 'POST', path: '/v1/prices', status: 200, object: 'price' }); },
    r => { r.assertions.unknownRecoveryNoPosts = false; },
    r => { r.assertions.prices = 3; },
    r => { r.states.reverse(); },
    r => { r.privateTrace = 'must not be published'; },
  ]) {
    const changed = structuredClone(summary); mutate(changed);
    assert.throws(() => verifyScenario(changed));
  }
});
test('Stripe evidence gate rejects source drift and metadata-only byte changes', () => {
  const changedDigest = `${summary.sampleSourceDigest[0] === '0' ? '1' : '0'}${summary.sampleSourceDigest.slice(1)}`;
  assert.throws(() => verifySource(summary, changedDigest));
  const changed = structuredClone(summary); changed.recordedAt = '2026-09-16T00:00:00.000Z';
  verifyScenario(changed); // A valid timestamp is not enough: the byte pin must also match.
  assert.throws(() => verifyBytes(Buffer.from(JSON.stringify(changed)), digest));
});
