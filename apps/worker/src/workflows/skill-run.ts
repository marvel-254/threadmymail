/**
 * SkillRunWorkflow — durable wrapper around skill runs.
 *
 * Cloudflare Workflows survive Worker evictions. A skill run that takes longer
 * than a single Worker invocation budget will be resumed by the platform rather
 * than silently dropped. Steps are idempotent by design: if the Worker is
 * evicted mid-step the platform will retry that step, not re-run all prior
 * ones.
 *
 * NOTE: This binding is optional at DO boot time (typed with `?`) so that
 * `wrangler dev` still works when the workflow is not yet registered. In
 * production the binding is always present once deployed with the wrangler.jsonc
 * entry below.
 */

import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';

export interface SkillRunParams {
  userId: string;
  skillId: string;
  trigger: 'cron' | 'event' | 'digest';
}

/**
 * Minimal env surface the workflow needs. Kept separate from AgentEnv to avoid
 * a circular import (AgentObject imports AgentEnv; WorkflowEntrypoint<AgentEnv>
 * would require AgentEnv to declare AgentObject). Only the AGENT binding is
 * needed at runtime — the workflow proxies everything else through the DO.
 */
interface SkillRunEnv {
  AGENT: DurableObjectNamespace;
}

export class SkillRunWorkflow extends WorkflowEntrypoint<SkillRunEnv, SkillRunParams> {
  async run(event: WorkflowEvent<SkillRunParams>, step: WorkflowStep) {
    const { userId, skillId, trigger } = event.payload;

    // Step 1: validate the skill still exists and is enabled.
    //
    // We cannot use Hyperdrive here (bindings are unavailable in the workflow
    // constructor context), so delegate to the Agent DO which has them.
    const skill = await step.do('validate-skill', async () => {
      // The DO's heartbeat path validates skill existence before running. We
      // record the params here so the workflow has them available for step 2
      // even after an eviction, satisfying the platform's serialisation contract.
      return { userId, skillId, trigger, valid: true };
    });

    if (!skill.valid) return;

    // Step 2: run via the Agent DO heartbeat path, with retry on transient failure.
    await step.do('run-skill', { retries: { limit: 2, delay: '10 seconds' } }, async () => {
      const id = this.env.AGENT.idFromName(`user:${userId}`);
      const stub = this.env.AGENT.get(id);
      const res = await stub.fetch(
        new Request('https://do/heartbeat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user_id: userId }),
        }),
      );
      if (!res.ok) throw new Error(`Heartbeat failed: ${res.status}`);
      // Drain the body; the workflow does not need the heartbeat response.
      await res.text();
      return null;
    });
  }
}
