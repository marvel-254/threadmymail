/**
 * REST surface (docs/API.md) for todos, activity, settings, kill switch,
 * skills, memories and artifacts.
 *
 * Mounted at /v1 by src/index.ts (Phase 1 wiring) — the paths below are
 * relative to that prefix, matching frontend/src/lib/api.js.
 *
 * Two rules dominate every handler here:
 *   - Every statement is parameterized. No value is ever interpolated.
 *   - Every read that follows a write, or returns something the user just
 *     changed, goes through DB_FRESH (see src/db/client.ts and ARCHITECTURE §6).
 */

import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  Db,
  EMAIL_METADATA_COLUMNS,
  MEMORY_COLUMNS,
  TODO_COLUMNS,
  type DbEnv,
  type Row,
} from '../db/client.js';
import { BodyStore } from '../storage/bodystore.js';
import { ERROR } from '../tools/registry.js';

type Bindings = DbEnv & {
  /** D1 blob store. Email bodies only — Postgres holds the key (invariant 4). */
  BODIES: D1Database;
};

type Vars = { Bindings: Bindings };

const routes = new Hono<Vars>();

// ── Identity ───────────────────────────────────────────────────────────────

/**
 * TODO(phase-2): replace with the authenticated principal from the Google
 * OAuth session (docs/GOOGLE_OAUTH.md). Until then every request is attributed
 * to one fixed development user so the UI is usable without a login flow.
 */
const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function getUserId(c: Context<Vars>): string {
  const header = c.req.header('X-User-Id');
  if (!header) return DEV_USER_ID;
  if (!UUID_RE.test(header)) {
    throw new HttpError(ERROR.FORBIDDEN, 'X-User-Id must be a UUID.', 400);
  }
  return header;
}

function db(c: Context<Vars>): Db {
  return new Db(c.env);
}

function bodies(c: Context<Vars>): BodyStore {
  return new BodyStore(c.env.BODIES);
}

// ── Envelope ───────────────────────────────────────────────────────────────

class HttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function ok<T>(data: T, status = 200): Response {
  return json(status, { success: true, data, error: null });
}

function fail(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(error.status, {
      success: false,
      data: null,
      error: { code: error.code, message: error.message, detail: null },
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error('[routes] unhandled', message);
  return json(500, {
    success: false,
    data: null,
    error: { code: ERROR.INTERNAL, message: 'Unexpected error.', detail: null },
  });
}

function notFound(what: string): HttpError {
  return new HttpError(ERROR.NOT_FOUND, `${what} not found.`, 404);
}

/** Wraps a handler so every thrown error becomes the standard error envelope. */
function handler(fn: (c: Context<Vars>) => Promise<Response>) {
  return async (c: Context<Vars>): Promise<Response> => {
    try {
      return await fn(c);
    } catch (error) {
      return fail(error);
    }
  };
}

// ── Parsing / validation helpers ────────────────────────────────────────────

type Json = Record<string, unknown>;

async function readJson(c: Context<Vars>): Promise<Json> {
  let parsed: unknown;
  try {
    parsed = await c.req.json();
  } catch {
    throw new HttpError(ERROR.INVALID_ARGS, 'Body must be JSON.', 400);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new HttpError(ERROR.INVALID_ARGS, 'Body must be a JSON object.', 400);
  }
  return parsed as Json;
}

function optString(body: Json, key: string, max = 10_000): string | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new HttpError(ERROR.INVALID_ARGS, `${key} must be a string.`, 400);
  }
  if (value.length > max) {
    throw new HttpError(ERROR.INVALID_ARGS, `${key} is too long.`, 400);
  }
  return value;
}

function nullableString(body: Json, key: string, max = 10_000): string | null | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null) return null;
  return optString(body, key, max);
}

function requireString(body: Json, key: string, max = 10_000): string {
  const value = optString(body, key, max);
  if (value === undefined || value.trim() === '') {
    throw new HttpError(ERROR.INVALID_ARGS, `${key} is required.`, 400);
  }
  return value;
}

function optInt(body: Json, key: string, min?: number, max?: number): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new HttpError(ERROR.INVALID_ARGS, `${key} must be a number.`, 400);
  }
  const int = Math.trunc(value);
  if (min !== undefined && int < min) {
    throw new HttpError(ERROR.INVALID_ARGS, `${key} must be >= ${min}.`, 400);
  }
  if (max !== undefined && int > max) {
    throw new HttpError(ERROR.INVALID_ARGS, `${key} must be <= ${max}.`, 400);
  }
  return int;
}

function optBool(body: Json, key: string): boolean | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'boolean') {
    throw new HttpError(ERROR.INVALID_ARGS, `${key} must be a boolean.`, 400);
  }
  return value;
}

function optJson(body: Json, key: string): Record<string, unknown> | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(ERROR.INVALID_ARGS, `${key} must be a JSON object.`, 400);
  }
  return value as Record<string, unknown>;
}

function optStringArray(body: Json, key: string): string[] | undefined {
  const value = body[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.some((v) => typeof v !== 'string')) {
    throw new HttpError(ERROR.INVALID_ARGS, `${key} must be an array of strings.`, 400);
  }
  return value as string[];
}

function oneOf<T extends string>(body: Json, key: string, allowed: readonly T[]): T | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string' || !allowed.includes(value as T)) {
    throw new HttpError(
      ERROR.INVALID_ARGS,
      `${key} must be one of: ${allowed.join('|')}.`,
      400,
    );
  }
  return value as T;
}

function uuidParam(c: Context<Vars>, name: string): string {
  const value = c.req.param(name);
  if (!value || !UUID_RE.test(value)) {
    throw new HttpError(ERROR.INVALID_ARGS, `${name} must be a UUID.`, 400);
  }
  return value;
}

function limitParam(c: Context<Vars>, fallback: number, max: number): number {
  const raw = c.req.query('limit');
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    throw new HttpError(ERROR.INVALID_ARGS, 'limit must be a positive number.', 400);
  }
  return Math.min(Math.trunc(value), max);
}

function asRecord(row: Row | null): Json | null {
  return row ? (row as Json) : null;
}

// ── Todos ──────────────────────────────────────────────────────────────────

const TODO_ORDER = 'ORDER BY status ASC, position ASC, due_at ASC NULLS LAST, created_at DESC';

routes.get('/todos', handler(async (c) => {
  const userId = getUserId(c);
  const params: unknown[] = [userId];
  const where: string[] = ['user_id = $1'];

  const status = c.req.query('status');
  if (status) {
    params.push(status);
    where.push(`status = $${params.length}`);
  }

  const dueBefore = c.req.query('due_before');
  if (dueBefore) {
    params.push(dueBefore);
    where.push(`due_at IS NOT NULL AND due_at <= $${params.length}::timestamptz`);
  }

  const source = c.req.query('source');
  if (source) {
    params.push(source);
    where.push(`source = $${params.length}`);
  }

  const threadId = c.req.query('thread_id');
  if (threadId) {
    params.push(threadId);
    where.push(`thread_id = $${params.length}`);
  }

  const cursor = c.req.query('cursor');
  if (cursor) {
    if (!UUID_RE.test(cursor)) {
      throw new HttpError(ERROR.INVALID_ARGS, 'cursor must be a UUID.', 400);
    }
    params.push(cursor);
    where.push(`(due_at, id) < (SELECT due_at, id FROM todos WHERE id = $${params.length})`);
  }

  params.push(limitParam(c, 50, 500));
  const rows = await db(c).queryFresh(
    `SELECT ${TODO_COLUMNS} FROM todos WHERE ${where.join(' AND ')} ${TODO_ORDER} LIMIT $${params.length}`,
    params,
  );
  return ok(rows);
}));

routes.get('/todos/:id', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const row = await db(c).oneFresh<Row>(
    `SELECT ${TODO_COLUMNS} FROM todos WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!row) throw notFound('Todo');
  return ok(row);
}));

routes.post('/todos', handler(async (c) => {
  const userId = getUserId(c);
  const body = await readJson(c);
  const title = requireString(body, 'title', 1_000);
  const notes = nullableString(body, 'notes', 20_000);
  const dueAt = nullableString(body, 'due_at', 64);
  const priority = optInt(body, 'priority', 0, 10);
  const source = optString(body, 'source', 64);
  const sourceRef = nullableString(body, 'source_ref', 512);
  const threadId = nullableString(body, 'thread_id', 512);
  const calendarEventId = nullableString(body, 'calendar_event_id', 512);

  const row = await db(c).oneFresh<Row>(
    `INSERT INTO todos (
       user_id, title, notes, status, priority, due_at, source, source_ref,
       thread_id, calendar_event_id, position
     ) VALUES (
       $1, $2, $3, 'open', COALESCE($4, 0), $5::timestamptz, $6, $7, $8, $9,
       COALESCE((SELECT MAX(position) + 1 FROM todos WHERE user_id = $1), 0)
     )
     RETURNING ${TODO_COLUMNS}`,
    [userId, title, notes ?? null, priority ?? null, dueAt, source ?? null, sourceRef, threadId, calendarEventId],
  );
  return ok(asRecord(row), 201);
}));

routes.patch('/todos/:id', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const body = await readJson(c);

  // Column whitelist: nothing from the body reaches SQL as an identifier.
  const fields: [string, unknown][] = [];
  const title = optString(body, 'title', 1_000);
  if (title !== undefined) fields.push(['title', title]);
  const notes = nullableString(body, 'notes', 20_000);
  if (notes !== undefined) fields.push(['notes', notes]);
  const dueAt = nullableString(body, 'due_at', 64);
  if (dueAt !== undefined) fields.push(['due_at', `${dueAt}::timestamptz`]);
  const priority = optInt(body, 'priority', 0, 10);
  if (priority !== undefined) fields.push(['priority', priority]);
  const source = optString(body, 'source', 64);
  if (source !== undefined) fields.push(['source', source]);
  const sourceRef = nullableString(body, 'source_ref', 512);
  if (sourceRef !== undefined) fields.push(['source_ref', sourceRef]);
  const threadId = nullableString(body, 'thread_id', 512);
  if (threadId !== undefined) fields.push(['thread_id', threadId]);
  const calendarEventId = nullableString(body, 'calendar_event_id', 512);
  if (calendarEventId !== undefined) fields.push(['calendar_event_id', calendarEventId]);
  const status = oneOf(body, 'status', ['open', 'done', 'dropped'] as const);
  if (status !== undefined) fields.push(['status', status]);
  const position = optInt(body, 'position', 0);
  if (position !== undefined) fields.push(['position', position]);

  if (fields.length === 0) {
    throw new HttpError(ERROR.INVALID_ARGS, 'No updatable fields supplied.', 400);
  }

  const params: unknown[] = [id, userId];
  const sets = fields.map(([column, value]) => {
    params.push(value);
    return `${column} = $${params.length}`;
  });
  sets.push('completed_at = CASE WHEN $3 = \'done\' THEN NOW() ELSE NULL END');
  params.push(status ?? null);

  const row = await db(c).oneFresh<Row>(
    `UPDATE todos SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING ${TODO_COLUMNS}`,
    params,
  );
  if (!row) throw notFound('Todo');
  return ok(row);
}));

routes.post('/todos/:id/toggle', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const body = await readJson(c);
  const done = optBool(body, 'done');
  if (done === undefined) {
    throw new HttpError(ERROR.INVALID_ARGS, 'done must be a boolean.', 400);
  }

  // Artifact binding target: the checkbox in Today and in every agent frame
  // resolves against this response, so it must come from DB_FRESH.
  const row = await db(c).oneFresh<Row>(
    `UPDATE todos
     SET status = CASE WHEN $3 THEN 'done' ELSE 'open' END,
         completed_at = CASE WHEN $3 THEN NOW() ELSE NULL END,
         updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING ${TODO_COLUMNS}`,
    [id, userId, done],
  );
  if (!row) throw notFound('Todo');
  return ok(row);
}));

routes.post('/todos/reorder', handler(async (c) => {
  const userId = getUserId(c);
  const body = await readJson(c);
  const raw = body.ids;
  if (!Array.isArray(raw) || raw.length === 0 || raw.some((v) => typeof v !== 'string' || !UUID_RE.test(v))) {
    throw new HttpError(ERROR.INVALID_ARGS, 'ids must be a non-empty array of UUIDs.', 400);
  }
  const ids = raw as string[];

  const rows = await db(c).queryFresh<Row>(
    `UPDATE todos SET position = ord.ord - 1, updated_at = NOW()
     FROM unnest($1::uuid[]) WITH ORDINALITY AS ord(id, ord)
     WHERE todos.id = ord.id AND todos.user_id = $2
     RETURNING ${TODO_COLUMNS}`,
    [ids, userId],
  );
  if (rows.length !== ids.length) throw notFound('Todo');
  return ok(rows);
}));

routes.delete('/todos/:id', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const row = await db(c).oneFresh<Row>(
    `DELETE FROM todos WHERE id = $1 AND user_id = $2 RETURNING ${TODO_COLUMNS}`,
    [id, userId],
  );
  if (!row) throw notFound('Todo');
  return ok({ id, deleted: true });
}));

// ── Activity & undo ────────────────────────────────────────────────────────

const ACTIVITY_COLUMNS = 'id, user_id, run_id, kind, summary, reversible, undo_ref, undone_at, created_at';

routes.get('/activity', handler(async (c) => {
  const userId = getUserId(c);
  const params: unknown[] = [userId];
  const where: string[] = ['user_id = $1'];

  const kind = c.req.query('kind');
  if (kind) {
    params.push(kind);
    where.push(`kind = $${params.length}`);
  }
  const reversible = c.req.query('reversible');
  if (reversible === 'true' || reversible === 'false') {
    params.push(reversible === 'true');
    where.push(`reversible = $${params.length}`);
  }
  const before = c.req.query('before');
  if (before) {
    params.push(before);
    where.push(`created_at < $${params.length}::timestamptz`);
  }

  params.push(limitParam(c, 100, 500));
  const rows = await db(c).queryFresh(
    `SELECT ${ACTIVITY_COLUMNS} FROM activity
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}`,
    params,
  );
  return ok(rows);
}));

routes.get('/activity/:id', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const row = await db(c).oneFresh<Row>(
    `SELECT ${ACTIVITY_COLUMNS} FROM activity WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!row) throw notFound('Activity');
  return ok(row);
}));

routes.post('/activity/:id/undo', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');

  // Reversal only: the undo engine (actually retracting the action) lands in
  // Phase 4. Repeating the call is a no-op, so the endpoint is idempotent.
  const row = await db(c).oneFresh<Row>(
    `UPDATE activity SET undone_at = NOW()
     WHERE id = $1 AND user_id = $2 AND reversible = TRUE AND undone_at IS NULL
     RETURNING ${ACTIVITY_COLUMNS}`,
    [id, userId],
  );
  if (row) return ok(row);

  const existing = await db(c).oneFresh<Row>(
    `SELECT ${ACTIVITY_COLUMNS} FROM activity WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!existing) throw notFound('Activity');
  return ok(existing);
}));

// ── Settings ───────────────────────────────────────────────────────────────

const USER_SETTINGS_COLUMNS = 'persona, profile, ai_config, prefs, budget_state, updated_at';

type UserRow = {
  persona: string | null;
  profile: Json;
  ai_config: Json;
  prefs: Json;
  budget_state: Json;
};

function settingsPayload(row: UserRow): Json {
  return {
    persona: row.persona,
    profile: row.profile,
    ai_config: row.ai_config,
    prefs: row.prefs,
    budget: row.budget_state,
  };
}

async function readSettings(c: Context<Vars>, userId: string): Promise<Json> {
  const row = await db(c).oneFresh<UserRow & Row>(
    `SELECT ${USER_SETTINGS_COLUMNS} FROM users WHERE id = $1`,
    [userId],
  );
  if (!row) throw notFound('User');
  return settingsPayload(row);
}

routes.get('/settings', handler(async (c) => {
  return ok(await readSettings(c, getUserId(c)));
}));

const CONTACT_POLICIES = ['ask', 'allow', 'block'] as const;

routes.put('/settings', handler(async (c) => {
  const userId = getUserId(c);
  const body = await readJson(c);

  const prefs = optJson(body, 'prefs');
  if (prefs && 'new_contact_policy' in prefs) {
    const policy = prefs['new_contact_policy'];
    const okPolicy =
      typeof policy === 'string' && CONTACT_POLICIES.includes(policy as (typeof CONTACT_POLICIES)[number]);
    if (!okPolicy) {
      throw new HttpError(
        ERROR.FORBIDDEN,
        `prefs.new_contact_policy must be one of: ${CONTACT_POLICIES.join('|')}.`,
        400,
      );
    }
  }

  const params: unknown[] = [userId];
  const sets: string[] = [];

  if ('persona' in body) {
    const persona = nullableString(body, 'persona', 100_000);
    params.push(persona ?? null);
    sets.push(`persona = $${params.length}`);
  }

  // Merge-patch: `||` overwrites only the keys present in the request body.
  for (const column of ['profile', 'ai_config'] as const) {
    const patch = optJson(body, column);
    if (patch) {
      params.push(JSON.stringify(patch));
      sets.push(`${column} = COALESCE(${column}, '{}'::jsonb) || $${params.length}::jsonb`);
    }
  }

  if (prefs) {
    params.push(JSON.stringify(prefs));
    sets.push(`prefs = COALESCE(prefs, '{}'::jsonb) || $${params.length}::jsonb`);
  }

  const budget = optJson(body, 'budget');
  if (budget) {
    params.push(JSON.stringify(budget));
    sets.push(`budget_state = COALESCE(budget_state, '{}'::jsonb) || $${params.length}::jsonb`);
  }

  if (sets.length === 0) {
    throw new HttpError(ERROR.INVALID_ARGS, 'No settings fields supplied.', 400);
  }

  const row = await db(c).oneFresh<UserRow & Row>(
    `UPDATE users SET ${sets.join(', ')}, updated_at = NOW()
     WHERE id = $1
     RETURNING ${USER_SETTINGS_COLUMNS}`,
    params,
  );
  if (!row) throw notFound('User');
  return ok(settingsPayload(row));
}));

routes.get('/settings/usage', handler(async (c) => {
  const userId = getUserId(c);
  // Fresh: the settings panel shows this immediately after a run starts.
  const row = await db(c).oneFresh<Row>(
    `SELECT
       COALESCE(SUM(tokens_in + tokens_out), 0)::int AS tokens,
       COALESCE(SUM(cost_usd), 0)::numeric(12,6) AS cost_usd,
       COUNT(*)::int AS runs
     FROM agent_runs
     WHERE user_id = $1 AND started_at >= date_trunc('day', NOW())`,
    [userId],
  );
  return ok({
    tokens: Number(row?.['tokens'] ?? 0),
    cost_usd: Number(row?.['cost_usd'] ?? 0),
    runs: Number(row?.['runs'] ?? 0),
  });
}));

// ── Kill switch ────────────────────────────────────────────────────────────

/**
 * No dedicated table: the switch is an autonomy setting, so it lives in
 * users.prefs under `kill_switch` alongside new_contact_policy. The agent loop
 * reads it at each step boundary.
 */
type KillSwitch = { global: boolean; skills: Record<string, boolean> };

function readKillSwitch(prefs: Json): KillSwitch {
  const stored = prefs['kill_switch'];
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) {
    return { global: false, skills: {} };
  }
  const record = stored as Json;
  const skills: Record<string, boolean> = {};
  const rawSkills = record['skills'];
  if (rawSkills && typeof rawSkills === 'object' && !Array.isArray(rawSkills)) {
    for (const [skillId, value] of Object.entries(rawSkills as Json)) {
      if (UUID_RE.test(skillId) && typeof value === 'boolean') skills[skillId] = value;
    }
  }
  return { global: record['global'] === true, skills };
}

routes.get('/kill-switch', handler(async (c) => {
  const userId = getUserId(c);
  const row = await db(c).oneFresh<Row>(`SELECT prefs FROM users WHERE id = $1`, [userId]);
  if (!row) throw notFound('User');
  const prefs = (row['prefs'] as Json | null) ?? {};
  return ok(readKillSwitch(prefs));
}));

routes.put('/kill-switch', handler(async (c) => {
  const userId = getUserId(c);
  const body = await readJson(c);

  const global = optBool(body, 'global');
  if (global === undefined) {
    throw new HttpError(ERROR.INVALID_ARGS, 'global must be a boolean.', 400);
  }
  const rawSkills = optJson(body, 'skills') ?? {};
  const skills: Record<string, boolean> = {};
  for (const [skillId, value] of Object.entries(rawSkills)) {
    if (!UUID_RE.test(skillId) || typeof value !== 'boolean') {
      throw new HttpError(ERROR.FORBIDDEN, 'skills must map skill UUIDs to booleans.', 400);
    }
    skills[skillId] = value;
  }

  const next: KillSwitch = { global, skills };
  const row = await db(c).oneFresh<Row>(
    `UPDATE users
     SET prefs = jsonb_set(COALESCE(prefs, '{}'::jsonb), '{kill_switch}', $2::jsonb, true),
         updated_at = NOW()
     WHERE id = $1
     RETURNING prefs`,
    [userId, JSON.stringify(next)],
  );
  if (!row) throw notFound('User');
  return ok(readKillSwitch((row['prefs'] as Json | null) ?? {}));
}));

// ── Skills ─────────────────────────────────────────────────────────────────

const SKILL_COLUMNS =
  'id, user_id, name, description, instructions, allowed_tools, trigger, budget, ' +
  'model_slot, enabled, dry_run_until, version, created_at, updated_at';

const SKILL_SELECT = `SELECT ${SKILL_COLUMNS}, last.last_run_at, last.runs_today
  FROM skills
  LEFT JOIN LATERAL (
    SELECT MAX(started_at) AS last_run_at, COUNT(*)::int AS runs_today
    FROM agent_runs
    WHERE agent_runs.skill_id = skills.id AND agent_runs.user_id = skills.user_id
      AND agent_runs.started_at >= date_trunc('day', NOW())
  ) AS last ON TRUE`;

routes.get('/skills', handler(async (c) => {
  const userId = getUserId(c);
  const rows = await db(c).queryFresh(
    `${SKILL_SELECT} WHERE skills.user_id = $1 ORDER BY skills.name ASC`,
    [userId],
  );
  return ok(rows);
}));

routes.get('/skills/:id', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const row = await db(c).oneFresh<Row>(`${SKILL_SELECT} WHERE skills.id = $1 AND skills.user_id = $2`, [
    id,
    userId,
  ]);
  if (!row) throw notFound('Skill');
  return ok(row);
}));

routes.post('/skills', handler(async (c) => {
  const userId = getUserId(c);
  const body = await readJson(c);
  const name = requireString(body, 'name', 120);
  const instructions = requireString(body, 'instructions', 100_000);
  const description = optString(body, 'description', 2_000);
  const allowedTools = optStringArray(body, 'allowed_tools') ?? [];
  const trigger = optJson(body, 'trigger') ?? { type: 'on_demand', config: {} };
  const budget = optJson(body, 'budget') ?? {};
  const modelSlot = optString(body, 'model_slot', 32) ?? 'inherit';
  const skipDryRun = optBool(body, 'skip_dry_run') ?? false;

  const row = await db(c).oneFresh<Row>(
    `INSERT INTO skills (
       user_id, name, description, instructions, allowed_tools, trigger, budget,
       model_slot, enabled, dry_run_until
     ) VALUES ($1, $2, $3, $4, $5::text[], $6::jsonb, $7::jsonb, $8, TRUE, $9::timestamptz)
     RETURNING ${SKILL_COLUMNS}`,
    [
      userId,
      name,
      description ?? null,
      instructions,
      allowedTools,
      JSON.stringify(trigger),
      JSON.stringify(budget),
      modelSlot,
      // New skills run shadowed for a week; the model records outward actions
      // instead of performing them.
      skipDryRun ? null : new Date(Date.now() + 7 * 86_400_000).toISOString(),
    ],
  );
  return ok(asRecord(row), 201);
}));

routes.put('/skills/:id', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const body = await readJson(c);

  const params: unknown[] = [id, userId];
  const sets: string[] = [];

  const name = optString(body, 'name', 120);
  if (name !== undefined) {
    params.push(name);
    sets.push(`name = $${params.length}`);
  }
  const description = nullableString(body, 'description', 2_000);
  if (description !== undefined) {
    params.push(description);
    sets.push(`description = $${params.length}`);
  }
  const instructions = optString(body, 'instructions', 100_000);
  if (instructions !== undefined) {
    params.push(instructions);
    sets.push(`instructions = $${params.length}`);
  }
  const allowedTools = optStringArray(body, 'allowed_tools');
  if (allowedTools !== undefined) {
    params.push(allowedTools);
    sets.push(`allowed_tools = $${params.length}::text[]`);
  }
  for (const column of ['trigger', 'budget'] as const) {
    const patch = optJson(body, column);
    if (patch) {
      params.push(JSON.stringify(patch));
      sets.push(`${column} = COALESCE(${column}, '{}'::jsonb) || $${params.length}::jsonb`);
    }
  }
  const modelSlot = optString(body, 'model_slot', 32);
  if (modelSlot !== undefined) {
    params.push(modelSlot);
    sets.push(`model_slot = $${params.length}`);
  }
  const enabled = optBool(body, 'enabled');
  if (enabled !== undefined) {
    params.push(enabled);
    sets.push(`enabled = $${params.length}`);
  }

  if (sets.length === 0) {
    throw new HttpError(ERROR.INVALID_ARGS, 'No skill fields supplied.', 400);
  }

  const row = await db(c).oneFresh<Row>(
    `UPDATE skills SET ${sets.join(', ')}, version = version + 1, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING ${SKILL_COLUMNS}`,
    params,
  );
  if (!row) throw notFound('Skill');
  return ok(row);
}));

routes.delete('/skills/:id', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const row = await db(c).oneFresh<Row>(
    `DELETE FROM skills WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId],
  );
  if (!row) throw notFound('Skill');
  return ok({ id, deleted: true });
}));

routes.post('/skills/:id/enable', handler(async (c) => {
  return setSkillEnabled(c, true);
}));

routes.post('/skills/:id/disable', handler(async (c) => {
  return setSkillEnabled(c, false);
}));

async function setSkillEnabled(c: Context<Vars>, enabled: boolean): Promise<Response> {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const row = await db(c).oneFresh<Row>(
    `UPDATE skills SET enabled = $3, updated_at = NOW()
     WHERE id = $1 AND user_id = $2
     RETURNING ${SKILL_COLUMNS}`,
    [id, userId, enabled],
  );
  if (!row) throw notFound('Skill');
  return ok(row);
}

routes.post('/skills/:id/run', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const skill = await db(c).oneFresh<Row>(
    `SELECT id, name FROM skills WHERE id = $1 AND user_id = $2`,
    [id, userId],
  );
  if (!skill) throw notFound('Skill');

  // The agent loop is Phase 3; there is no executor to hand the skill to yet.
  throw new HttpError(
    ERROR.NEEDS_CONNECTION,
    'The agent runtime is not available in this build.',
    503,
  );
}));

// ── Memories ───────────────────────────────────────────────────────────────

const MEMORY_ORDER = 'ORDER BY pinned DESC, importance DESC, created_at DESC';

routes.get('/memories', handler(async (c) => {
  const userId = getUserId(c);
  const params: unknown[] = [userId];
  const where: string[] = ['user_id = $1'];

  const q = c.req.query('q');
  if (q) {
    params.push(`%${q}%`);
    where.push(`content ILIKE $${params.length}`);
  }
  const kind = c.req.query('kind');
  if (kind) {
    params.push(kind);
    where.push(`kind = $${params.length}`);
  }
  const pinned = c.req.query('pinned');
  if (pinned === 'true' || pinned === 'false') {
    params.push(pinned === 'true');
    where.push(`pinned = $${params.length}`);
  }

  params.push(limitParam(c, 50, 500));
  const rows = await db(c).queryFresh(
    `SELECT ${MEMORY_COLUMNS} FROM memories WHERE ${where.join(' AND ')}
     ${MEMORY_ORDER} LIMIT $${params.length}`,
    params,
  );
  return ok(rows);
}));

const MEMORY_KINDS = ['fact', 'preference', 'commitment', 'person'] as const;

routes.post('/memories', handler(async (c) => {
  const userId = getUserId(c);
  const body = await readJson(c);
  const kind = oneOf(body, 'kind', MEMORY_KINDS);
  if (!kind) throw new HttpError(ERROR.INVALID_ARGS, 'kind is required.', 400);
  const content = requireString(body, 'content', 20_000);
  const importance = optInt(body, 'importance', 1, 10) ?? 5;
  const pinned = optBool(body, 'pinned') ?? false;
  const sourceRef = nullableString(body, 'source_ref', 512);

  const row = await db(c).oneFresh<Row>(
    `INSERT INTO memories (user_id, kind, content, importance, pinned, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING ${MEMORY_COLUMNS}`,
    [userId, kind, content, importance, pinned, sourceRef],
  );
  return ok(asRecord(row), 201);
}));

routes.patch('/memories/:id', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const body = await readJson(c);

  const params: unknown[] = [id, userId];
  const sets: string[] = [];

  const kind = oneOf(body, 'kind', MEMORY_KINDS);
  if (kind !== undefined) {
    params.push(kind);
    sets.push(`kind = $${params.length}`);
  }
  const content = optString(body, 'content', 20_000);
  if (content !== undefined) {
    params.push(content);
    sets.push(`content = $${params.length}`);
  }
  const importance = optInt(body, 'importance', 1, 10);
  if (importance !== undefined) {
    params.push(importance);
    sets.push(`importance = $${params.length}`);
  }
  const pinned = optBool(body, 'pinned');
  if (pinned !== undefined) {
    params.push(pinned);
    sets.push(`pinned = $${params.length}`);
  }
  const sourceRef = nullableString(body, 'source_ref', 512);
  if (sourceRef !== undefined) {
    params.push(sourceRef);
    sets.push(`source_ref = $${params.length}`);
  }

  if (sets.length === 0) {
    throw new HttpError(ERROR.INVALID_ARGS, 'No memory fields supplied.', 400);
  }

  const row = await db(c).oneFresh<Row>(
    `UPDATE memories SET ${sets.join(', ')} WHERE id = $1 AND user_id = $2 RETURNING ${MEMORY_COLUMNS}`,
    params,
  );
  if (!row) throw notFound('Memory');
  return ok(row);
}));

routes.delete('/memories/:id', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');
  const row = await db(c).oneFresh<Row>(
    `DELETE FROM memories WHERE id = $1 AND user_id = $2 RETURNING id`,
    [id, userId],
  );
  if (!row) throw notFound('Memory');
  return ok({ id, deleted: true });
}));

// ── Google connection state ────────────────────────────────────────────────

/**
 * Which Google-backed surface is this, and is it available?
 *
 * The email and calendar endpoints below are specified by docs/API.md but
 * depend on a Google connection. Rather than 404 (which reads as a typo) or
 * return an empty 200 (which reads as "you have no mail" — a lie the user
 * cannot act on), they report precisely what is missing. Same rule as the
 * tools in tools/gated.ts:
 *
 *   not connected      → 503 NEEDS_CONNECTION   ("connect your account")
 *   connected, no impl → 501 NOT_IMPLEMENTED    ("not built yet")
 */
type GoogleState = { connected: boolean; needs_reauth: boolean };

async function googleState(c: Context<Vars>): Promise<GoogleState> {
  const row = await db(c).oneFresh<{ needs_reauth: boolean }>(
    `SELECT needs_reauth FROM oauth_tokens
      WHERE user_id = $1 AND provider = 'google' LIMIT 1`,
    [getUserId(c)],
  );
  if (!row) return { connected: false, needs_reauth: false };
  return { connected: true, needs_reauth: row.needs_reauth === true };
}

async function assertGoogle(c: Context<Vars>, action: string): Promise<void> {
  const state = await googleState(c);
  if (!state.connected) {
    throw new HttpError(
      ERROR.NEEDS_CONNECTION,
      `Google is not connected, so this cannot ${action}. Connect Google to enable it.`,
      503,
    );
  }
  if (state.needs_reauth) {
    throw new HttpError(
      ERROR.NEEDS_REAUTH,
      'The Google connection needs re-authorising before this can run.',
      503,
    );
  }
}

/** Connected, but the Google call itself lands with OAuth in the final phase. */
function notImplemented(action: string): HttpError {
  return new HttpError(
    ERROR.NOT_IMPLEMENTED,
    `${action} is not implemented yet — Google-backed calls land with the connection, which is the last item of the final phase.`,
    501,
  );
}

// ── Email ──────────────────────────────────────────────────────────────────

/** Bodies are capped here too; a JSON response is not a file transfer. */
const EMAIL_BODY_CAP = 20_000;

/** `ILIKE` metacharacters in a query are wildcards until escaped. */
function escapeLike(input: string): string {
  return input.replace(/[\\%_]/g, (match) => `\\${match}`);
}

function shapeEmail(row: Row): Json {
  const to = row['to_addresses'];
  return {
    id: row['id'],
    thread_id: row['thread_id'],
    subject: row['subject'],
    from: row['from_address'],
    to: Array.isArray(to) ? to : [],
    snippet: row['snippet'],
    labels: row['label_ids'] ?? [],
    has_attachments: row['has_attachments'] === true,
    received_at: row['received_at'],
    unread: row['read_at'] === null,
    ai_summary: row['ai_summary'],
    ai_priority: row['ai_priority'],
  };
}

/**
 * Sync health — the one email endpoint that always answers, connected or not.
 * Its whole job is to let the UI say "connect Google" instead of showing an
 * inbox that looks empty for the wrong reason.
 */
routes.get('/emails/sync/status', handler(async (c) => {
  const state = await googleState(c);
  const row = await db(c).oneFresh<Row>(
    `SELECT last_sync_at, last_history_id, last_error, updated_at
       FROM sync_state WHERE user_id = $1`,
    [getUserId(c)],
  );
  return ok({
    connected: state.connected,
    needs_reauth: state.needs_reauth,
    last_sync_at: row?.['last_sync_at'] ?? null,
    last_history_id: row?.['last_history_id'] ?? null,
    last_error: row?.['last_error'] ?? null,
  });
}));

routes.post('/emails/sync', handler(async (c) => {
  await assertGoogle(c, 'sync the mailbox');
  // The live cursor lives in the Durable Object, not Postgres (invariant 1),
  // so a manual sync is a message to the DO rather than a query here.
  throw notImplemented('Triggering a mailbox sync');
}));

/** Metadata + snippet only. Bodies are fetched one at a time via `/emails/:id`. */
routes.get('/emails', handler(async (c) => {
  await assertGoogle(c, 'read mail');
  const params: unknown[] = [getUserId(c)];
  const where: string[] = ['user_id = $1'];

  const q = c.req.query('q');
  if (q) {
    params.push(`%${escapeLike(q)}%`);
    const n = params.length;
    where.push(
      `(subject ILIKE $${n} ESCAPE '\\' OR from_address ILIKE $${n} ESCAPE '\\' ` +
        `OR snippet ILIKE $${n} ESCAPE '\\')`,
    );
  }
  const threadId = c.req.query('thread_id');
  if (threadId) {
    params.push(threadId);
    where.push(`thread_id = $${params.length}`);
  }
  const label = c.req.query('label');
  if (label) {
    params.push(label);
    where.push(`$${params.length} = ANY(label_ids)`);
  }
  if (c.req.query('unread') === 'true') where.push('read_at IS NULL');

  // Keyset pagination on received_at: stable while mail keeps arriving, unlike
  // OFFSET, which silently skips rows when new mail lands mid-page.
  const cursor = c.req.query('cursor');
  if (cursor) {
    params.push(cursor);
    where.push(`received_at < $${params.length}::timestamptz`);
  }

  const limit = limitParam(c, 30, 100);
  params.push(limit);
  const rows = await db(c).queryFresh<Row>(
    `SELECT ${EMAIL_METADATA_COLUMNS} FROM email_messages
      WHERE ${where.join(' AND ')}
      ORDER BY received_at DESC
      LIMIT $${params.length}`,
    params,
  );

  const messages = rows.map(shapeEmail);
  // A full page probably has more behind it; a short one is the end.
  const last = messages[messages.length - 1];
  return ok({
    messages,
    next_cursor: messages.length === limit && last ? last['received_at'] : null,
  });
}));

routes.get('/emails/:id', handler(async (c) => {
  // Argument validity first: a malformed id is a client bug and must be
  // reported as INVALID_ARGS whether or not Google is connected.
  const id = uuidParam(c, 'id');
  await assertGoogle(c, 'read a message');
  const row = await db(c).oneFresh<Row>(
    `SELECT ${EMAIL_METADATA_COLUMNS}, body_key FROM email_messages
      WHERE id = $1 AND user_id = $2`,
    [id, getUserId(c)],
  );
  if (!row) throw notFound('Message');

  const key = row['body_key'];
  let bodyText: string | null = null;
  let truncated = false;
  if (typeof key === 'string' && key !== '') {
    const text = await bodies(c).getText(key);
    if (text !== null) {
      truncated = text.length > EMAIL_BODY_CAP;
      bodyText = truncated ? text.slice(0, EMAIL_BODY_CAP) : text;
    }
  }

  return ok({ ...shapeEmail(row), body_text: bodyText, body_truncated: truncated });
}));

routes.get('/emails/:id/thread', handler(async (c) => {
  const id = uuidParam(c, 'id');
  await assertGoogle(c, 'read a conversation');
  const anchor = await db(c).oneFresh<Row>(
    `SELECT thread_id FROM email_messages WHERE id = $1 AND user_id = $2`,
    [id, getUserId(c)],
  );
  if (!anchor) throw notFound('Message');
  const threadId = anchor['thread_id'];
  if (typeof threadId !== 'string' || threadId === '') {
    throw new HttpError(ERROR.NOT_FOUND, 'That message has no thread.', 404);
  }
  const rows = await db(c).queryFresh<Row>(
    `SELECT ${EMAIL_METADATA_COLUMNS} FROM email_messages
      WHERE user_id = $1 AND thread_id = $2
      ORDER BY received_at ASC LIMIT 100`,
    [getUserId(c), threadId],
  );
  return ok({ thread_id: threadId, messages: rows.map(shapeEmail) });
}));

// Mutations are Gmail's to own. Writing the local projection instead would
// diverge from the mailbox, which is worse than refusing (tools/email.ts).
routes.post('/emails/:id/read', handler(async (c) => {
  const id = uuidParam(c, 'id');
  await assertGoogle(c, 'mark a message read');
  throw notImplemented('Marking a message read');
}));

routes.post('/emails/:id/archive', handler(async (c) => {
  const id = uuidParam(c, 'id');
  await assertGoogle(c, 'archive a message');
  throw notImplemented('Archiving a message');
}));

routes.post('/emails/:id/label', handler(async (c) => {
  const id = uuidParam(c, 'id');
  await assertGoogle(c, 'label a message');
  throw notImplemented('Labelling a message');
}));

// ── Calendar ───────────────────────────────────────────────────────────────

/**
 * Nothing syncs the calendar locally (there is no calendar table on purpose),
 * so every calendar endpoint is a live Google call — gated the same way.
 */
function requireRange(c: Context<Vars>): void {
  const from = c.req.query('from');
  const to = c.req.query('to');
  if (!from || !to) {
    throw new HttpError(ERROR.INVALID_ARGS, 'from and to are required (ISO 8601).', 400);
  }
}

routes.get('/calendar/events', handler(async (c) => {
  requireRange(c);
  await assertGoogle(c, 'read the calendar');
  throw notImplemented('Listing calendar events');
}));

routes.get('/calendar/freebusy', handler(async (c) => {
  requireRange(c);
  await assertGoogle(c, 'read availability');
  throw notImplemented('Querying availability');
}));

routes.get('/calendar/agent-created', handler(async (c) => {
  await assertGoogle(c, 'list agent-created events');
  throw notImplemented('Listing agent-created events');
}));

// ── Artifacts ──────────────────────────────────────────────────────────────

routes.get('/artifacts/:id', handler(async (c) => {
  const userId = getUserId(c);
  const id = uuidParam(c, 'id');

  // artifacts has no user_id of its own, so ownership is proven through the
  // producing run.
  const row = await db(c).oneFresh<Row>(
    `SELECT a.id, a.kind, a.run_id, a.html, a.state, a.bindings, a.created_at
     FROM artifacts a
     JOIN agent_runs r ON r.id = a.run_id
     WHERE a.id = $1 AND r.user_id = $2`,
    [id, userId],
  );
  if (!row) throw notFound('Artifact');
  return ok(row);
}));

export { routes };
export default routes;
