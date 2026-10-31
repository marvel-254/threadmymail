/** Durable Object id helpers. Per-user objects own sessions, kill switch and
 *  the mail cursor. The hub (`main`) owns the parked schedule the cron reads. */

export const HUB_NAME = 'main';

export function userAgentName(userId: string): string {
  return `user:${userId}`;
}

/** Structural so both `Env.AGENT` (AgentObject) and Hono `Bindings.AGENT` type-check. */
type AgentNs = {
  idFromName(name: string): DurableObjectId;
  get(id: DurableObjectId): DurableObjectStub;
};

export function userAgent(env: { AGENT: AgentNs }, userId: string): DurableObjectStub {
  return env.AGENT.get(env.AGENT.idFromName(userAgentName(userId)));
}

export function hubAgent(env: { AGENT: AgentNs }): DurableObjectStub {
  return env.AGENT.get(env.AGENT.idFromName(HUB_NAME));
}
