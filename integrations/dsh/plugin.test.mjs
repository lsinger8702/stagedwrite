import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import { createStagedWrite, createAgentTools, defineDraftType } from '../../dist/src/index.js';
import * as plugin from './plugin.mjs';

test('official DSH registers seven tools, runs A1 checks, and disposes registrations', async () => {
  const definition = defineDraftType({ id:'dsh-note', version:'1', nodeTypes:{ note:{ valueSchema:{type:'object',properties:{title:{type:'string'}},additionalProperties:false} } }, relationTypes:{} });
  const engine=createStagedWrite({definitions:[definition]});
  const agent=createAgentTools({engine,definition,authorize:()=>true});
  const ctx=new Context(); const fibers=[];
  try {
    const system=ctx.plugin(SystemPrompt, {}); fibers.push(system); await system;
    const runtime=ctx.plugin(Tools, {mode:'native'}); fibers.push(runtime); await runtime;
    const fork=ctx.plugin(plugin,{toolset:agent,forExecution:async()=>agent});
    fibers.push(fork); await fork;
    assert.equal(ctx.tools.schemas().length,7);
    const signal=new AbortController().signal;
    const invoke=async(name,args)=>{
      const result=await ctx.tools.execute({name,arguments:args,signal,callId:`test-${name}`});
      assert.equal(result.isError,false,JSON.stringify(result));
      return result.value;
    };
    const created=await invoke('stagedwrite_create',{initialIntent:{roots:[{nodeType:'note',fields:{title:'Initial'}}]}});
    assert.equal(created.ok,true);
    const draftId=created.data.draftId;
    const bad=await invoke('stagedwrite_edit',{draftId,expectedVersion:-1,batch:{patches:[]}});
    assert.equal(bad.ok,false); assert.equal(bad.error.code,'INVALID_TOOL_INPUT'); assert.ok(bad.error.message&&bad.error.hint);
    const view=await invoke('stagedwrite_context',{draftId}); assert.equal(view.ok,true);
    await fork.dispose();
    assert.equal(ctx.tools.schemas().length,0);
  } finally {for (const fiber of fibers.reverse()) await fiber.dispose(); await engine.close();}
});

test('registration rollback and host identity failure do not dispatch or leak raw errors', async () => {
  const definition=defineDraftType({id:'bound',version:'1',nodeTypes:{t:{valueSchema:{type:'object',properties:{},additionalProperties:false}}},relationTypes:{}});
  const engine=createStagedWrite({definitions:[definition]});
  let calls=0;
  const toolset=createAgentTools({engine,definition,authorize:()=>{calls++;return true;}});
  const registry=new Map(); let registered=0;
  const ctx={tools:{register(tool){if (++registered===3) throw Error('collision');registry.set(tool.name,tool);return ()=>registry.delete(tool.name);}}};
  try {
    assert.throws(()=>plugin.apply(ctx,{toolset,forExecution:()=>toolset}),/collision/);
    assert.equal(registry.size,0);
    registered=-100;
    let hostError;
    plugin.apply(ctx,{toolset,forExecution:()=>{throw Error('PRIVATE_HOST_DETAIL');},onError:e=>{hostError=e;}});
    const r=await registry.get('stagedwrite_context').execute({draftId:'other'}, {signal:new AbortController().signal});
    assert.equal(r.error.code,'TOOL_NOT_AUTHORIZED');assert.equal(calls,0);
    assert.doesNotMatch(JSON.stringify(r),/PRIVATE_HOST_DETAIL/);assert.equal(hostError.message,'PRIVATE_HOST_DETAIL');
  } finally {await engine.close();}
});
