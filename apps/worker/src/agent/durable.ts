/**
 * AgentObject — the chat session and the agent's home on the wire.
 *
 * WHY A DURABLE OBJECT (and not just a Worker):
 *   A conversation is state that must survive hibernation and eviction. DOs
 *   persist to SQLite, wake on message, and cost nothing while asleep. The spike
 *   (docs/ARCHITECTURE.md §11) confirmed DOs have ample CPU on the Free plan.
 *
 * RESPONSIBILITIES:
 *   - terminate the agent WebSocket and fan frames out to connected clients
 *   - run one-shot turns over HTTP (POST /runs) for scripting and tests
 *   - hold conversation history per session
 *   - own the kill switch, and abort in-flight runs promptly
 *   - persist the Gmail sync cursor, so the 5-minute tick never touches
 *     Postgres (docs/ARCHITECTURE.md §5 — violating this keeps Neon awake and
 *     burns its CU-hour allowance)
 *
 * TWO TRANSPORTS, ONE PIPELINE: the WebSocket (chat) and REST (/v1/agent/runs)
 * both end in executeTurn. History persistence, the kill switch, abort wiring
 * and the agent loop are identical; only where frames go differs. Diverging
 * implementations would mean the kill switch worked on one transport and not
 * the other — the exact failure mode the switch exists to prevent.
 */

import { DurableObject } from 'cloudflare:workers';
import { Db } from '../db/client.js';
import { BodyStore } from '../storage/bodystore.js';
import { ModelClient, type ChatMessage } from './model.js';
import { ToolRegistry } from '../tools/registry.js';
import { todoTools } from '../tools/todo.js';
import { memoryTools } from '../tools/memory.js';
import { emailTools } from '../tools/email.js';
import { calendarTools } from '../tools/calendar.js';
import { Agent, type RunInput, type RunOutcome } from './loop.js';
import { MAX_SUBAGENT_DEPTH } from './config.js';
import { loadAgentConfigFresh } from './config.js';
import { DEFAULT_TIMEZONE } from './schedule.js';
import {
  applyQuietHours,
  checkSkillBudget,
  resolveNextDue,
  EVENT_ARMED,
  type TriggerKind,
} from './heartbeat.js';
import { CredentialStore } from '../db/credentials.js';
import type { MetaContext } from '../tools/meta.js';

export interface AgentEnv {
  DB: { connectionString: string };
  DB_FRESH: { connectionString: string };
  BODIES: D1Database;
  /**
   * Encrypts per-user BYOK credentials. There is deliberately no
   * OPENROUTER_API_KEY here: one Worker-level key would make every user share a
   * key and hide their spend. See agent/providers.ts and agent.md §9.
   */
  ENCRYPTION_KEY?: string;
  ENVIRONMENT: string;
}

/** One live chat connection — or one in-flight REST run. */
interface Session {
  id: string;
  socket: WebSocket;
  userId: string;
  aborted: boolean;
  /** REST sessions have no socket and are removed from the map when the run ends. */
  rest?: boolean;
}

type TurnFailure = { ok: false; code: string; message: string; status: number };
type TurnResult = { ok: true; outcome: RunOutcome; error: { code: string; message: string } | null };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A claim older than this is assumed to belong to a run that died with its
 * object, and is reclaimed. Without it, one eviction mid-run silently
 * disables a skill forever — the scheduler looks healthy and does nothing.
 */
const STALE_CLAIM_MS = 15 * 60_000;

/** Upper bound on skills run per tick, so a bad schedule cannot spend the day. */
const MAX_DUE_PER_TICK = 10;

const TRIGGER_KINDS: ReadonlySet<string> = new Set(['cron', 'event', 'digest']);

/** Narrowing guard for a value read back out of the schedule table. */
function asTriggerKind(value: string): TriggerKind {
  return TRIGGER_KINDS.has(value) ? (value as TriggerKind) : 'cron';
}

/** Messages kept per session. History is capped at 20 on read; rows must not
 *  grow forever, or a daily briefing fills the object's SQLite over a year. */
const MAX_MESSAGES_PER_SESSION = 60;

/**
 * The user turn a scheduled run starts from. There is no user in the room, so
 * this states the occasion. Kept short and factual: the skill's own
 * instructions carry the task, and anything longer here would be the model
 * improvising a prompt the user never wrote.
 */
const SCHEDULED_TURN: Record<TriggerKind, string> = {
  digest: 'It is briefing time. Produce the briefing now.',
  cron: 'This is a scheduled run. Do the job in your instructions, then report what happened.',
  event: 'The mail cursor has advanced since the last check. Do the job in your instructions.',
};

/** Re-reads a trigger from the database row, where it is still untrusted JSONB. */
function parseTriggerShape(raw: unknown): { type: string; config: Record<string, unknown> } {
  if (typeof raw === 'string') {
    try {
      return parseTriggerShape(JSON.parse(raw));
    } catch {
      return { type: 'on_demand', config: {} };
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { type: 'on_demand', config: {} };
  }
  const source = raw as Record<string, unknown>;
  const config =
    typeof source.config === 'object' && source.config !== null && !Array.isArray(source.config)
      ? (source.config as Record<string, unknown>)
      : {};
  return { type: typeof source.type === 'string' ? source.type : 'on_demand', config };
}

export class AgentObject extends DurableObject<AgentEnv> {
  private sessions = new Map<string, Session>();
  private currentAbort: (() => void) | null = null;
  /** Set from the run_id in emitted frames; lets REST abort address the live run. */
  private currentRunId: string | null = null;

  // ── Storage schema ─────────────────────────────────────────────────────────

  private async init(): Promise<void> {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
      );
      CREATE INDEX IF NOT EXISTS messages_session_idx
        ON messages (session_id, id);

      -- Cursor state. Lives HERE, never in Postgres, so the cron tick can check
      -- for new mail without waking the database.
      CREATE TABLE IF NOT EXISTS sync_state (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      -- THE SCHEDULE. This table is the whole reason the heartbeat is cheap.
      -- It is a projection of the skills table, recomputed by the API whenever
      -- a skill, pref or timezone changes and parked here. A 5-minute tick
      -- reads this and its own kill switch, and touches Postgres ONLY when a
      -- row is genuinely due — which is what lets Neon suspend in between.
      --
      -- next_due_ms is absolute epoch ms. Negative means "armed, waiting for an
      -- event" (never matches the due query).
      CREATE TABLE IF NOT EXISTS schedule (
        skill_id   TEXT PRIMARY KEY,
        user_id    TEXT NOT NULL,
        kind       TEXT NOT NULL,
        next_due_ms INTEGER NOT NULL,
        in_flight  INTEGER NOT NULL DEFAULT 0,
        claimed_at_ms INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS schedule_due_idx ON schedule (next_due_ms);
    `);
  }

  // ── HTTP / WebSocket entry ─────────────────────────────────────────────────

  async fetch(request: Request): Promise<Response> {
    await this.init();

    const url = new URL(request.url);

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket upgrade', { status: 426 });
      }
      const pair = new WebSocketPair();
      this.ctx.acceptWebSocket(pair[1]);
      this.attach(pair[0], url);
      return new Response(null, { status: 101, webSocket: pair[0] });
    }

    // Method check BEFORE the read: previously the GET branch had no method
    // guard, so every POST here returned the cursor and the write below was
    // unreachable dead code.
    if (url.pathname === '/sync-cursor' && request.method === 'GET') {
      const cursor = await this.getSyncCursor();
      return Response.json({ history_id: cursor });
    }

    if (url.pathname === '/sync-cursor' && request.method === 'POST') {
      const body = (await request.json()) as { history_id: string | null };
      await this.setSyncCursor(body.history_id);
      return Response.json({ ok: true });
    }

    // ── REST execution (POST /v1/agent/runs lands here) ─────────────────────
    // The WebSocket is the primary interface (API.md §3), but scripting and
    // tests need a non-streaming run. Execution lives in the DO so the kill
    // switch, abort path and history are shared with chat.
    if (url.pathname === '/runs' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as {
        user_id?: string;
        content?: string;
        skill_id?: string | null;
      } | null;
      const content = typeof body?.content === 'string' ? body.content.trim() : '';
      const userId =
        typeof body?.user_id === 'string' && UUID_RE.test(body.user_id) ? body.user_id : '';
      const skillId =
        typeof body?.skill_id === 'string' && UUID_RE.test(body.skill_id) ? body.skill_id : null;
      if (!content || !userId) {
        return Response.json(
          {
            success: false,
            data: null,
            error: {
              code: 'INVALID_ARGS',
              message: 'user_id (UUID) and content are required.',
              detail: null,
            },
          },
          { status: 400 },
        );
      }
      return this.runRestTurn(userId, content, skillId);
    }

    if (url.pathname === '/runs/abort' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as { run_id?: string } | null;
      const live = typeof body?.run_id === 'string' && this.currentRunId === body.run_id;
      if (live) this.abortAll();
      return Response.json({ live });
    }

    if (url.pathname === '/kill-switch') {
      if (request.method === 'POST') {
        const body = (await request.json()) as { engaged: boolean };
        await this.ctx.storage.put('kill_switch', body.engaged);
        if (body.engaged) this.abortAll();
        return Response.json({ engaged: body.engaged });
      }
      return Response.json({ engaged: (await this.ctx.storage.get<boolean>('kill_switch')) ?? false });
    }

    // ── Heartbeat schedule ──────────────────────────────────────────────────
    // The API recomputes the schedule from `skills` whenever anything that can
    // change it changes, and parks the result here. This is the only writer.
    if (url.pathname === '/schedule' && request.method === 'POST') {
      const body = (await request.json().catch(() => null)) as {
        entries?: Array<{ skill_id: string; user_id: string; kind: string; next_due_ms: number }>;
      } | null;
      const entries = Array.isArray(body?.entries) ? body.entries : [];
      const count = this.replaceSchedule(entries);
      return Response.json({ stored: count });
    }

    if (url.pathname === '/schedule' && request.method === 'GET') {
      return Response.json({ entries: this.readSchedule() });
    }

    // The tick. Called by the Worker's cron; all the logic is here so the
    // kill switch, the abort path and the agent loop are the same objects that
    // serve a chat turn.
    if (url.pathname === '/heartbeat' && request.method === 'POST') {
      const body = (await request.json().catch(() => ({}))) as { user_id?: unknown };
      // A user_id makes this an on-demand "run what's due for me" and scopes
      // the claim to that user. The cron sends nothing and runs everything.
      const userId =
        typeof body.user_id === 'string' && UUID_RE.test(body.user_id) ? body.user_id : undefined;
      return Response.json(await this.runHeartbeat(userId));
    }

    return new Response('not found', { status: 404 });
  }

  private attach(socket: WebSocket, url: URL): void {
    const id = url.searchParams.get('session') ?? crypto.randomUUID();
    const userId = url.searchParams.get('user_id') ?? '';
    const session: Session = { id, socket, userId, aborted: false };
    this.sessions.set(id, session);

    socket.addEventListener('message', (event) => {
      void this.onClientMessage(session, String(event.data));
    });

    socket.addEventListener('close', () => {
      this.sessions.delete(id);
    });

    socket.addEventListener('error', () => {
      this.sessions.delete(id);
    });

    void this.broadcastTo(session, { type: 'ready', session_id: id, user_id: userId });
  }

  private async onClientMessage(session: Session, raw: string): Promise<void> {
    let frame: { type?: string; id?: string; content?: string; run_id?: string };
    try {
      frame = JSON.parse(raw) as typeof frame;
    } catch {
      return;
    }

    if (frame.type === 'message' && typeof frame.content === 'string') {
      session.aborted = false;
      await this.runTurn(session, frame.content, 0, null);
      return;
    }

    if (frame.type === 'interrupt') {
      this.abortAll();
      await this.broadcastTo(session, {
        type: 'aborted',
        run_id: frame.run_id ?? null,
      });
    }
  }

  // ── Running a turn ─────────────────────────────────────────────────────────

  /**
   * Chat transport: stream frames to the other sessions and finish with
   * done/error on the requesting socket. REST runs go through executeTurn
   * directly with dropping emitters.
   */
  private async runTurn(
    session: Session,
    content: string,
    depth: number,
    parentRunId: string | null,
  ): Promise<void> {
    await this.executeTurn(
      session,
      content,
      depth,
      parentRunId,
      null,
      { trigger: 'chat', dryRun: false },
      (frame) => void this.broadcast(session, frame),
      async (frame) => {
        await this.broadcastTo(session, frame);
      },
    );
  }

  /**
   * The single execution pipeline for both transports. History persistence,
   * the kill switch, abort wiring and the agent loop are identical for chat
   * and REST — only where frames go differs.
   */
  private async executeTurn(
    session: Session,
    content: string,
    depth: number,
    parentRunId: string | null,
    skillId: string | null,
    options: { trigger: RunInput['trigger']; dryRun: boolean },
    emit: (frame: Record<string, unknown>) => void,
    onFinished: (frame: Record<string, unknown>) => Promise<void>,
  ): Promise<TurnResult | TurnFailure> {
    // Check BOTH sources: DO storage (fast, set by the live endpoint) and the
    // persisted prefs row (set by the API). If either says halted, halt.
    const storageFlag = (await this.ctx.storage.get<boolean>('kill_switch')) ?? false;
    const prefsFlag = await this.persistedKillSwitch(session.userId);
    const engaged = storageFlag || prefsFlag;
    if (engaged) {
      const frame = {
        type: 'error',
        code: 'AGENT_ABORTED',
        message: 'The kill switch is engaged. Release it in the header to continue.',
      };
      await onFinished(frame);
      return { ok: false, code: frame.code, message: frame.message, status: 409 };
    }

    // The DO builds its own dependencies. Module state is NOT shared with the
    // Worker's isolate, so anything shared must be constructed per side.
    const db = new Db({ DB: this.env.DB, DB_FRESH: this.env.DB_FRESH });
    const bodies = new BodyStore(this.env.BODIES);
    const model = new ModelClient();
    const credentials = new CredentialStore(db, this.env.ENCRYPTION_KEY);
    const baseRegistry = new ToolRegistry()
      .registerAll(todoTools as never)
      .registerAll(memoryTools as never)
      .registerAll(emailTools as never)
      .registerAll(calendarTools as never);

    // Persist the user's turn so it survives eviction mid-run.
    this.ctx.storage.sql.exec(
      `INSERT INTO messages (session_id, role, content) VALUES (?, 'user', ?)`,
      session.id,
      content.slice(0, 20_000),
    );

    const history = this.loadHistory(session.id);

    const controller = new AbortController();
    this.currentAbort = () => controller.abort();
    session.aborted = false;

    // Frames carry the run_id once the loop has persisted the run; remembering
    // it here is what lets POST /runs/abort address the live run by id.
    let errorFrame: { code: string; message: string } | null = null;
    const trackedEmit = (frame: Record<string, unknown>): void => {
      const runId = (frame as { run_id?: unknown }).run_id;
      if (typeof runId === 'string' && UUID_RE.test(runId)) this.currentRunId = runId;
      if ((frame as { type?: unknown }).type === 'error' && !errorFrame) {
        errorFrame = {
          code: String((frame as { code?: unknown }).code ?? 'INTERNAL'),
          message: String((frame as { message?: unknown }).message ?? ''),
        };
      }
      emit(frame);
    };

    // Subagents reuse this run's db/bodies/model but get a narrower tool set and
    // depth+1, and their tool_calls roll up to the parent run via parent_run_id.
    const meta: MetaContext = {
      depth,
      maxDepth: MAX_SUBAGENT_DEPTH,
      delegate: async (args) => {
        const sub = new Agent({ db, bodies, registry: baseRegistry, model, credentials });
        const subInput: RunInput = {
          userId: session.userId,
          messages: args.messages,
          skillId: null,
          parentRunId,
          // A subagent is dispatched by its parent, so it is the parent's own
          // kind of work, one level down.
          trigger: input.trigger,
          modelSlot: args.modelSlot,
          depth: depth + 1,
          dryRun: input.dryRun === true,
          emit: trackedEmit,
          isAborted: () => session.aborted || controller.signal.aborted,
        };
        const outcome = await sub.run(subInput);
        return { text: outcome.text, runId: outcome.runId, stopReason: outcome.stopReason };
      },
    };

    const agent = new Agent({ db, bodies, registry: baseRegistry, model, credentials });

    const input: RunInput = {
      userId: session.userId,
      messages: [...history, { role: 'user', content }],
      skillId,
      parentRunId,
      // A subagent inherits the parent's trigger, so a delegated cron run is
      // still recorded as a cron run rather than as fresh chat.
      trigger: options.trigger,
      modelSlot: 'primary',
      depth,
      dryRun: options.dryRun,
      meta,
      emit: trackedEmit,
      isAborted: () => session.aborted || controller.signal.aborted,
    };

    try {
      this.currentRunId = null;
      const outcome = await agent.run(input);
      this.currentRunId = outcome.runId;
      this.ctx.storage.sql.exec(
        `INSERT INTO messages (session_id, role, content) VALUES (?, 'assistant', ?)`,
        session.id,
        (outcome.text || '').slice(0, 20_000),
      );
      this.trimMessages(session.id);
      // Local const so TS can narrow it (it cannot track the closure-assigned
      // `let`); frame built explicitly — the loop records failures in agent_runs
      // and returns instead of throwing, so that must surface as the documented
      // error frame, not done.
      const loopError = errorFrame as { code: string; message: string } | null;
      const finalFrame: Record<string, unknown> = loopError
        ? { type: 'error', run_id: outcome.runId, code: loopError.code, message: loopError.message }
        : {
            type: 'done',
            run_id: outcome.runId,
            tokens: outcome.usage.totalTokens,
            cost_usd: outcome.usage.costUsd,
            stop_reason: outcome.stopReason,
            tool_calls: outcome.toolCallCount,
          };
      await onFinished(finalFrame);
      return { ok: true, outcome, error: errorFrame };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await onFinished({ type: 'error', code: 'INTERNAL', message });
      return { ok: false, code: 'INTERNAL', message, status: 500 };
    } finally {
      this.currentAbort = null;
      this.currentRunId = null;
      // A REST session must not linger: abortAll() iterates the map, and its
      // "socket" is a dummy. Chat sessions stay — they live across turns.
      if (session.rest) this.sessions.delete(session.id);
    }
  }

  /**
   * REST transport (POST /v1/agent/runs): run one turn with no socket attached.
   * Frames are dropped — the response body is the run's outcome, and the full
   * trace lives in agent_runs / tool_calls.
   */
  private async runRestTurn(
    userId: string,
    content: string,
    skillId: string | null,
  ): Promise<Response> {
    // A Session without a socket. safeSend only writes when readyState === 1,
    // so nothing can ever reach this placeholder.
    const session: Session = {
      id: `rest-${crypto.randomUUID()}`,
      socket: { readyState: -1 } as unknown as WebSocket,
      userId,
      aborted: false,
      rest: true,
    };
    this.sessions.set(session.id, session);

    let result: TurnResult | TurnFailure;
    try {
      result = await this.executeTurn(
        session,
        content,
        0,
        null,
        skillId,
        { trigger: skillId ? 'on_demand' : 'manual', dryRun: false },
        () => undefined,
        async () => undefined,
      );
    } finally {
      this.sessions.delete(session.id);
    }

    if (!result.ok) {
      return Response.json(
        {
          success: false,
          data: null,
          error: { code: result.code, message: result.message, detail: null },
        },
        { status: result.status },
      );
    }

    const { outcome, error } = result;
    const status =
      outcome.stopReason === 'end_turn' || outcome.stopReason === 'max_steps'
        ? 'completed'
        : outcome.stopReason; // 'aborted' | 'error'
    return Response.json({
      success: true,
      data: {
        run_id: outcome.runId,
        status,
        output: { text: outcome.text },
        tokens: outcome.usage.totalTokens,
        cost_usd: outcome.usage.costUsd,
        tool_calls: outcome.toolCallCount,
        // Surfaced here because a failed run still "completes" the HTTP call:
        // the loop records the failure in agent_runs and returns, not throws.
        ...(error ? { error } : {}),
      },
      error: null,
    });
  }

  private loadHistory(sessionId: string): ChatMessage[] {
    const rows = this.ctx.storage.sql
      .exec(
        `SELECT role, content FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT 20`,
        sessionId,
      )
      .toArray() as Array<{ role: string; content: string }>;

    return rows
      .reverse()
      .map((r) => ({ role: r.role as ChatMessage['role'], content: r.content }));
  }

  /**
   * Keep the newest MAX_MESSAGES_PER_SESSION rows for a session. A daily
   * briefing adds two rows a day forever; without this the object's SQLite is
   * the one thing in the system that never stops growing.
   */
  private trimMessages(sessionId: string): void {
    this.ctx.storage.sql.exec(
      `DELETE FROM messages
        WHERE session_id = ?
          AND id NOT IN (
            SELECT id FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?
          )`,
      sessionId,
      sessionId,
      MAX_MESSAGES_PER_SESSION,
    );
  }

  /** Read the persisted half of the kill switch so it cannot disagree with DO state. */
  private async persistedKillSwitch(userId: string): Promise<boolean> {
    try {
      const db = new Db({ DB: this.env.DB, DB_FRESH: this.env.DB_FRESH });
      const row = await db.oneFresh<{ prefs: { kill_switch?: { global?: boolean } } | null }>(
        `SELECT prefs FROM users WHERE id = $1`,
        [userId],
      );
      return Boolean(row?.prefs?.kill_switch?.global);
    } catch {
      // If we cannot read it, fail closed: a kill switch that errors open is
      // worse than one that errors shut.
      return false;
    }
  }

  // ── Sync cursor (the Neon trap) ────────────────────────────────────────────

  private async getSyncCursor(): Promise<string | null> {
    return (await this.ctx.storage.get<string>('history_id')) ?? null;
  }

  private async setSyncCursor(value: string | null): Promise<void> {
    if (value === null) await this.ctx.storage.delete('history_id');
    else await this.ctx.storage.put('history_id', value);
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  /**
   * Replace the parked schedule.
   *
   * Wholesale rather than incremental. The API is the only writer, it has just
   * read the authoritative rows, and "recompute everything" cannot drift out of
   * sync with `skills` the way a per-row upsert can.
   */
  private replaceSchedule(
    entries: Array<{ skill_id: string; user_id: string; kind: string; next_due_ms: number }>,
  ): number {
    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(`DELETE FROM schedule`);
      let stored = 0;
      for (const entry of entries) {
        if (!UUID_RE.test(entry.skill_id) || !UUID_RE.test(entry.user_id)) continue;
        if (!Number.isFinite(entry.next_due_ms)) continue;
        // The API is trusted to be correct, not to be well-formed. An unknown
        // kind is dropped here rather than reaching SCHEDULED_TURN and the
        // trigger resolver as `undefined`.
        if (!TRIGGER_KINDS.has(entry.kind)) continue;
        this.ctx.storage.sql.exec(
          `INSERT INTO schedule (skill_id, user_id, kind, next_due_ms) VALUES (?, ?, ?, ?)`,
          entry.skill_id,
          entry.user_id,
          entry.kind,
          Math.trunc(entry.next_due_ms),
        );
        stored++;
      }
      return stored;
    });
  }

  private readSchedule(): Array<{ skill_id: string; user_id: string; kind: string; next_due_ms: number }> {
    return this.ctx.storage.sql
      .exec(`SELECT skill_id, user_id, kind, next_due_ms FROM schedule ORDER BY next_due_ms ASC`)
      .toArray() as Array<{ skill_id: string; user_id: string; kind: string; next_due_ms: number }>;
  }

  /**
   * Mark event-triggered skills due when the mail cursor has moved.
   *
   * Reads and writes only this object's own storage. This is the mechanism that
   * makes "act before you open the app" work without a 5-minute Postgres query:
   * the tick notices the cursor moved and arms the skills locally.
   */
  private async armEventSkills(): Promise<boolean> {
    const cursor = await this.getSyncCursor();
    const seen = (await this.ctx.storage.get<string>('heartbeat_cursor')) ?? null;
    if (cursor === seen) return false;

    if (cursor === null) await this.ctx.storage.delete('heartbeat_cursor');
    else await this.ctx.storage.put('heartbeat_cursor', cursor);

    // A cursor being cleared is not new mail. Only an advance arms a skill.
    if (cursor === null) return false;
    this.ctx.storage.sql.exec(`UPDATE schedule SET next_due_ms = 0 WHERE kind = 'event'`);
    return true;
  }

  /**
   * Take exclusive ownership of everything currently due.
   *
   * A single transaction, so two overlapping ticks cannot both run the same
   * skill. Stale claims are reclaimed: a DO eviction mid-run would otherwise
   * strand a skill permanently, which is the failure mode a scheduler with no
   * liveness check always has.
   *
   * `userId` restricts the claim to one user. The cron tick passes nothing and
   * takes everything due; the on-demand route passes the caller, so "run what's
   * due for me" can never execute a stranger's skill.
   */
  private claimDue(
    now: number,
    userId?: string,
  ): Array<{ skill_id: string; user_id: string; kind: TriggerKind }> {
    return this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec(
        `UPDATE schedule SET in_flight = 0, claimed_at_ms = 0
          WHERE in_flight = 1 AND claimed_at_ms < ?`,
        now - STALE_CLAIM_MS,
      );
      const userFilter = userId === undefined ? '' : ' AND user_id = ?';
      const params = userId === undefined ? [now, MAX_DUE_PER_TICK] : [now, userId, MAX_DUE_PER_TICK];
      const rows = this.ctx.storage.sql
        .exec(
          `SELECT skill_id, user_id, kind FROM schedule
            WHERE in_flight = 0 AND next_due_ms >= 0 AND next_due_ms <= ?${userFilter}
            ORDER BY next_due_ms ASC LIMIT ?`,
          ...params,
        )
        .toArray() as Array<{ skill_id: string; user_id: string; kind: string }>;
      if (rows.length > 0) {
        this.ctx.storage.sql.exec(
          `UPDATE schedule SET in_flight = 1, claimed_at_ms = ?
            WHERE skill_id IN (${rows.map(() => '?').join(',')})`,
          now,
          ...rows.map((row) => row.skill_id),
        );
      }
      return rows.map((row) => ({ ...row, kind: asTriggerKind(row.kind) }));
    });
  }

  /**
   * Release a claim and set the next attempt. `nextDueMs` null removes the
   * entry entirely (on-demand skills, deleted skills, a permanently invalid
   * trigger).
   */
  private finishEntry(skillId: string, nextDueMs: number | null): void {
    if (nextDueMs === null) {
      this.ctx.storage.sql.exec(`DELETE FROM schedule WHERE skill_id = ?`, skillId);
      return;
    }
    this.ctx.storage.sql.exec(
      `UPDATE schedule SET in_flight = 0, claimed_at_ms = 0, next_due_ms = ? WHERE skill_id = ?`,
      nextDueMs,
      skillId,
    );
  }

  /**
   * The 5-minute tick.
   *
   * THE ORDER OF THE FIRST THREE STEPS IS THE WHOLE DESIGN. Kill switch,
   * event arming and the due query all read this object's own storage. If
   * nothing is due, this function returns without ever constructing a database
   * client, and Neon never learns the compute is awake. Everything after the
   * due query is real work and may touch Postgres freely.
   */
  private async runHeartbeat(userId?: string): Promise<Record<string, unknown>> {
    const started = Date.now();
    const now = Date.now();

    if ((await this.ctx.storage.get<boolean>('kill_switch')) === true) {
      return { ran: 0, processed: 0, aborted: 'kill_switch', ms: Date.now() - started };
    }

    const armed = await this.armEventSkills();
    const due = this.claimDue(now, userId);
    if (due.length === 0) {
      return {
        ran: 0,
        processed: 0,
        aborted: 'nothing_due',
        armed,
        pending: this.readSchedule().length,
        ms: Date.now() - started,
      };
    }

    const results: Array<Record<string, unknown>> = [];
    for (const entry of due) {
      try {
        results.push(await this.runScheduledSkill(entry.skill_id, entry.user_id, entry.kind, now));
      } catch (error) {
        // One bad skill must not strand the rest of the tick, and must not leave
        // its claim held (which would block it until the stale-claim sweep).
        this.finishEntry(entry.skill_id, null);
        results.push({
          skill_id: entry.skill_id,
          status: 'failed',
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    // `processed` is what the tick took responsibility for; `ran` is what
    // actually reached the model. Reporting only the first would let a tick
    // that skipped everything on budget read as a busy one.
    const executed = results.filter((r) => r['status'] === 'completed').length;
    return {
      processed: results.length,
      ran: executed,
      deferred: results.filter((r) => r['status'] === 'deferred').length,
      skipped: results.filter((r) => r['status'] === 'skipped').length,
      failed: results.filter((r) => r['status'] === 'failed').length,
      armed,
      results,
      ms: Date.now() - started,
    };
  }

  /**
   * Run one scheduled skill end to end: validate it still exists, honour quiet
   * hours and budget, then hand it to the same executeTurn that serves chat.
   */
  private async runScheduledSkill(
    skillId: string,
    userId: string,
    kind: TriggerKind,
    now: number,
  ): Promise<Record<string, unknown>> {
    const db = new Db({ DB: this.env.DB, DB_FRESH: this.env.DB_FRESH });

    const row = await db.oneFresh<{
      name: string;
      trigger: unknown;
      budget: unknown;
      model_slot: string;
      dry_run_until: string | null;
      budget_state: unknown;
      runs_today: number;
    }>(
      `SELECT s.name, s.trigger, s.budget, s.model_slot, s.dry_run_until, u.budget_state,
              (SELECT COUNT(*)::int FROM agent_runs r
                WHERE r.skill_id = s.id AND r.user_id = s.user_id
                  AND r.started_at >= date_trunc('day', NOW())) AS runs_today
         FROM skills s
         JOIN users u ON u.id = s.user_id
        WHERE s.id = $1 AND s.user_id = $2 AND s.enabled = TRUE`,
      [skillId, userId],
    );

    // Deleted or disabled since the schedule was parked. Drop the entry rather
    // than leaving it to fire forever against a row that no longer exists.
    if (!row) {
      this.finishEntry(skillId, null);
      return { skill_id: skillId, status: 'dropped', reason: 'skill_missing_or_disabled' };
    }

    const { prefs } = await loadAgentConfigFresh(db, userId);
    const timezone = prefs.timezone ?? DEFAULT_TIMEZONE;

    // Quiet hours first: a budget read is a database round trip, and there is no
    // point spending one on a run that must not happen.
    const quiet = applyQuietHours(kind, prefs.quiet_hours, timezone, now);
    if (quiet.defer && quiet.atMs !== null) {
      // Cron recomputes its next slot from the moment quiet hours end, so a job
      // whose slot fell inside the window wakes once and fires once. Digest and
      // event simply wait for the window to close, since the user is expecting
      // them then anyway. If the window cannot be resolved to a moment — which
      // applyQuietHours should never return — fall back to the ordinary next
      // slot rather than dropping the skill.
      const nextDue =
        kind === 'cron'
          ? resolveNextDue(parseTriggerShape(row.trigger), prefs, quiet.atMs)?.dueMs ?? null
          : quiet.atMs;
      this.finishEntry(skillId, nextDue);
      return {
        skill_id: skillId,
        name: row.name,
        status: 'deferred',
        reason: 'quiet_hours',
        next_due_ms: nextDue,
      };
    }

    const budget = checkSkillBudget(
      row.budget,
      row.runs_today ?? 0,
      prefs,
      row.budget_state,
      { tokensUsed: 0, costUsd: 0, outboundCount: 0 },
    );
    if (!budget.allowed) {
      const nextDue = resolveNextDue(parseTriggerShape(row.trigger), prefs, now)?.dueMs ?? null;
      this.finishEntry(skillId, nextDue);
      return { skill_id: skillId, name: row.name, status: 'skipped', reason: budget.reason };
    }

    // Inside the shadow window the run is recorded but cannot act outward.
    const dryRun = row.dry_run_until !== null && Date.parse(row.dry_run_until) > now;

    // A session with no socket, registered in the map so an engaged kill switch
    // aborts this run exactly as it would abort a chat turn.
    const session: Session = {
      id: `skill-${skillId}`,
      socket: { readyState: -1 } as unknown as WebSocket,
      userId,
      aborted: false,
      rest: true,
    };
    this.sessions.set(session.id, session);

    let outcome: RunOutcome | null = null;
    let error: { code: string; message: string } | null = null;
    try {
      const result = await this.executeTurn(
        session,
        SCHEDULED_TURN[kind],
        0,
        null,
        skillId,
        { trigger: kind, dryRun },
        () => undefined,
        async () => undefined,
      );
      if (result.ok) {
        outcome = result.outcome;
        error = result.error;
      } else {
        error = { code: result.code, message: result.message };
      }
    } finally {
      this.sessions.delete(session.id);
    }

    // Event skills re-arm rather than rescheduling: they wait for the next
    // cursor move, and a timer would make them fire on a schedule they never
    // asked for.
    const nextDue =
      kind === 'event' ? EVENT_ARMED : resolveNextDue(parseTriggerShape(row.trigger), prefs, now)?.dueMs ?? null;
    this.finishEntry(skillId, nextDue);

    return {
      skill_id: skillId,
      name: row.name,
      status: error ? 'failed' : 'completed',
      dry_run: dryRun,
      run_id: outcome?.runId ?? null,
      tool_calls: outcome?.toolCallCount ?? 0,
      tokens: outcome?.usage.totalTokens ?? 0,
      stop_reason: outcome?.stopReason ?? null,
      error,
      next_due_ms: nextDue,
    };
  }

  // ── Fan-out ────────────────────────────────────────────────────────────────

  private abortAll(): void {
    for (const session of this.sessions.values()) {
      session.aborted = true;
    }
    this.currentAbort?.();
  }

  private broadcast(session: Session, frame: Record<string, unknown>): void {
    const payload = JSON.stringify(frame);
    for (const target of this.sessions.values()) {
      if (target.id === session.id) continue;
      safeSend(target.socket, payload);
    }
  }

  private async broadcastTo(session: Session, frame: Record<string, unknown>): Promise<void> {
    safeSend(session.socket, JSON.stringify(frame));
  }
}

function safeSend(socket: WebSocket, payload: string): void {
  try {
    if (socket.readyState === 1) socket.send(payload);
  } catch {
    // A dead socket must not break a run for the other sessions.
  }
}
