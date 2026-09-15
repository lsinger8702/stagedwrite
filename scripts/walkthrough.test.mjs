import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyTrace, verifyArtifacts, zipFiles } from './walkthrough-artifacts.mjs';
const trace = JSON.parse(readFileSync(new URL('../docs/examples/publish-resume-trace.json', import.meta.url), 'utf8'));

test('walkthrough: fresh real execution matches committed semantics', () => {
  const fresh = JSON.parse(readFileSync(new URL('../dist/walkthrough-raw.json', import.meta.url), 'utf8'));
  assert.notEqual(fresh.recordedAt, trace.recordedAt);
  assert.notEqual(fresh.steps[0].output.id, trace.steps[0].output.id);
  verifyTrace(trace, fresh);
});

test('walkthrough: changed diagnostics, versions, effects and business dates fail verification', () => {
  for (const mutate of [
    t => { t.steps.find(s => s.method === 'preflight').output.diagnostics[0].message += ' changed'; },
    t => { t.steps.find(s => s.method === 'edit').output.version++; },
    t => { t.effects.pop(); },
    t => { t.steps[0].output.graph.nodes['project-1'].fields.name = 'changed'; },
    t => { t.steps[0].output.graph.nodes['project-1'].fields.createdAt = '2027-01-01T00:00:00.000Z'; },
    t => { t.steps.reverse(); },
    t => { t.steps.find(s => s.method === 'edit').input[0] = '11111111-1111-4111-8111-111111111111'; },
  ]) {
    const changed = structuredClone(trace); mutate(changed);
    assert.throws(() => verifyTrace(trace, changed));
  }
});

test('walkthrough: normalization does not hide changed identity relationships', () => {
  const changed = structuredClone(trace);
  const checks = changed.steps.filter(s => s.method === 'preflight');
  checks[1].output.checkId = checks[0].output.checkId;
  assert.throws(() => verifyTrace(trace, changed));
});

test('walkthrough: stale or missing generated artifacts fail the byte gate', () => {
  const expected = [['index.html', 'current template'], ['download.zip', Buffer.from([1, 2, 3])]];
  const originals = new Map(expected);
  verifyArtifacts(expected, name => originals.get(name));
  for (const [bad] of expected) {
    assert.throws(() => verifyArtifacts(expected, name => name === bad ? Buffer.from('stale') : originals.get(name)), /is stale/);
  }
  assert.throws(() => verifyArtifacts(expected, () => { throw Error('missing'); }), /missing/);
});

test('walkthrough: ZIP bytes and embedded HTML, JSON and Markdown match checked-in files', () => {
  const read = name => readFileSync(new URL(`../docs/examples/${name}`, import.meta.url));
  const entries = [['stagedwrite.html', read('publish-resume.html')], ['actual-input-output.json', read('publish-resume-trace.json')], ['walkthrough.md', read('publish-resume-walkthrough.md')]];
  const expected = zipFiles(entries);
  assert.deepEqual(expected, zipFiles(entries));
  assert.deepEqual(read('stagedwrite-walkthrough.zip'), expected);
  let offset = 0;
  for (const [name, content] of entries) {
    assert.equal(expected.readUInt32LE(offset), 0x04034b50);
    const size = expected.readUInt32LE(offset + 18), length = expected.readUInt16LE(offset + 26);
    assert.equal(expected.subarray(offset + 30, offset + 30 + length).toString(), name);
    assert.deepEqual(expected.subarray(offset + 30 + length, offset + 30 + length + size), content);
    offset += 30 + length + size;
  }
});
