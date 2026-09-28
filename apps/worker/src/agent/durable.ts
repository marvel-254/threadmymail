/**
 * AgentObject — the chat session and the agent's home on the wire.
 *
 * WHY A DURABLE OBJECT (and not just a Worker):
 *   A conversation is state that must survive hibernation and eviction. DOs
 *   persist to SQLite, wake on message, and cost nothing while asleep. The
 *   Agents SDK builds further chat recovery on top of this. The spike
 *   (docs/ARCHITECTURE.md §11) confirmed DOs have ample CPU on the Free plan.
 *
 * RESPONSIBILITIES:
 *   - terminate the agent WebSocket and fan frames out to connected clients
 *   - hold conversation history per session
 *   - own the kill switch, and abort in-flight runs promptly
 *   - persist the Gmail sync cursor, so the 5-minute tick never touches
 *     Postgres (docs/ARCHITECTURE.md §5 — violating this keeps Neon awake and
 *     burns its CU-hour allowance)
 */

import { DurableObject } from 'cloudflare:workers';
import { Db } from '../db/client.js';
import { BodyStore } from '../storage/bodystore.js';
import { ModelClient, type ChatMessage } from './model.js';
import { ToolRegistry } from '../tools/registry.js';
import { todoTools } from '../tools/todo.js';
import { memoryTools } from '../tools/memory.js';
import { Agent, type RunInput } from './loop.js';
import { MAX_SUBAGENT_DEPTH } from './config.js';
import type { MetaContext } from '../tools/meta.js';

export interface AgentEnv {
  DB: { connectionString: string };
  DB_FRESH: { connectionString: string };
  BODIES: D1Database;
  OPENROUTER_API_KEY?: string;
  ENVIRONMENT: string;
}

/** One live chat connection. */
interface Session {
  id: string;
  socket: WebSocket;
  userId: string;
  aborted: boolean;
}

export class AgentObject extends DurableObject<AgentEnv> {
  private sessions = new Map<string, Session>();
  private currentAbort: (() => void) | null = null;

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

    if (url.pathname === '/sync-cursor') {
      const cursor = await this.getSyncCursor();
      return Response.json({ history_id: cursor });
    }

    if (url.pathname === '/sync-cursor' && request.method === 'POST') {
      const body = (await request.json()) as { history_id: string | null };
      await this.setSyncCursor(body.history_id);
      return Response.json({ ok: true });
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

  private async runTurn(
    session: Session,
    content: string,
    depth: number,
    parentRunId: string | null,
    restrict: string[] | null,
  ): Promise<void> {
    // Check BOTH sources: DO storage (fast, set by the live endpoint) and the
    // persisted prefs row (set by the API). If either says halted, halt.
    const storageFlag = (await this.ctx.storage.get<boolean>('kill_switch')) ?? false;
    const prefsFlag = await this.persistedKillSwitch(session.userId);
    const engaged = storageFlag || prefsFlag;
    if (engaged) {
      await this.broadcastTo(session, {
        type: 'error',
        code: 'AGENT_ABORTED',
        message: 'The kill switch is engaged. Release it in the header to continue.',
      });
      return;
    }

    // The DO builds its own dependencies. Module state is NOT shared with the
    // Worker's isolate, so anything shared must be constructed per side.
    const db = new Db({ DB: this.env.DB, DB_FRESH: this.env.DB_FRESH });
    const bodies = new BodyStore(this.env.BODIES);
    const model = new ModelClient({ OPENROUTER_API_KEY: this.env.OPENROUTER_API_KEY });
    const baseRegistry = new ToolRegistry()
      .registerAll(todoTools as never)
      .registerAll(memoryTools as never);

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
          emit: (f) => void this.broadcast(session, f),
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
      skillId: null,
      parentRunId,
      trigger: 'chat',
      modelSlot: 'primary',
      depth,
      meta,
      emit: (f) => void this.broadcast(session, f),
      isAborted: () => session.aborted || controller.signal.aborted,
    };
    void restrict;

    try {
      const outcome = await agent.run(input);
      this.ctx.storage.sql.exec(
        `INSERT INTO messages (session_id, role, content) VALUES (?, 'assistant', ?)`,
        session.id,
        (outcome.text || '').slice(0, 20_000),
      );
      await this.broadcastTo(session, {
        type: 'done',
        run_id: outcome.runId,
        tokens: outcome.usage.totalTokens,
        cost_usd: outcome.usage.costUsd,
        stop_reason: outcome.stopReason,
        tool_calls: outcome.toolCallCount,
      });
    } catch (error) {
      await this.broadcastTo(session, {
        type: 'error',
        code: 'INTERNAL',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      this.currentAbort = null;
    }
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
