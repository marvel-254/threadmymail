/**
 * Memory tools.
 *
 * `pinned` is deliberately absent from every argument schema. Pinned memories
 * are the user's locked set — they outrank the model's judgement and survive
 * retention pruning, so a prompt-injected email must not be able to create
 * one. Only the user can pin, through their own surface.
 *
 * Queries are fully parameterised; memory content is derived from untrusted
 * email text and is never concatenated into SQL.
 */

import { ERROR, fail, ok, type ToolDefinition, type ToolResult } from './registry';
import { MEMORY_COLUMNS, type Db, type Row } from '../db/client';
import type { DbToolContext } from './todo';

const KINDS = ['fact', 'preference', 'commitment', 'person'] as const;
type Kind = (typeof KINDS)[number];

const CONTENT_CAP = 300;

interface MemoryRow extends Row {
  id: string;
  kind: Kind;
  content: string;
  importance: number;
  pinned: boolean;
  source_ref: string | null;
  created_at: Date | string;
}

function getDb(ctx: DbToolContext): Db | null {
  return ctx.db ?? null;
}

function cap(s: string | null, n = CONTENT_CAP): string | null {
  if (s === null) return null;
  return s.length > n ? `${s.slice(0, n)}…` : s;
}

function shape(r: MemoryRow, withContent = true) {
  return {
    id: r.id,
    kind: r.kind,
    content: withContent ? r.content : cap(r.content),
    content_truncated: withContent ? false : (r.content?.length ?? 0) > CONTENT_CAP,
    importance: r.importance,
    pinned: r.pinned,
    source_ref: r.source_ref,
    created_at: r.created_at,
  };
}

function isKind(v: unknown): v is Kind {
  return typeof v === 'string' && (KINDS as readonly string[]).includes(v);
}

function boundedInt(v: unknown, fallback: number, min: number, max: number): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badId(): ToolResult<never> {
  return fail(ERROR.INVALID_ARGS, 'id must be a UUID.');
}

export const memoryTools: ToolDefinition<never, unknown>[] = [
  {
    name: 'memory.remember',
    description:
      'Store a durable fact, preference, commitment, or person note about the user. Use when you learn ' +
      'something that should still be true in a week: a stated preference ("never schedule before 10am"), a ' +
      'standing commitment ("renew the passport in March"), a durable fact about a person ("Dana is the ' +
      'head of finance"), or a stable fact about the user themselves. Do NOT store transient state, anything ' +
      'already in the calendar, or anything the user asked you not to remember. Check memory.recall or ' +
      'memory.list_pinned first for an existing memory on the same topic — prefer updating it over duplicating. ' +
      'You cannot pin a memory here; that is user-only. Returns the created memory with its id.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: [...KINDS], description: 'What sort of memory this is.' },
        content: { type: 'string', description: 'One self-contained statement, written so it makes sense alone later.' },
        importance: { type: 'integer', minimum: 1, maximum: 10, description: '1 = trivial, 10 = core identity or a hard deadline. Default 5.' },
        source_ref: { type: 'string', description: 'Opaque pointer back to where this was learned, e.g. an email id.' },
      },
      required: ['kind', 'content'],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:memory:write'],
    reversible: true,
    sideEffecting: true,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      if (!isKind(a.kind)) return fail(ERROR.INVALID_ARGS, `kind must be one of ${KINDS.join(', ')}.`);
      const content = typeof a.content === 'string' ? a.content.trim() : '';
      if (!content) return fail(ERROR.INVALID_ARGS, 'content is required and must be non-empty.');
      if (content.length > 4000) {
        return fail(ERROR.INVALID_ARGS, 'content is too long — store one statement, not a document.');
      }
      const importance = boundedInt(a.importance, 5, 1, 10);
      const sourceRef = typeof a.source_ref === 'string' && a.source_ref.trim() ? a.source_ref.trim() : null;

      const row = await db.oneFresh<MemoryRow>(
        `INSERT INTO memories (user_id, kind, content, importance, pinned, source_ref)
         VALUES ($1, $2, $3, $4, FALSE, $5)
         RETURNING ${MEMORY_COLUMNS}`,
        [ctx.userId, a.kind, content, importance, sourceRef],
      );
      if (!row) return fail(ERROR.INTERNAL, 'Memory insert returned no row.');

      await ctx.describe({ summary: `Remembered (${row.kind}): ${cap(row.content, 80)}`, reversible: true });
      return ok({ memory: shape(row) }, `Remembered: ${cap(row.content, 80)}`);
    },
  },

  {
    name: 'memory.recall',
    description:
      'Search the user\'s stored memories for text matching a query. Call this before answering questions ' +
      'about the user\'s preferences, people, or past commitments, and before creating a memory that might ' +
      'already exist. This is keyword matching, not semantic — it finds shared words, so query with the ' +
      'specific nouns you remember rather than a paraphrase. Pair with memory.list_pinned for the always-' +
      'relevant set.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Text to search for in memory content.' },
        kind: { type: 'string', enum: [...KINDS], description: 'Restrict to one kind. Omit to search all.' },
        limit: { type: 'integer', minimum: 1, maximum: 50, description: 'Default 10.' },
      },
      required: ['query'],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:memory:read'],
    reversible: false,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const raw = typeof a.query === 'string' ? a.query.trim() : '';
      if (!raw) return fail(ERROR.INVALID_ARGS, 'query is required.');
      if (a.kind !== undefined && a.kind !== null && !isKind(a.kind)) {
        return fail(ERROR.INVALID_ARGS, `kind must be one of ${KINDS.join(', ')}.`);
      }
      const limit = boundedInt(a.limit, 10, 1, 50);

      const terms = raw.split(/\s+/).filter(Boolean).slice(0, 8);
      const params: unknown[] = [ctx.userId];
      const where: string[] = ['user_id = $1'];
      for (const term of terms) {
        params.push(`%${term}%`);
        where.push(`content ILIKE $${params.length}`);
      }
      if (a.kind) {
        params.push(a.kind);
        where.push(`kind = $${params.length}`);
      }
      params.push(limit);

      // Fresh: memories are frequently written and re-read in the same turn, and
      // a stale recall would contradict a memory we just stored.
      const rows = await db.queryFresh<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM memories WHERE ${where.join(' AND ')}
         ORDER BY pinned DESC, importance DESC, created_at DESC
         LIMIT $${params.length}`,
        params,
      );

      return ok(
        { memories: rows.map((r) => shape(r, false)), count: rows.length },
        `${rows.length} memor${rows.length === 1 ? 'y' : 'ies'} matched "${raw}"`,
      );
    },
  },

  {
    name: 'memory.list_pinned',
    description:
      'Return the user\'s pinned memories — the locked, always-relevant set they have chosen to keep. Read this ' +
      'at the start of any task where their standing preferences or constraints would change the answer, and ' +
      'before writing new memories, so you do not contradict one. Small by design; returns full content. ' +
      'Unpinned memories are not included here — use memory.recall for those.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:memory:read'],
    reversible: false,
    source: 'builtin',
    async execute(_args, ctx) {
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const rows = await db.queryFresh<MemoryRow>(
        `SELECT ${MEMORY_COLUMNS} FROM memories WHERE user_id = $1 AND pinned = TRUE
         ORDER BY importance DESC, created_at ASC`,
        [ctx.userId],
      );

      return ok(
        { memories: rows.map((r) => shape(r)), count: rows.length },
        `${rows.length} pinned memor${rows.length === 1 ? 'y' : 'ies'}`,
      );
    },
  },

  {
    name: 'memory.update',
    description:
      'Edit an existing memory in place — its content, importance, or kind. Use instead of creating a second ' +
      'memory when what you already stored is now out of date or was recorded imprecisely. This never changes ' +
      'pinned state, and cannot create a memory: if there is no matching id the call fails.',
    parameters: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Memory id.' },
        content: { type: 'string', description: 'Replacement text. Replaces the whole content.' },
        importance: { type: 'integer', minimum: 1, maximum: 10 },
        kind: { type: 'string', enum: [...KINDS] },
      },
      required: ['id'],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:memory:write'],
    reversible: true,
    sideEffecting: true,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const id = a.id;
      if (typeof id !== 'string' || !UUID_RE.test(id)) return badId();
      if (a.kind !== undefined && a.kind !== null && !isKind(a.kind)) {
        return fail(ERROR.INVALID_ARGS, `kind must be one of ${KINDS.join(', ')}.`);
      }

      const sets: string[] = [];
      const params: unknown[] = [ctx.userId, id];
      const push = (col: string, val: unknown) => {
        params.push(val);
        sets.push(`${col} = $${params.length}`);
      };

      if (a.content !== undefined) {
        const content = typeof a.content === 'string' ? a.content.trim() : '';
        if (!content) return fail(ERROR.INVALID_ARGS, 'content must be a non-empty string.');
        if (content.length > 4000) return fail(ERROR.INVALID_ARGS, 'content is too long.');
        push('content', content);
      }
      if (a.importance !== undefined) push('importance', boundedInt(a.importance, 5, 1, 10));
      if (a.kind !== undefined && a.kind !== null) push('kind', a.kind);

      if (!sets.length) {
        return fail(ERROR.INVALID_ARGS, 'Nothing to update — pass at least one of content, importance, kind.');
      }

      const row = await db.oneFresh<MemoryRow>(
        `UPDATE memories SET ${sets.join(', ')} WHERE user_id = $1 AND id = $2 RETURNING ${MEMORY_COLUMNS}`,
        params,
      );
      if (!row) return fail(ERROR.NOT_FOUND, `No memory with id ${id}.`);

      await ctx.describe({ summary: `Updated memory: ${cap(row.content, 80)}`, reversible: true });
      return ok({ memory: shape(row) }, 'Memory updated');
    },
  },

  {
    name: 'memory.forget',
    description:
      'Permanently delete one memory by its exact id. Use when the user asks you to forget something specific, ' +
      'or when a memory is demonstrably wrong and the user agrees to its removal. There is no undo and no ' +
      'search-then-delete: you must already know the id (from memory.recall or memory.list_pinned). Never ' +
      'guess ids, and never delete a pinned memory on your own initiative — ask the user first.',
    parameters: {
      type: 'object',
      properties: { id: { type: 'string', description: 'Exact memory id to delete.' } },
      required: ['id'],
      additionalProperties: false,
    } as unknown as Record<string, unknown>,
    permissions: ['data:memory:write'],
    reversible: false,
    sideEffecting: true,
    source: 'builtin',
    async execute(args, ctx) {
      const a = args as Record<string, unknown>;
      const db = getDb(ctx as DbToolContext);
      if (!db) return fail(ERROR.INTERNAL, 'No database binding available.');

      const id = a.id;
      if (typeof id !== 'string' || !UUID_RE.test(id)) return badId();

      const row = await db.oneFresh<MemoryRow>(
        `DELETE FROM memories WHERE user_id = $1 AND id = $2 RETURNING ${MEMORY_COLUMNS}`,
        [ctx.userId, id],
      );
      if (!row) return fail(ERROR.NOT_FOUND, `No memory with id ${id}.`);

      await ctx.describe({ summary: `Forgot memory: ${cap(row.content, 80)}`, reversible: false });
      return ok({ id: row.id, deleted: true }, `Forgot: ${cap(row.content, 80)}`);
    },
  },
] as ToolDefinition<never, unknown>[];
