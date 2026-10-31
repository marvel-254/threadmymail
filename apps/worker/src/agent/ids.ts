/** Durable Object id helpers. Per-user objects own sessions, kill switch and
 *  the mail cursor. The hub (`main`) owns the parked schedule the cron reads. */

export const HUB_NAME = 'main';

export function userAgentName(userId: string): string {
  return `user:${userId}`;
}

export function userAgent<T>(
  env: { AGENT: DurableObjectNamespace<T> },
  userId: string,
): DurableObjectStub<T> {
  return env.AGENT.get(env.AGENT.idFromName(userAgentName(userId)));
}

export function hubAgent<T>(env: { AGENT: DurableObjectNamespace<T> }): DurableObjectStub<T> {
  return env.AGENT.get(env.AGENT.idFromName(HUB_NAME));
}
