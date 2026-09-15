import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const root = dirname(dirname(fileURLToPath(import.meta.url)));
const dir = mkdtempSync(join(tmpdir(), 'sw-package-'));
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
try {
  const packed = JSON.parse(execFileSync(npm, ['pack', '--json', '--pack-destination', dir], { cwd: root, encoding: 'utf8' }))[0];
  assert.ok(packed.files.some(f => f.path === 'dist/src/index.js'));
  assert.ok(packed.files.some(f => f.path === 'dist/src/index.d.ts'));
  assert.ok(!packed.files.some(f => /^(tests|examples|scripts|node_modules)\//.test(f.path) || /^dist\/(tests|examples)\//.test(f.path)));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(dir, packed.filename)], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import { createLegacyStagedWrite } from 'stagedwrite';
const definition={id:'consumer',version:'1',nodeTypes:{item:{valueSchema:{type:'object',properties:{},additionalProperties:false}}},relationTypes:{}};
const calls=[];
const options={definitions:[definition],mode:'executable',storage:{kind:'sqlite',path:'consumer.sqlite'},executors:[{type:'consumer',typeVersion:'1',id:'mock',version:'1',target:'mock',plan:()=>[{id:'one',payload:{}}],apply:async s=>{calls.push(s.id);return {kind:'applied',remoteRef:'remote-one'}},reconcile:{unsupported:'fixture'}}]};
let e=createLegacyStagedWrite(options);const d=e.create({type:'consumer',typeVersion:'1'});e.edit(d.id,0,[{op:'node.add',id:'one',nodeType:'item'}]);const check=e.preflight(d.id);e.close();e=createLegacyStagedWrite(options);const run=await e.publish(d.id,check.certificate);assert.equal(run.state,'published');e.close();e=createLegacyStagedWrite(options);assert.deepEqual(e.getRun(run.id),run);assert.deepEqual(calls,['one']);assert.deepEqual(await e.publish(d.id,check.certificate,{runId:run.id}),run);assert.equal(e.getRunInput(run.id).draft.id,d.id);const second=await e.publish(d.id,check.certificate,{runId:'second'});assert.notEqual(second.id,run.id);assert.deepEqual(calls,['one','one']);e.close();
`);
  execFileSync(process.execPath, ['consumer.mjs'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'managed.mjs'), `
import assert from 'node:assert/strict';
import {createStagedWrite,createSqliteBackend} from 'stagedwrite';
const definition={id:'managed',version:'1',nodeTypes:{task:{valueSchema:{type:'object',properties:{name:{type:'string'}},additionalProperties:false},requiredAtPublish:['name']}},relationTypes:{}};
const selector={type:'managed',typeVersion:'1'};let sends=0;
const executor={...selector,id:'mock',version:'1',target:'managed:test',plan:d=>Object.values(d.graph.nodes).map(n=>({id:n.id,payload:n.fields,effect:{kind:'create',nodeId:n.id}})),apply:async()=>{sends++;return{kind:'applied',remoteRef:'managed-one'}},reconcile:async()=>({kind:'unknown',reason:'fixture'})};
const open=()=>createStagedWrite({definitions:[definition],executors:[executor],...createSqliteBackend('managed.sqlite')});
let e=open();const d=await e.create(selector,{nodes:{one:{id:'one',nodeType:'task',fields:{name:'initial'}}},edges:{}});
await e.edit(d.id,0,[{op:'set',nodeId:'one',path:'/name',value:'changed'}]);await e.edit(d.id,1,[{op:'reset',nodeId:'one',path:'/name'}]);assert.equal((await e.getDraft(d.id)).graph.nodes.one.fields.name,'initial');
const c=await e.preflight(d.id);const r=await e.publish(d.id,c.certificate);await e.close();e=open();assert.equal((await e.getDraft(d.id)).currentRunId,r.id);assert.equal((await e.resume(r.id)).state,'published');assert.equal((await e.publish(d.id,c.certificate)).id,r.id);assert.equal(sends,1);await e.close();
`);
  execFileSync(process.execPath, ['managed.mjs'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'consumer.mts'), `import { createLegacyStagedWrite, type ExecutableGraphEngine, type ImportConfirmedRequest, type PublishOptions, type RunInput } from 'stagedwrite';\nconst factory: typeof createLegacyStagedWrite = createLegacyStagedWrite;\nconst request: ImportConfirmedRequest = {requestId:'one',expectedSequence:0,actor:'consumer',evidence:'receipt',purpose:'independent',independentWork:true};\nfunction check(engine: ExecutableGraphEngine) { return engine.importConfirmed('source', request); }\nconst options: PublishOptions = {runId:'consumer'};\nfunction publish(engine: ExecutableGraphEngine): Promise<unknown> { const input: RunInput = engine.getRunInput('consumer'); return engine.publish(input.draft.id, input.certificate, options); }\nvoid factory; void check; void publish;\n`);
  writeFileSync(join(dir, 'managed.mts'), `import {createStagedWrite,createMemoryBackend,type ManagedDraft,type ManagedExecutor,type DraftLease,type ManagedStore} from 'stagedwrite';\nconst e=createStagedWrite({definitions:[],...createMemoryBackend()});\nfunction check(d:ManagedDraft,x:ManagedExecutor,l:DraftLease,s:ManagedStore){const name=d.graph.nodes.one?.fields.name;return [name,x.plan(d),l.fence,s.namespace];}\nvoid e;void check;\n`);
  // The compiler comes from the checkout; module/type resolution occurs in the consumer directory.
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', 'consumer.mts', 'managed.mts'], { cwd: dir, stdio: 'pipe' });
  const installed = JSON.parse(readFileSync(join(dir, 'node_modules/stagedwrite/package.json'), 'utf8'));
  console.log(JSON.stringify({ status: 'passed', version: installed.version, packageBytes: packed.size, files: packed.files.length, runtime: process.version, checks: ['tarball contents', 'isolated install', 'package-name import', 'SQLite reopen', 'public TypeScript declarations', 'managed reset and single-run SQLite lifecycle'] }, null, 2));
} finally { rmSync(dir, { recursive: true, force: true }); }
