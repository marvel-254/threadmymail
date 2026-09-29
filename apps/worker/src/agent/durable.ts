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
import type { MetaContext } from '../tools/meta.js';

export interface AgentEnv {
  DB: { connectionString: string };
  DB_FRESH: { connectionString: string };
  BODIES: D1Database;
  OPENROUTER_API_KEY?: string;
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
      await this.runTurn(session, frame.content, 0, null, null);
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
    restrict: string[] | null,
  ): Promise<void> {
    await this.executeTurn(
      session,
      content,
      depth,
      parentRunId,
      null,
      restrict,
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
    restrict: string[] | null,
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
    const model = new ModelClient({ OPENROUTER_API_KEY: this.env.OPENROUTER_API_KEY });
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
        const sub = new Agent({ db, bodies, registry: baseRegistry, model });
        const subInput: RunInput = {
          userId: session.userId,
          messages: args.messages,
          skillId: null,
          parentRunId,
          trigger: 'on_demand',
          modelSlot: args.modelSlot,
          depth: depth + 1,
          emit: trackedEmit,
          isAborted: () => session.aborted || controller.signal.aborted,
        };
        const outcome = await sub.run(subInput);
        return { text: outcome.text, runId: outcome.runId, stopReason: outcome.stopReason };
      },
    };

    const agent = new Agent({ db, bodies, registry: baseRegistry, model });

    const input: RunInput = {
      userId: session.userId,
      messages: [...history, { role: 'user', content }],
      skillId,
      parentRunId,
      trigger: skillId ? 'on_demand' : 'chat',
      modelSlot: 'primary',
      depth,
      meta,
      emit: trackedEmit,
      isAborted: () => session.aborted || controller.signal.aborted,
    };
    void restrict;

    try {
      this.currentRunId = null;
      const outcome = await agent.run(input);
      this.currentRunId = outcome.runId;
      this.ctx.storage.sql.exec(
        `INSERT INTO messages (session_id, role, content) VALUES (?, 'assistant', ?)`,
        session.id,
        (outcome.text || '').slice(0, 20_000),
      );
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
        null,
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
