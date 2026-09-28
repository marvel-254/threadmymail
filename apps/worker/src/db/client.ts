/**
 * Postgres access.
 *
 * TWO CONNECTIONS, ON PURPOSE (docs/ARCHITECTURE.md §6):
 *
 *   DB        cached      for search, browse, RAG over stable result sets
 *   DB_FRESH  uncached   for anything read-after-write
 *
 * Hyperdrive does NOT invalidate cached reads on write. Using `DB` after a
 * mutation returns stale rows for up to `max_age` (60s by default) — for an
 * assistant whose job is reporting current state, that is a correctness bug.
 *
 * So: **after any write, read through `DB_FRESH`.** Use `db()` for reads and
 * `fresh()` for reads that follow a write, or for anything the user just
 * changed. When in doubt, use `fresh()` — it is never wrong, only slower.
 */

import { Client } from 'pg';

export interface DbEnv {
  DB: { connectionString: string };
  DB_FRESH: { connectionString: string };
}

// Cloudflare's own guidance: Workers limit concurrent external connections, so
// the per-invocation pool is capped well below the origin's capacity. We hold a
// single Client per invocation rather than a pg.Pool (Pool adds sockets we do not
// need, and a Durable Object invocation is short-lived by design).
const POOL_MAX = 5;

/**
 * Hyperdrive pooler operates in transaction mode: a connection is returned at
 * transaction end, and `SET` state does not survive. Keep transactions short and
 * single-purpose.
 */
class Pool {
  private client: Client | null = null;

  constructor(private connectionString: string) {}

  private async get(): Promise<Client> {
    if (this.client) return this.client;
    const client = new Client({
      connectionString: this.connectionString,
      // Hyperdrive terminates TLS; the Workers socket must not attempt its own
      // negotiation. `pg` therefore does not see a `rejectUnauthorized` option
      // here — connection setup is Hyperdrive's job.
      ssl: false,
    });
    // A DO invocation is short-lived; never let a connect failure crash it.
    client.on('error', (err) => {
      console.error('[db] client error', err.message);
      this.client = null;
    });
    await client.connect();
    this.client = client;
    return client;
  }

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    const client = await this.get();
    const result = await client.query<T>(text, params);
    return result.rows;
  }

  async one<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  /**
   * Run a unit of work in a transaction. Deliberately short — do not wrap
   * multiple unrelated operations in one, or the pooled connection is held
   * for the duration and cannot be reused.
   */
  async tx<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    const client = await this.get();
    await client.query('BEGIN');
    try {
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  async close(): Promise<void> {
    await this.client?.end().catch(() => undefined);
    this.client = null;
  }
}

export class Db {
  private readonly cached: Pool;
  private readonly fresh: Pool;

  constructor(env: DbEnv) {
    this.cached = new Pool(env.DB.connectionString);
    this.fresh = new Pool(env.DB_FRESH.connectionString);
  }

  /** Cached reads: search, browse, RAG. Tolerates up to 60s staleness. */
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return this.cached.query<T>(text, params);
  }

  /** Uncached reads. Use after any write, or for anything just changed. */
  queryFresh<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T[]> {
    return this.fresh.query<T>(text, params);
  }

  one<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    return this.cached.one<T>(text, params);
  }

  oneFresh<T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params: unknown[] = [],
  ): Promise<T | null> {
    return this.fresh.one<T>(text, params);
  }

  tx<T>(fn: (client: Client) => Promise<T>): Promise<T> {
    return this.fresh.tx(fn);
  }

  async close(): Promise<void> {
    await Promise.all([this.cached.close(), this.fresh.close()]);
  }
}

export type Row = Record<string, unknown>;

/** Shared column list for agent_runs inserts, so the shape lives in one place. */
export const RUN_COLUMNS = `
  id, user_id, skill_id, parent_run_id, trigger, status, input, output,
  model, tokens_in, tokens_out, cost_usd, error, started_at, completed_at
`;

export const TODO_COLUMNS = `
  id, user_id, title, notes, status, priority, due_at, source, source_ref,
  thread_id, calendar_event_id, position, completed_at, created_at, updated_at
`;

export const MEMORY_COLUMNS = `
  id, user_id, kind, content, importance, pinned, source_ref, created_at
`;

/**
 * Email metadata columns, shared by the REST list endpoint and the email tools
 * so the two can never drift.
 *
 * Deliberately excludes `body_key` and `embedding`: bodies live in the D1 blob
 * store (invariant 4), and a list read must not drag them out. Only the single
 * message fetch resolves a body, and it truncates.
 */
export const EMAIL_METADATA_COLUMNS = `
  id, gmail_id, thread_id, subject, from_address, to_addresses, snippet,
  has_attachments, label_ids, received_at, read_at, ai_summary, ai_priority
`;
