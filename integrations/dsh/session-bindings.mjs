/** Host enrollment of live Agent objects. Session IDs are routing identities, not credentials. */
export function createSessionBindings({ registry, toolsForPrincipal }) {
  const enrolled = new WeakMap();
  return {
    bind(agent, principal) {
      if (!agent || registry.get(agent.id) !== agent || typeof principal !== 'string' || !principal.trim()) throw Error('INVALID_HOST_SESSION_BINDING');
      if (enrolled.has(agent)) throw Error('SESSION_ALREADY_BOUND');
      const entry = { principal }; enrolled.set(agent, entry);
      return () => { if (enrolled.get(agent) === entry) enrolled.delete(agent); };
    },
    async forExecution(execution) {
      const agent = execution.agent, entry = agent && enrolled.get(agent);
      if (!entry || registry.get(agent.id) !== agent) throw Error('SESSION_NOT_AUTHENTICATED');
      const tools = await toolsForPrincipal(entry.principal);
      // Revocation/disposal may race asynchronous credential loading.
      if (enrolled.get(agent) !== entry || registry.get(agent.id) !== agent) throw Error('SESSION_AUTHORIZATION_CHANGED');
      return tools;
    }
  };
}
