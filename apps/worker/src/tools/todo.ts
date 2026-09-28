/**
 * Todo tools.
 *
 * Every statement is parameterised: titles and notes originate from email
 * bodies, which are untrusted, so string concatenation into SQL is never
 * acceptable here. Dynamic WHERE clauses are assembled from fixed fragments
 * only — values always travel as bind parameters.
 */

import { ERROR, fail, ok, type ToolContext, type ToolDefinition, type ToolResult } from './registry';
import { TODO_COLUMNS, type Db, type Row } from '../db/client';

/**
 * `ToolContext` in the registry does not yet carry a `Db`. Tools that touch
 * Postgres need one, so the runtime passes it on the context and we narrow
 * here rather than widening the shared contract. Revisit once the registry
 * gains an explicit `db` handle.
 */
export type DbToolContext = ToolContext & { db: Db };

function getDb(ctx: DbToolContext): Db | null {
  return (ctx as DbToolContext).db ?? null;
}

const STATUSES = ['open', 'done', 'dropped'] as const;
type Status = (typeof STATUSES)[number];

const NOTE_CAP = 300;

interface TodoRow extends Row {
  id: string;
  title: string;
  notes: string | null;
  status: Status;
  priority: number;
  due_at: Date | string | null;
  source: string | null;
  source_ref: string | null;
  thread_id: string | null;
  position: number;
  completed_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

function cap(s: string | null, n = NOTE_CAP): string | null {
  if (s === null) return null;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function shape(r: TodoRow) {
  return {
    id: r.id,
    title: r.title,
    notes: r.notes,
    status: r.status,
    priority: r.priority,
    due_at: r.due_at,
    source: r.source,
    source_ref: r.source_ref,
    thread_id: r.thread_id,
    position: r.position,
    completed_at: r.completed_at,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

function isStatus(v: unknown): v is Status {
  return typeof v === 'string' && (STATUSES as readonly string[]).includes(v);
}

/** Coerce to a bounded integer, falling back to `fallback` on junk. */
function boundedInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badId(): ToolResult<never> {
  return fail(ERROR.INVALID_ARGS, 'id must be a UUID.');
}

const CREATE_ARGS = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'Short imperative phrase, e.g. "Reply to Dana about the Q3 numbers".' },
    notes: { type: 'string', description: 'Optional detail or quoted context.' },
    due_at: { type: 'string', description: 'ISO-8601 date or datetime, e.g. "2026-10-01T17:00:00Z".' },
    priority: { type: 'integer', minimum: 1, maximum: 10, description: '1 = lowest, 10 = highest. Default 5.' },
    source: { type: 'string', description: 'Where this came from: agent, user, email, notion.' },
    source_ref: { type: 'string', description: 'Opaque pointer back to the origin, e.g. an email id.' },
    thread_id: { type: 'string', description: 'Email thread this todo is about.' },
  },
  required: ['title'],
  additionalProperties: false,
} as const;

async function fetchOne(db: Db, userId: string, id: string): Promise<TodoRow | null> {
  return db.oneFresh<TodoRow>(`SELECT ${TODO_COLUMNS} FROM todos WHERE user_id = $1 AND id = $2`, [
    userId,
    id,
  ]);
}

export const todoTools: ToolDefinition<never, unknown>[] = [
  {
    name: 'todo.create',
    description:
      'Create a single todo for the user. Use when the user asks to be reminded of something, or when a ' +
      'commitment is made in conversation or in an email the user is acting on ("I will send the deck by ' +
      'Friday" from someone the user owes a reply to). Do NOT use for scheduling — that is a calendar event. ' +
      'Returns the created todo with its id.',
    parameters: CREATE_ARGS as unknown as Record<string, unknown>,
    permissions: ['data:todo:write'],
    reversible: true,
    sideEffecting: true,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const title = typeof a.title === 'string' ? a.title.trim() : '';
      if (!title) return fail(ERROR.INVALID_ARGS, 'title is required and must be a non-empty string.');

      const notes = typeof a.notes === 'string' && a.notes.trim() ? a.notes.trim() : null;
      const dueAt = typeof a.due_at === 'string' && a.due_at.trim() ? a.due_at.trim() : null;
      if (dueAt && Number.isNaN(Date.parse(dueAt))) {
        return fail(ERROR.INVALID_ARGS, `due_at is not a parseable date: ${dueAt}`);
      }
      const priority = boundedInt(a.priority, 5, 1, 10);
      const source = typeof a.source === 'string' && a.source.trim() ? a.source.trim() : null;
      const sourceRef = typeof a.source_ref === 'string' && a.source_ref.trim() ? a.source_ref.trim() : null;
      const threadId = typeof a.thread_id === 'string' && a.thread_id.trim() ? a.thread_id.trim() : null;

      const row = await db.oneFresh<TodoRow>(
        `INSERT INTO todos (user_id, title, notes, status, priority, due_at, source, source_ref, thread_id)
         VALUES ($1, $2, $3, 'open', $4, $5, $6, $7, $8)
         RETURNING ${TODO_COLUMNS}`,
        [ctx.userId, title, notes, priority, dueAt, source, sourceRef, threadId],
      );
      if (!row) return fail(ERROR.INTERNAL, 'Todo insert returned no row.');

      await ctx.describe({ summary: `Added todo "${row.title}"`, reversible: true });
      return ok({ todo: shape(row) }, `Added todo "${row.title}"`);
    },
  },

  {
    name: 'todo.list',
    description:
      'List todos, newest-by-due-date first. Use to answer "what do I have outstanding", "what is due this ' +
      'week", or to check whether a todo already exists before creating a duplicate. Defaults to status "open". ' +
      'Does NOT search text — use todo.search for that, and todo.list_pinned is not a thing; pinned is a ' +
      'memory concept, not a todo one.',
    parameters: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: [...STATUSES], description: 'Default "open".' },
        due_before: { type: 'string', description: 'Only todos due at or before this ISO-8601 timestamp.' },
        source: { type: 'string', description: 'Filter by origin, e.g. "email".' },
        limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 50.' },
      },
      required: [],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:todo:read'],
    reversible: false,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const status = a.status === undefined || a.status === null ? 'open' : a.status;
      if (!isStatus(status)) {
        return fail(ERROR.INVALID_ARGS, `status must be one of ${STATUSES.join(', ')}.`);
      }
      const dueBefore = typeof a.due_before === 'string' && a.due_before.trim() ? a.due_before.trim() : null;
      if (dueBefore && Number.isNaN(Date.parse(dueBefore))) {
        return fail(ERROR.INVALID_ARGS, `due_before is not a parseable date: ${dueBefore}`);
      }
      const source = typeof a.source === 'string' && a.source.trim() ? a.source.trim() : null;
      const limit = boundedInt(a.limit, 50, 1, 200);

      const where: string[] = ['user_id = $1', 'status = $2'];
      const params: unknown[] = [ctx.userId, status];
      if (dueBefore) {
        params.push(dueBefore);
        where.push(`due_at IS NOT NULL AND due_at <= $${params.length}`);
      }
      if (source) {
        params.push(source);
        where.push(`source = $${params.length}`);
      }
      params.push(limit);

      // Fresh: users tick things off and immediately ask again; a 60s stale
      // read here reads as "my change did not save".
      const rows = await db.queryFresh<TodoRow>(
        `SELECT ${TODO_COLUMNS} FROM todos WHERE ${where.join(' AND ')}
         ORDER BY due_at ASC NULLS LAST, priority DESC, created_at ASC
         LIMIT $${params.length}`,
        params,
      );

      return ok(
        { todos: rows.map(shape), count: rows.length },
        `${rows.length} ${status} todo${rows.length === 1 ? '' : 's'}`,
      );
    },
  },

  {
    name: 'todo.search',
    description:
      'Substring search across todo titles and notes. Use when the user half-remembers a todo ("the thing ' +
      'about the deck") or when you need to find todos about a person, project, or email thread. For listing ' +
      'everything, use todo.list instead. Notes are truncated per result; use the returned id with todo.update ' +
      'to see or change the full text.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Case-insensitive substring. All whitespace-separated terms must match.' },
        status: { type: 'string', enum: [...STATUSES], description: 'Restrict to a status. Omit to search all.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 20.' },
      },
      required: ['query'],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:todo:read'],
    reversible: false,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const raw = typeof a.query === 'string' ? a.query.trim() : '';
      if (!raw) return fail(ERROR.INVALID_ARGS, 'query is required.');
      const terms = raw.split(/\s+/).filter(Boolean).slice(0, 8);

      const status = a.status;
      if (status !== undefined && status !== null && !isStatus(status)) {
        return fail(ERROR.INVALID_ARGS, `status must be one of ${STATUSES.join(', ')}.`);
      }
      const limit = boundedInt(a.limit, 20, 1, 50);

      const where: string[] = ['user_id = $1'];
      const params: unknown[] = [ctx.userId];
      for (const term of terms) {
        params.push(`%${term}%`);
        where.push(`(title ILIKE $${params.length} OR COALESCE(notes, '') ILIKE $${params.length})`);
      }
      if (status) {
        params.push(status);
        where.push(`status = $${params.length}`);
      }
      params.push(limit);

      const rows = await db.queryFresh<TodoRow>(
        `SELECT ${TODO_COLUMNS} FROM todos WHERE ${where.join(' AND ')}
         ORDER BY updated_at DESC
         LIMIT $${params.length}`,
        params,
      );

      return ok(
        { todos: rows.map((r) => ({ ...shape(r), notes: cap(r.notes) })), count: rows.length },
        `${rows.length} match${rows.length === 1 ? '' : 'es'} for "${raw}"`,
      );
    },
  },

  {
    name: 'todo.update',
    description:
      'Change a todo\'s title, notes, priority, due date, or status. Use when the user amends an existing todo ' +
      'rather than adding a new one. Only the fields you pass are changed. To mark something finished use ' +
      'todo.complete instead — it records when it was completed.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Todo id, as returned by todo.create / todo.list.' },
        title: { type: 'string' },
        notes: { type: 'string', description: 'Replaces the existing notes.' },
        priority: { type: 'integer', minimum: 1, maximum: 10 },
        due_at: { type: 'string', description: 'ISO-8601 date or datetime.' },
        status: { type: 'string', enum: [...STATUSES] },
      },
      required: ['id'],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:todo:write'],
    reversible: true,
    sideEffecting: true,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const id = a.id;
      if (typeof id !== 'string' || !UUID_RE.test(id)) return badId();

      // Column names come from this fixed whitelist, never from model input.
      const sets: string[] = [];
      const params: unknown[] = [ctx.userId, id];
      const push = (col: string, val: unknown) => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };

      if (a.title !== undefined) {
        const title = typeof a.title === 'string' ? a.title.trim() : '';
        if (!title) return fail(ERROR.INVALID_ARGS, 'title must be a non-empty string.');
        push('title', title);
      }
      if (a.notes !== undefined) {
        push('notes', typeof a.notes === 'string' && a.notes.trim() ? a.notes.trim() : null);
      }
      if (a.priority !== undefined) push('priority', boundedInt(a.priority, 5, 1, 10));
      if (a.due_at !== undefined) {
        const due = a.due_at === null ? null : String(a.due_at).trim();
        if (due && Number.isNaN(Date.parse(due))) {
          return fail(ERROR.INVALID_ARGS, `due_at is not a parseable date: ${due}`);
        }
        push('due_at', due || null);
      }
      if (a.status !== undefined) {
        if (!isStatus(a.status)) return fail(ERROR.INVALID_ARGS, `status must be one of ${STATUSES.join(', ')}.`);
        push('status', a.status);
        if (a.status === 'done') push('completed_at', new Date().toISOString());
        else push('completed_at', null);
      }

      if (!sets.length) {
        return fail(ERROR.INVALID_ARGS, 'Nothing to update — pass at least one of title, notes, priority, due_at, status.');
      }

      const row = await db.oneFresh<TodoRow>(
        `UPDATE todos SET ${sets.join(', ')}, updated_at = NOW()
         WHERE user_id = $1 AND id = $2
         RETURNING ${TODO_COLUMNS}`,
        params,
      );
      if (!row) return fail(ERROR.NOT_FOUND, `No todo with id ${id}.`);

      await ctx.describe({ summary: `Updated todo "${row.title}"`, reversible: true });
      return ok({ todo: shape(row) }, `Updated todo "${row.title}"`);
    },
  },

  {
    name: 'todo.complete',
    description:
      'Mark a todo done and stamp the completion time. Use when the user says they finished something, or when ' +
      'you have verified the outcome. Not reversible by re-calling — use todo.reopen to undo.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Todo id.' } },
      required: ['id'],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:todo:write'],
    reversible: true,
    sideEffecting: true,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const id = a.id;
      if (typeof id !== 'string' || !UUID_RE.test(id)) return badId();

      const row = await db.oneFresh<TodoRow>(
        `UPDATE todos
         SET status = 'done', completed_at = NOW(), updated_at = NOW()
         WHERE user_id = $1 AND id = $2 AND status <> 'done'
         RETURNING ${TODO_COLUMNS}`,
        [ctx.userId, id],
      );
      if (row) {
        await ctx.describe({ summary: `Completed todo "${row.title}"`, reversible: true });
        return ok({ todo: shape(row) }, `Completed "${row.title}"`);
      }

      // Either it does not exist, or it was already done. Idempotent success
      // for the second case keeps a retried call from reporting a false error.
      const existing = await fetchOne(db, ctx.userId, id);
      if (!existing) return fail(ERROR.NOT_FOUND, `No todo with id ${id}.`);
      return ok(
        { todo: shape(existing), unchanged: true },
        `"${existing.title}" was already done`,
      );
    },
  },

  {
    name: 'todo.reopen',
    description:
      'Return a done or dropped todo to open, clearing its completion time. Use when the user says a finished ' +
      'item is not actually finished. For something that was never started, prefer todo.drop.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Todo id.' } },
      required: ['id'],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:todo:write'],
    reversible: true,
    sideEffecting: true,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const id = a.id;
      if (typeof id !== 'string' || !UUID_RE.test(id)) return badId();

      const row = await db.oneFresh<TodoRow>(
        `UPDATE todos
         SET status = 'open', completed_at = NULL, updated_at = NOW()
         WHERE user_id = $1 AND id = $2
         RETURNING ${TODO_COLUMNS}`,
        [ctx.userId, id],
      );
      if (!row) return fail(ERROR.NOT_FOUND, `No todo with id ${id}.`);

      await ctx.describe({ summary: `Reopened todo "${row.title}"`, reversible: true });
      return ok({ todo: shape(row) }, `Reopened "${row.title}"`);
    },
  },

  {
    name: 'todo.drop',
    description:
      'Mark a todo as dropped — the work is not going to happen, but the record is kept. Use when the user ' +
      'cancels or declines a task. Do NOT use to record completion; that is todo.complete. Use todo.reopen to ' +
      'resurrect a dropped todo.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Todo id.' } },
      required: ['id'],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:todo:write'],
    reversible: true,
    sideEffecting: true,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const id = a.id;
      if (typeof id !== 'string' || !UUID_RE.test(id)) return badId();

      const row = await db.oneFresh<TodoRow>(
        `UPDATE todos
         SET status = 'dropped', completed_at = NULL, updated_at = NOW()
         WHERE user_id = $1 AND id = $2
         RETURNING ${TODO_COLUMNS}`,
        [ctx.userId, id],
      );
      if (!row) return fail(ERROR.NOT_FOUND, `No todo with id ${id}.`);

      await ctx.describe({ summary: `Dropped todo "${row.title}"`, reversible: true });
      return ok({ todo: shape(row) }, `Dropped "${row.title}"`);
    },
  },

  {
    name: 'todo.reorder',
    description:
      'Set the manual display order of a set of todos. Provide ids top-to-bottom in the order the user asked ' +
      'for; each gets position 0, 1, 2, ... Every id must belong to the user or the whole call fails, so pass ' +
      'the complete list you want reordered rather than a partial patch.',
    parameters: {
      type: 'object',
      properties: {
        ids: {
          type: 'array',
          items: { type: 'string', description: 'Todo id.' },
          minItems: 1,
          maxItems: 200,
          description: 'Todo ids in the desired top-to-bottom order.',
        },
      },
      required: ['ids'],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:todo:write'],
    reversible: true,
    sideEffecting: true,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const rawIds = Array.isArray(a.ids) ? a.ids : [];
      if (!rawIds.length) return fail(ERROR.INVALID_ARGS, 'ids must be a non-empty array of todo ids.');

      const ids: string[] = [];
      for (const id of rawIds.slice(0, 200)) {
        if (typeof id !== 'string' || !UUID_RE.test(id)) return badId();
        if (ids.includes(id)) return fail(ERROR.INVALID_ARGS, `duplicate id in ids: ${id}`);
        ids.push(id);
      }

      // One statement for the whole batch: any id owned by someone else simply
      // fails to match, and the count check surfaces it without a partial write.
      const params: unknown[] = [ctx.userId, ids];
      const row = await db.oneFresh<{ count: number }>(
        `WITH requested AS (
           SELECT unnest($2::uuid[]) AS id
         ), ranked AS (
           SELECT id, array_position($2::uuid[], id) AS ord FROM requested
         ), claimed AS (
           UPDATE todos SET position = ranked.ord - 1, updated_at = NOW()
           FROM ranked
           WHERE todos.id = ranked.id AND todos.user_id = $1
           RETURNING todos.id
         )
         SELECT COUNT(*)::int AS count FROM claimed`,
        params,
      );

      const updated = row?.count ?? 0;
      if (updated !== ids.length) {
        return fail(
          ERROR.NOT_FOUND,
          `Reordered ${updated} of ${ids.length} todos; the rest do not exist. Nothing else was changed.`,
        );
      }

      await ctx.describe({ summary: `Reordered ${updated} todo${updated === 1 ? '' : 's'}`, reversible: true });
      return ok({ ids, count: updated }, `Reordered ${updated} todo${updated === 1 ? '' : 's'}`);
    },
  },
] as ToolDefinition<never, unknown>[];
