import { performance } from 'node:perf_hooks';
import { cpus, platform, arch, tmpdir } from 'node:os';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createLegacyStagedWrite } from '../dist/src/index.js';
const full = process.argv.includes('--full');
const selector = { type: 'bench', typeVersion: '1' };
const definition = { id: 'bench', version: '1', nodeTypes: { item: { valueSchema: { type: 'object', properties: { value: { type: 'number' } }, additionalProperties: false } } }, relationTypes: {} };
const results = [];
for (const nodes of (full ? [100, 1000, 10000] : [100, 1000])) for (const ruleCount of (full ? [0, 10, 100] : [0, 10])) for (const diagnostics of (ruleCount ? [false, true] : [false])) {
  const rules = Array.from({ length: ruleCount }, (_, i) => ({ ...selector, id: `rule-${i}`, version: '1', check: () => diagnostics ? [{ code: 'value', path: '/nodes/n0/fields/value', message: 'Value is undeclared on n0.', hint: 'Choose a value consistent with user intent.' }] : [] }));
  const engine = createLegacyStagedWrite({ definitions: [definition], rules }); const draft = engine.create(selector);
  engine.edit(draft.id, 0, Array.from({ length: nodes }, (_, i) => ({ op: 'node.add', id: `n${i}`, nodeType: 'item' })));
  engine.preflight(draft.id); const times = [];
  for (let i = 0; i < 5; i++) { const begin = performance.now(); engine.preflight(draft.id); times.push(performance.now() - begin); }
  times.sort((a, b) => a - b);
  results.push({ nodes, rules: ruleCount, diagnosticsPerRule: Number(diagnostics), samples: 5, medianMs: +times[2].toFixed(2), maxMs: +times[4].toFixed(2), heapUsedMiB: +(process.memoryUsage().heapUsed / 1048576).toFixed(2) }); engine.close();
}
const storage = [];
for (const generations of [1, 10, 100]) {
  const dir = mkdtempSync(join(tmpdir(), 'sw-capacity-')), path = join(dir, 'data.sqlite');
  try {
    const e = createLegacyStagedWrite({ definitions: [definition], mode: 'executable', storage: { kind: 'sqlite', path }, executors: [{ ...selector, id: 'bench', version: '1', target: 'mock', plan: () => [{ id: 'one', payload: {} }], apply: async () => ({ kind: 'not_applied', reason: 'fixture refusal' }), reconcile: { unsupported: 'fixture' } }] });
    let d = e.create(selector); d = e.edit(d.id, 0, [{ op: 'node.add', id: 'root', nodeType: 'item' }]);
    for (let g = 0; g < generations; g++) {
      d = e.edit(d.id, d.version, Array.from({ length: 10 }, (_, i) => [{ op: 'node.add', id: `retired-${g}-${i}`, nodeType: 'item' }, { op: 'node.remove', id: `retired-${g}-${i}` }]).flat());
      const run = await e.publish(d.id, e.preflight(d.id).certificate); if (g < generations - 1) d = e.revise(run.id);
    }
    const drafts = e.listDraftIds().length; e.close();
    storage.push({ generations, drafts, deletedIdsPerGeneration: 10, finalTombstones: d.tombstones.nodes.length, databaseBytesAfterClose: statSync(path).size });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
console.log(JSON.stringify({ measuredAt: new Date().toISOString(), runtime: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, mode: full ? 'full' : 'quick', notes: 'One warmup, five samples. max is not a stable p95. Heap is a process snapshot, not a per-case peak; no forced GC. Storage fixture grows tombstones via zero-effect revisions.', preflight: results, storage }, null, 2));
