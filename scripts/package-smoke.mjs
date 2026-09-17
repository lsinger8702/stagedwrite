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
  assert.ok(!packed.files.some(f => /dist\/src\/(engine|draft|graph-engine)\.|dist\/src\/(storage|adapters)\/|dist\/src\/execution\/(runtime|graph|continuation|import-confirmed|adjudication|recovery|stop-retry|repair)\./.test(f.path)), 'removed implementations must not survive in the tarball');
  assert.ok(!packed.files.some(f => /^(tests|examples|scripts|node_modules)\//.test(f.path) || /^dist\/(tests|examples)\//.test(f.path)));
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
  execFileSync(npm, ['install', '--ignore-scripts', '--no-audit', '--no-fund', join(dir, packed.filename)], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'managed.mjs'), `
import assert from 'node:assert/strict';
import * as api from 'stagedwrite';
import {Ajv2020} from 'ajv/dist/2020.js';
const {createStagedWrite,createSqliteBackend,editBatchSchema,initialIntentSchema}=api;
assert.ok(Object.isFrozen(editBatchSchema.$defs.field));assert.equal(initialIntentSchema.properties.roots.minItems,1);
assert.deepEqual(Object.keys(api).sort(),['DefinitionAssemblyError','EditInputError','createMemoryBackend','createSqliteBackend','createStagedWrite','createAgentTools','defineDraftType','editBatchSchema','initialIntentSchema'].sort());
const ajv=new Ajv2020({strict:false});const checkInitial=ajv.compile(initialIntentSchema),checkBatch=ajv.compile(editBatchSchema);
assert.ok(checkInitial({roots:[{nodeType:"task",fields:{name:"initial"}}]}));assert.equal(checkInitial({roots:[{ref:"one"}]}),false);
assert.ok(checkBatch({patches:[{op:"reset",ref:"one",scope:"canonical",path:"/name"}]}));assert.equal(checkBatch({patches:[{op:"reset",ref:"one",path:"/name"}]}),false);
const definition={id:'managed',version:'1',nodeTypes:{task:{valueSchema:{type:'object',properties:{name:{type:'string'}},additionalProperties:false},requiredAtPublish:['name']}},relationTypes:{}};
const selector={type:'managed',typeVersion:'1'};let sends=0;
const executor={...selector,id:'mock',version:'1',target:'managed:test',plan:d=>Object.values(d.graph.nodes).map(n=>({id:n.id,payload:n.fields,effect:{kind:'create',nodeId:n.id}})),apply:async()=>{sends++;return{kind:'applied',remoteRef:'managed-one'}},reconcile:async()=>({kind:'unknown',reason:'fixture'})};
const open=()=>createStagedWrite({definitions:[definition],executors:[executor],...createSqliteBackend('managed.sqlite')});
let e=open();const {draft:d,createdRefs}=await e.create(selector,{roots:[{nodeType:'task',fields:{name:'initial'}}]});const ref=createdRefs[0].ref;assert.equal(createdRefs[0].path,'/roots/0');
const agent=api.createAgentTools({engine:e,definition,authorize:r=>r.tool!=='stagedwrite_create'&&r.input.draftId===d.id});const view=await agent.invoke('stagedwrite_context',{draftId:d.id});assert.equal(view.ok,true);assert.equal(view.data.preview.nodes[ref].fields['/name'].value,'initial');assert.equal(agent.tools.length,7);
const edit=await e.edit(d.id,0,{patches:[{op:'set',ref,scope:'canonical',path:'/name',value:'changed'}]});assert.deepEqual(Object.keys(edit).sort(),['changes','createdRefs','draftId','preflightRequired','version']);assert.equal(edit.draftId,d.id);assert.equal(edit.preflightRequired,true);await e.edit(d.id,1,{patches:[{op:'reset',ref,scope:'canonical',path:'/name'}]});assert.equal((await e.getDraft(d.id)).graph.nodes[ref].fields.name,'initial');
const c=await e.preflight(d.id);const r=await e.publish(d.id,c.certificate);await e.close();e=open();assert.equal((await e.getDraft(d.id)).currentRunId,r.id);assert.equal((await e.resume(r.id)).state,'published');assert.equal((await e.publish(d.id,c.certificate)).id,r.id);assert.equal(sends,1);await e.close();
`);
  execFileSync(process.execPath, ['managed.mjs'], { cwd: dir, stdio: 'pipe' });
  writeFileSync(join(dir, 'managed.mts'), `import {createStagedWrite,createMemoryBackend,type ManagedEditResult,type ManagedDraft,type ManagedExecutor,type DraftLease,type ManagedStore,createAgentTools,editBatchSchema,initialIntentSchema} from 'stagedwrite';\nconst e=createStagedWrite({definitions:[],...createMemoryBackend()});\nfunction check(d:ManagedDraft,x:ManagedExecutor,l:DraftLease,s:ManagedStore){const name=d.graph.nodes.one?.fields.name;return [name,x.plan(d),l.fence,s.namespace];}\nconst edit: Promise<ManagedEditResult> = e.edit("draft", 0, {patches:[]});\nconst agent = createAgentTools({engine:e,definition:{id:"d",version:"1",nodeTypes:{t:{valueSchema:{type:"object",properties:{},additionalProperties:false}}},relationTypes:{}},authorize:()=>false}); const ctx=agent.invoke("stagedwrite_context",{draftId:"d"}); void ctx; void edit;void e;void check;void editBatchSchema;void initialIntentSchema;\n`);
  // The compiler comes from the checkout; module/type resolution occurs in the consumer directory.
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--noEmit', '--strict', '--module', 'NodeNext', '--target', 'ES2022', 'managed.mts'], { cwd: dir, stdio: 'pipe' });
  const installed = JSON.parse(readFileSync(join(dir, 'node_modules/stagedwrite/package.json'), 'utf8'));
  console.log(JSON.stringify({ status: 'passed', version: installed.version, packageBytes: packed.size, files: packed.files.length, runtime: process.version, checks: ['tarball excludes removed implementations', 'single public engine', 'isolated install', 'package-name import', 'SQLite reopen', 'public TypeScript declarations', 'managed reset and single-run SQLite lifecycle'] }, null, 2));
} finally { rmSync(dir, { recursive: true, force: true }); }
