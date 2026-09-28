/**
 * Meta tools — the agent's capability to reason about its own operation.
 *
 * These are what make it an agent rather than a pipeline:
 *   - `delegate` spawns a subagent with a fresh context and a restricted tool set
 *   - `ask_human` is ESCALATION, not approval: the agent has already decided and
 *     is flagging the exception, not asking permission to proceed
 *   - `notify` is how it speaks when the user is not looking
 */

import { defineTool, ok, fail, ERROR } from './registry.js';
import { ChatMessage } from '../agent/model.js';

export interface DelegateResult {
  text: string;
  runId: string;
  stopReason: string;
}

export interface MetaContext {
  /** Spawn a subagent. Returns null when depth forbids further delegation. */
  delegate(args: {
    task: string;
    messages: ChatMessage[];
    toolNames: string[] | null;
    modelSlot: 'primary' | 'background';
  }): Promise<DelegateResult | null>;
  /** Depth of the current run: 0 for a top-level turn. */
  depth: number;
  maxDepth: number;
}

export function createMetaTools(meta: MetaContext) {
  return [
  defineTool({
    name: 'delegate',
    description:
      'Run a subagent on a self-contained task and return its result. Use this for work ' +
      'that is large but separable — summarizing 40 threads, researching a topic, or ' +
      'drafting several replies — so the result comes back as one summary instead of ' +
      'crowding your context. The subagent gets a FRESH context: pass it everything it ' +
      'needs in `task`, it cannot see this conversation. Constrain it with `toolNames` ' +
      'to give it fewer tools than you have. Do not delegate trivial lookups; just do them.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'A complete, self-contained brief. The subagent cannot see this conversation, ' +
            'so include every piece of context it needs.',
        },
        toolNames: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional allowlist of tool names for the subagent. Omit to inherit your tools. ' +
            'Prefer a narrow list.',
        },
        modelSlot: {
          type: 'string',
          enum: ['primary', 'background'],
          description:
            "Which model to use. 'background' for mechanical work (extraction, sorting), " +
            "'primary' for anything requiring judgement or writing.",
        },
      },
      required: ['task'],
    },
    permissions: [],
    reversible: false,
    source: 'builtin',
    execute: async (args, ctx) => {
      void ctx;
      if (meta.depth >= meta.maxDepth) {
        return fail(
          ERROR.FORBIDDEN,
          `Maximum delegation depth (${meta.maxDepth}) reached. Do this work directly instead.`,
        );
      }
      const input = args as unknown as {
        task: string;
        toolNames?: string[];
        modelSlot?: 'primary' | 'background';
      };
      const result = await meta.delegate({
        task: input.task,
        messages: [{ role: 'user', content: input.task }],
        toolNames: input.toolNames ?? null,
        modelSlot: input.modelSlot ?? 'background',
      });
      if (!result) return fail(ERROR.INTERNAL, 'The subagent could not be started.');
      return ok(
        { result: result.text, run_id: result.runId, stop_reason: result.stopReason },
        `subagent finished (${result.stopReason})`,
      );
    },
  }),

  defineTool({
    name: 'ask_human',
    description:
      'Escalate to the user: a real blocker, a conflicting priority, an irreversible ' +
      'outward action, or a question only they can answer. This is NOT permission to ' +
      'proceed — you have already decided. Ask only when genuinely stuck; a question ' +
      'costs the user your uncertainty, so spend it rarely. Do not use it for anything ' +
      'reversible.',
    parameters: {
      type: 'object',
      properties: {
        question: {
          type: 'string',
          description: 'The specific question, in one or two sentences.',
        },
        context: {
          type: 'string',
          description: 'What you already tried or considered, so they need not repeat it.',
        },
        choices: {
          type: 'array',
          items: { type: 'string' },
          description: 'Concrete options, most-recommended first. Default: ["yes", "no"].',
        },
      },
      required: ['question'],
    },
    permissions: [],
    reversible: false,
    source: 'builtin',
    execute: async (args, ctx) => {
      const input = args as unknown as { question: string; context?: string; choices?: string[] };
      ctx.emit({
        type: 'escalation',
        question: input.question,
        context: input.context ?? null,
        choices: input.choices?.length ? input.choices : ['yes', 'no'],
      });
      return ok(
        { escalated: true, question: input.question },
        'asked the user a question',
      );
    },
  }),

  defineTool({
    name: 'notify',
    description:
      'Send the user a short push or in-app notification, for when they are not watching. ' +
      'Use it sparingly — only for something that is genuinely time-sensitive and that you ' +
      'could not resolve yourself. Never use it to narrate what you are about to do, or to ' +
      'report routine progress. Silence is a valid outcome. Respect quiet_hours: if it is ' +
      'currently quiet, prefer deferring over notifying.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short, specific. Not "Update".' },
        body: { type: 'string', description: 'One sentence with the useful detail.' },
        urgency: {
          type: 'string',
          enum: ['low', 'normal', 'high'],
          description: "'high' bypasses quiet hours. Reserve it for genuinely urgent things.",
        },
        actionUrl: {
          type: 'string',
          description: 'Optional in-app route to open when tapped, e.g. "/app?thread=18f2".',
        },
      },
      required: ['title', 'body'],
    },
    permissions: ['data:email:read'],
    reversible: false,
    source: 'builtin',
    execute: async (args, ctx) => {
      const input = args as unknown as {
        title: string;
        body: string;
        urgency?: 'low' | 'normal' | 'high';
        actionUrl?: string;
      };
      await ctx.db.queryFresh(
        `INSERT INTO activity (user_id, run_id, kind, summary, reversible)
         VALUES ($1, $2, 'notification', $3, FALSE)`,
        [ctx.userId, ctx.runId, `${input.title}: ${input.body}`.slice(0, 500)],
      );
      ctx.emit({
        type: 'notification',
        title: input.title,
        body: input.body,
        urgency: input.urgency ?? 'normal',
        actionUrl: input.actionUrl ?? null,
      });
      return ok({ delivered: true }, `notified: ${input.title}`);
    },
  }),

  defineTool({
    name: 'list_skills',
    description:
      'List the automations the user has configured, with what each does and which tools it ' +
      'may use. Use this to discover what is available before invoking a named workflow ' +
      'with run_skill, or to tell the user what already exists when they ask for something ' +
      'that sounds like automation.',
    parameters: { type: 'object', properties: {}, required: [] },
    permissions: [],
    reversible: false,
    source: 'builtin',
    execute: async (_args, ctx) => {
      const rows = await ctx.db.queryFresh<{
        name: string;
        description: string | null;
        allowed_tools: string[];
        enabled: boolean;
      }>(
        `SELECT name, description, allowed_tools, enabled FROM skills
          WHERE user_id = $1 ORDER BY name`,
        [ctx.userId],
      );
      return ok({ skills: rows }, `${rows.length} skills`);
    },
  }),
  ];
}
