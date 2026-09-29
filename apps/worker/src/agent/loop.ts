/**
 * The agent loop.
 *
 * think → call tool(s) → observe → think → … → respond
 *
 * This is the product. Everything else in the codebase exists to feed it
 * context, record what it did, or bound it.
 *
 * GUARANTEES (docs/AI-SKILLS.md, ARCHITECTURE.md):
 *   1. Every tool call is written to `tool_calls` with args, result, latency.
 *   2. A skill only ever receives the tools in its `allowed_tools` — the model
 *      is never shown a tool outside that set, so injected content cannot widen
 *      reach.
 *   3. Tool permissions are checked BEFORE execution.
 *   4. The kill switch is checked before every step, not just at the start.
 *   5. The loop is capped by `max_steps` so a confused model cannot spin.
 *   6. Tool errors are returned to the model as observations, not thrown. The
 *      model should recover from a failed tool, not have the run die.
 */

import { Db } from '../db/client.js';
import { BodyStore } from '../storage/bodystore.js';
import { ToolRegistry, ToolContext, AnyTool, ToolError } from '../tools/registry.js';
import { createMetaTools, MetaContext } from '../tools/meta.js';
import { ModelClient, ChatMessage, ToolCall, CompletionUsage } from './model.js';
import { assembleSystemPrompt } from './persona.js';
import { loadAgentConfig, NormalizedSettings } from './config.js';

export interface RunInput {
  userId: string;
  messages: ChatMessage[];
  skillId: string | null;
  parentRunId: string | null;
  trigger: 'on_demand' | 'cron' | 'event' | 'manual' | 'chat';
  modelSlot: 'primary' | 'background';
  /** Depth 0 for a top-level run. Subagents increment. */
  depth?: number;
  /**
   * Subagent delegation + depth limits for this run. The meta tools (`delegate`,
   * `ask_human`, `notify`, `list_skills`) are built from it, so they are per-run
   * rather than global: a subagent's `delegate` must be bound to that subagent.
   */
  meta?: MetaContext;
  emit(frame: Record<string, unknown>): void;
  isAborted(): boolean;
}

export interface RunOutcome {
  runId: string;
  text: string;
  toolCallCount: number;
  usage: CompletionUsage;
  stopReason: 'end_turn' | 'max_steps' | 'aborted' | 'error';
  escalated: boolean;
}

export interface AgentDeps {
  db: Db;
  bodies: BodyStore;
  registry: ToolRegistry;
  model: ModelClient;
}

export class Agent {
  constructor(private deps: AgentDeps) {}

  async run(input: RunInput): Promise<RunOutcome> {
    const { db, registry, model } = this.deps;
    const depth = input.depth ?? 0;

    const settings = await loadAgentConfig(db, input.userId);
    const modelName = pickModel(settings, input.modelSlot);
    const runId = await this.startRun(input, settings, modelName);

    // Meta tools are per-run (they capture this run's delegate + depth), so the
    // registry is assembled per run rather than shared module state.
    const runRegistry = new ToolRegistry()
      .registerAll(registry.all())
      .registerAll(input.meta ? createMetaTools(input.meta) : []);

    // A skill restricts the tool set. That restriction is the security boundary.
    const toolScope = input.skillId
      ? await this.toolsForSkill(runId, input, runRegistry)
      : runRegistry.all();

    const prompt = await this.buildSystemPrompt(input, settings);

    const messages: ChatMessage[] = [
      { role: 'system', content: prompt },
      ...input.messages,
    ];

    const totals: CompletionUsage = {
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      model: modelName,
    };
    let toolCallCount = 0;
    let escalated = false;
    let stopReason: RunOutcome['stopReason'] = 'end_turn';

    try {
      for (let step = 0; step < settings.max_steps; step++) {
        // Checked every step, not just at entry: a long run must stop promptly.
        if (input.isAborted()) {
          stopReason = 'aborted';
          break;
        }

        const { message, usage } = await model.streamCompletion(
          {
            model: modelName,
            messages,
            tools: runRegistry.toFunctions(toolScope),
            temperature: settings[input.modelSlot].temperature,
            maxTokens: settings[input.modelSlot].max_tokens,
          },
          {
            onText: (delta) => input.emit({ type: 'token', run_id: runId, text: delta }),
          },
        );

        accumulate(totals, usage);
        messages.push(message);

        if (!message.tool_calls?.length) {
          input.emit({ type: 'turn_end', run_id: runId, step });
          break;
        }

        input.emit({ type: 'turn_end', run_id: runId, step, tool_calls: message.tool_calls.length });

        for (const call of message.tool_calls) {
          if (input.isAborted()) {
            stopReason = 'aborted';
            break;
          }
          const observation = await this.executeTool(call, {
            runId,
            userId: input.userId,
            skillId: input.skillId,
            scope: toolScope,
            depth,
            emit: input.emit,
            isAborted: input.isAborted,
          });
          toolCallCount++;
          if (observation.escalated) escalated = true;
          messages.push({
            role: 'tool',
            tool_call_id: call.id,
            name: call.name,
            content: observation.content,
          });
        }

        if (stopReason === 'aborted') break;
        if (step === settings.max_steps - 1) stopReason = 'max_steps';
      }

      const finalText =
        messages
          .slice()
          .reverse()
          .find((m) => m.role === 'assistant' && m.content)?.content ?? '';

      // An aborted run is a state of record, not a success: run history and
      // POST /agent/runs must be able to tell the two apart.
      await this.finishRun(
        runId,
        stopReason === 'aborted' ? 'aborted' : 'completed',
        totals,
        null,
        finalText,
      );

      return { runId, text: finalText, toolCallCount, usage: totals, stopReason, escalated };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code =
        typeof error === 'object' && error !== null && 'code' in error
          ? String((error as { code: unknown }).code)
          : 'INTERNAL';
      await this.finishRun(runId, 'failed', totals, { code, message }, null);
      input.emit({ type: 'error', run_id: runId, code, message });
      return {
        runId,
        text: '',
        toolCallCount,
        usage: totals,
        stopReason: 'error',
        escalated,
      };
    }
  }

  // ── Tool execution ────────────────────────────────────────────────────────

  private async executeTool(
    call: ToolCall,
    args: {
      runId: string;
      userId: string;
      skillId: string | null;
      scope: AnyTool[];
      depth: number;
      emit(frame: Record<string, unknown>): void;
      isAborted(): boolean;
    },
  ): Promise<{ content: string; escalated: boolean }> {
    const { db, bodies, registry } = this.deps;
    const started = Date.now();

    args.emit({ type: 'tool_call', run_id: args.runId, tool: call.name, args: call.arguments });

    const tool = args.scope.find((t) => t.name === call.name);

    if (!tool) {
      // Reached only if the model hallucinates a tool. Recorded so the failure
      // is visible in the audit trail rather than silently dropped.
      const content = JSON.stringify({
        error: {
          code: 'NOT_FOUND',
          message: `No such tool: ${call.name}. Available: ${args.scope
            .map((t) => t.name)
            .join(', ')}`,
        },
      });
      await this.logToolCall(args.runId, call, content, false, Date.now() - started, false);
      return { content, escalated: false };
    }

    const ctx: ToolContext = {
      userId: args.userId,
      db,
      bodies,
      runId: args.runId,
      skillId: args.skillId,
      model: { primary: '', background: '' },
      emit: args.emit,
      isAborted: args.isAborted,
      describe: async (action) => {
        await db.queryFresh(
          `INSERT INTO activity (user_id, run_id, kind, summary, reversible, undo_ref)
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            args.userId,
            args.runId,
            action.summary.slice(0, 40),
            action.summary,
            action.reversible ?? false,
            action.undoRef ?? null,
          ],
        );
      },
    };

    try {
      const result = await tool.execute(
        call.arguments as never,
        ctx,
      );

      const okFlag = (result as { ok: boolean }).ok === true;
      const summary = okFlag ? ((result as { summary?: string }).summary ?? 'ok') : 'failed';
      args.emit({
        type: 'tool_result',
        run_id: args.runId,
        tool: call.name,
        ok: okFlag,
        summary,
        latency_ms: Date.now() - started,
      });

      await this.logToolCall(
        args.runId,
        call,
        JSON.stringify(result),
        okFlag,
        Date.now() - started,
        tool.reversible,
      );

      return { content: JSON.stringify(result), escalated: false };
    } catch (error) {
      // A throwing tool is a bug, but it must not kill the run: the model can
      // often recover if told what happened.
      const message = error instanceof Error ? error.message : String(error);
      const content = JSON.stringify({ ok: false, error: { code: 'INTERNAL', message } });
      args.emit({
        type: 'tool_result',
        run_id: args.runId,
        tool: call.name,
        ok: false,
        summary: 'threw',
        latency_ms: Date.now() - started,
      });
      await this.logToolCall(args.runId, call, content, false, Date.now() - started, false);
      return { content, escalated: false };
    }
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private async startRun(
    input: RunInput,
    settings: NormalizedSettings,
    modelName: string,
  ): Promise<string> {
    const row = await this.deps.db.queryFresh<{ id: string }>(
      `INSERT INTO agent_runs
         (user_id, skill_id, parent_run_id, trigger, status, input, model)
       VALUES ($1, $2, $3, $4, 'running', $5, $6)
       RETURNING id`,
      [
        input.userId,
        input.skillId,
        input.parentRunId,
        input.trigger,
        JSON.stringify({ messages: input.messages.map((m) => ({ role: m.role, content: m.content.slice(0, 2000) })) }),
        modelName,
      ],
    );
    void settings;
    return row[0]?.id ?? crypto.randomUUID();
  }

  private async finishRun(
    runId: string,
    status: string,
    usage: CompletionUsage,
    error: { code: string; message: string } | null,
    output: string | null,
  ): Promise<void> {
    await this.deps.db.queryFresh(
      `UPDATE agent_runs
          SET status = $2, output = $3, tokens_in = $4, tokens_out = $5,
              cost_usd = $6, error = $7, completed_at = NOW()
        WHERE id = $1`,
      [
        runId,
        status,
        output ? JSON.stringify({ text: output.slice(0, 8000) }) : null,
        usage.promptTokens,
        usage.completionTokens,
        usage.costUsd,
        error ? JSON.stringify(error) : null,
      ],
    );
  }

  private async logToolCall(
    runId: string,
    call: ToolCall,
    result: string,
    ok: boolean,
    latencyMs: number,
    reversible: boolean,
  ): Promise<void> {
    try {
      await this.deps.db.queryFresh(
        `INSERT INTO tool_calls (run_id, tool, args, result, ok, latency_ms, reversible)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          runId,
          call.name,
          JSON.stringify(call.arguments).slice(0, 4000),
          result.slice(0, 8000),
          ok,
          latencyMs,
          reversible,
        ],
      );
    } catch (error) {
      // Audit logging must never take down a run. Surface it and continue.
      console.error('[agent] failed to log tool call', error);
    }
  }

  // ── Context assembly ───────────────────────────────────────────────────────

  private async toolsForSkill(
    runId: string,
    input: RunInput,
    registry: ToolRegistry,
  ): Promise<AnyTool[]> {
    const row = await this.deps.db.oneFresh<{ allowed_tools: string[] }>(
      `SELECT allowed_tools FROM skills WHERE id = $1`,
      [input.skillId],
    );
    if (!row) return registry.all();
    const { tools, missing } = registry.restrict(row.allowed_tools ?? []);
    if (missing.length) {
      // A typo in a skill's allowed_tools silently weakens it. Say so.
      this.deps.db.queryFresh(
        `INSERT INTO tool_calls (run_id, tool, args, result, ok, latency_ms)
         VALUES ($1, 'system.tool_scope', $2, $3, FALSE, 0)`,
        [
          runId,
          JSON.stringify({ missing }),
          JSON.stringify({
            ok: false,
            error: { code: 'NOT_FOUND', message: `Skill references unknown tools: ${missing.join(', ')}` },
          }),
        ],
      ).catch(() => undefined);
    }
    return tools;
  }

  private async buildSystemPrompt(
    input: RunInput,
    settings: NormalizedSettings,
  ): Promise<string> {
    const [user, pinned, skills] = await Promise.all([
      this.deps.db.one<{ persona: string | null; profile: Record<string, unknown> }>(
        `SELECT persona, profile FROM users WHERE id = $1`,
        [input.userId],
      ),
      this.deps.db.query<{ kind: string; content: string }>(
        `SELECT kind, content FROM memories
          WHERE user_id = $1 AND pinned = TRUE
          ORDER BY importance DESC, created_at DESC LIMIT 40`,
        [input.userId],
      ),
      this.deps.db.query<{ name: string; description: string | null; allowed_tools: string[] }>(
        `SELECT name, description, allowed_tools FROM skills
          WHERE user_id = $1 AND enabled = TRUE ORDER BY name LIMIT 50`,
        [input.userId],
      ),
    ]);

    return assembleSystemPrompt({
      persona: user?.persona ?? null,
      profile: user?.profile ?? {},
      pinnedMemories: pinned,
      skills,
      now: new Date(),
      userTimezone: settings.prefs.timezone,
    });
  }
}

function pickModel(settings: NormalizedSettings, slot: 'primary' | 'background'): string {
  return slot === 'background' ? settings.background.model : settings.primary.model;
}

function accumulate(total: CompletionUsage, add: CompletionUsage): void {
  total.promptTokens += add.promptTokens;
  total.completionTokens += add.completionTokens;
  total.totalTokens += add.totalTokens;
  total.costUsd += add.costUsd;
  if (add.model) total.model = add.model;
}
