import test from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Tools from '@deepseek-ai/dsh-tools';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import Sessions from '@deepseek-ai/dsh-session';
import Agents from '@deepseek-ai/dsh-agent';
import Loop from '@deepseek-ai/dsh-agent-loop';
import Llm, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import { createStagedWrite, createAgentTools, defineDraftType } from '../../dist/src/index.js';
import * as plugin from './plugin.mjs';
import { createSessionBindings } from './session-bindings.mjs';

function latest(options) {
  const results=options.messages.flatMap(m=>m.content).filter(b=>b.type==='tool-result');
  const block=results.at(-1);
  if (!block) return undefined;
  return JSON.parse(block.content.filter(b=>b.type==='text').map(b=>b.text).join(''));
}
class ScriptedModel extends LlmAdapter {
  constructor(actions) {super();this.actions=actions;this.requests=[];this.next=0;}
  async resolveModel(provider,id) {return {provider,id,name:id};}
  async *stream(options) {
    this.requests.push(options);
    assert.match(options.system,/StagedWrite keeps long-lived/);
    assert.match(options.system,/dsh-loop/);
    const action=this.actions[this.next++]; assert.ok(action,'unexpected model request');
    const call=action(latest(options));
    if (call) {
      const id=`mock-${this.next}`, args=JSON.stringify(call.args);
      yield {type:'block-start',index:0,blockType:'tool-call'};
      yield {type:'tool-call-delta',index:0,id,name:call.name,argumentsDelta:args};
      yield {type:'block-end',index:0,block:{type:'tool-call',id,name:call.name,arguments:args}};
      yield {type:'finish',reason:{kind:'tool-calls'}};
    } else {
      yield {type:'block-start',index:0,blockType:'text'};
      yield {type:'text-delta',index:0,text:'Return control to the host.'};
      yield {type:'block-end',index:0,block:{type:'text',text:'Return control to the host.'}};
      yield {type:'finish',reason:{kind:'stop'}};
    }
  }
}

test('official DSH agent loop: pending, targeted repair, original Run across sessions, host ownership', {timeout:15000}, async()=>{
  const definition=defineDraftType({id:'dsh-loop',version:'1',nodeTypes:{note:{valueSchema:{type:'object',properties:{title:{type:'string'}},additionalProperties:false}}},relationTypes:{}});
  const selector={type:definition.id,typeVersion:definition.version};
  let pending=true,writes=0,draftId,ref,version,runId;
  const engine=createStagedWrite({definitions:[definition],rules:[{...selector,id:'title',version:'1',check:d=>Object.values(d.graph.nodes).filter(n=>n.fields.title==='bad').map(n=>({code:'TITLE',path:`/nodes/${n.id}/fields/title`,message:'The title is a placeholder.',hint:'Use the user choice.'}))}],asyncRules:[{...selector,id:'pending',version:'1',check:async()=>pending?{status:'pending',message:'Waiting for validation'}:{status:'complete',diagnostics:[]}}],executors:[{...selector,id:'mock',version:'1',target:'mock',plan:d=>Object.values(d.graph.nodes).map(n=>({id:n.id,payload:{title:n.fields.title},effect:{kind:'create',nodeId:n.id}})),apply:async step=>{writes++;return step.payload.title==='local'?{kind:'not_applied',reason:'Reserved',diagnostics:[{code:'RESERVED',path:`/nodes/${step.id}/fields/title`,message:'This title is reserved.',hint:'Use the user fallback.'}]}:{kind:'unknown',reason:'Mock receipt lost'};},reconcile:async step=>({kind:'applied',remoteRef:`mock:${step.id}`})}]});
  const owners=new Map(); // Test-only; production host must persist ownership.
  const toolsForPrincipal=principal=>{
    const agent=createAgentTools({engine,definition,authorize:r=>r.tool==='stagedwrite_create'||owners.get(r.input.draftId)===principal});
    return {...agent,dispatch:async(name,args)=>{const r=await agent.dispatch(name,args);if(r.ok&&name==='stagedwrite_create') owners.set(r.data.draftId,principal);return r;}};
  };
  const check=()=>({name:'stagedwrite_preflight',args:{draftId}});
  const edit=title=>({name:'stagedwrite_edit',args:{draftId,expectedVersion:version,batch:{patches:[{op:'set',ref,scope:'canonical',path:'/title',value:title}]}}});
  const publish=r=>{assert.ok(r.ok);assert.equal(r.data.status,'passed');return {name:'stagedwrite_publish',args:{draftId,certificate:r.data.certificate}};};
  const model=new ScriptedModel([
    ()=>({name:'stagedwrite_create',args:{initialIntent:{roots:[{nodeType:'note',fields:{title:'bad'}}]}}}),
    r=>{assert.ok(r.ok);draftId=r.data.draftId;ref=r.data.createdRefs[0].ref;version=r.data.version;return check();},
    r=>{assert.equal(r.data.status,'pending');return null;},
    ()=>check(),
    r=>{assert.equal(r.data.status,'blocked');assert.equal(r.data.diagnostics[0].path,`/nodes/${ref}/fields/title`);return edit('local');},
    r=>{version=r.data.version;return check();},publish,
    r=>{assert.equal(r.data.state,'blocked');assert.equal(r.data.diagnostics[0].code,'RESERVED');runId=r.data.runId;return edit('final');},
    r=>{version=r.data.version;return check();},
    r=>{assert.equal(r.data.status,'passed');return {name:'stagedwrite_resume',args:{draftId,runId}};},
    r=>{assert.equal(r.data.state,'unknown');assert.equal(r.data.runId,runId);return null;},
    ()=>({name:'stagedwrite_resume',args:{draftId,runId}}),
    r=>{assert.equal(r.data.state,'published');assert.equal(r.data.runId,runId);return null;}
  ]);
  const ctx=new Context(),handles=[],fibers=[];
  try {
    for (const [p,c] of [[Llm,{}],[Sessions,{}],[SystemPrompt,{}],[Tools,{}],[Agents,{}],[Loop,{agents:[]}]]) {const f=ctx.plugin(p,c);fibers.push(f);await f;}
    ctx.llm.registerAdapter(['mock'],model);
    const bindings=createSessionBindings({registry:ctx.agents,toolsForPrincipal});
    const f=ctx.plugin(plugin,{toolset:toolsForPrincipal('vocabulary-only'),forExecution:e=>bindings.forExecution(e)});fibers.push(f);await f;
    const a=await ctx.agents.create({sessionId:'session-a',agentOptions:{provider:'mock',model:'mock'}});handles.push(a);bindings.bind(a.agent,'alice');
    const send=async agent=>{agent.followup(createUserMessage({content:[{type:'text',text:'Use local, then final if reserved. Continue the same Draft.'}],source:{kind:'user'}}));await agent.whenIdle();};
    await send(a.agent);assert.equal(model.next,3);assert.equal(writes,0);
    pending=false;await send(a.agent);assert.equal(model.next,11);assert.equal(writes,2);assert.ok(runId);
    const b=await ctx.agents.create({sessionId:'session-b',agentOptions:{provider:'mock',model:'mock'}});handles.push(b);
    const invoke=agent=>ctx.tools.execute({agent,name:'stagedwrite_context',arguments:{draftId},callId:'ownership-check',signal:new AbortController().signal});
    let denied=await invoke(b.agent);assert.equal(denied.value.error.code,'TOOL_NOT_AUTHORIZED');
    const unbind=bindings.bind(b.agent,'bob');denied=await invoke(b.agent);assert.equal(denied.value.error.code,'TOOL_NOT_AUTHORIZED');unbind();
    // Same routing ID on a forged object is not enrollment.
    await assert.rejects(bindings.forExecution({agent:{id:a.agent.id}}),/SESSION_NOT_AUTHENTICATED/);
    await a.dispose();await assert.rejects(bindings.forExecution({agent:a.agent}),/SESSION_NOT_AUTHENTICATED/);
    bindings.bind(b.agent,'alice');await send(b.agent);assert.equal(model.next,13);assert.equal(writes,2);
    assert.equal((await engine.getRun(runId)).state,'published');assert.equal(owners.size,1);
    const repeated=await ctx.tools.execute({agent:b.agent,name:'stagedwrite_resume',arguments:{draftId,runId},callId:'repeat-success',signal:new AbortController().signal});
    assert.equal(repeated.value.data.state,'published');assert.equal(writes,2);
  } finally {for(const h of handles.reverse())await h.dispose();for(const f of fibers.reverse())await f.dispose();await engine.close();}
});

test('revoking host enrollment while loading tools prevents use of a stale authorization', async()=>{
  const agent={id:'routing-id'},registry={get:()=>agent};
  let release;
  const bindings=createSessionBindings({registry,toolsForPrincipal:()=>new Promise(r=>{release=r;})});
  const revoke=bindings.bind(agent,'alice');
  const pending=bindings.forExecution({agent});revoke();release({});
  await assert.rejects(pending,/SESSION_AUTHORIZATION_CHANGED/);
});
