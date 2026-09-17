import type { createAgentTools } from "../src/index.js";
type Tools = ReturnType<typeof createAgentTools>;
/** Object-based function registry: adapt execute to the host's own tool API. */
export function functionHost(agent: Tools) {
  return new Map(agent.tools.map(tool => [tool.name, { ...tool, execute: (args: unknown) => agent.dispatch(tool.name, args) }]));
}
/** Serialized tool messages: call IDs belong to this transport, not Draft/Run identity. */
export function messageHost(agent: Tools) {
  return async (call: { callId: string; name: string; argumentsJson: string }) => {
    let args: unknown;
    try { args = JSON.parse(call.argumentsJson); } catch { args = call.argumentsJson; }
    return { callId: call.callId, resultJson: JSON.stringify(await agent.dispatch(call.name, args)) };
  };
}
