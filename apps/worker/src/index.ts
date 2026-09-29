/**
 * ThreadMyMail Worker — entrypoint.
 *
 * Three faces of one Worker, each with a very different CPU budget:
 *   - HTTP   : thin. The Free plan allows 10 ms per invocation, so handlers
 *              authenticate, delegate, and return.
 *   - WS/agent : the Durable Object does the work. The spike (docs/ARCHITECTURE.md
 *              §11) confirmed DOs have ample CPU on Free.
 *   - Cron   : thin, and must NEVER query Postgres (docs/ARCHITECTURE.md §5).
 */

import { AgentObject } from './agent/durable.js';
import { ToolRegistry } from './tools/registry.js';
import { todoTools } from './tools/todo.js';
import { memoryTools } from './tools/memory.js';
import { emailTools } from './tools/email.js';
import { calendarTools } from './tools/calendar.js';
import { createMetaTools } from './tools/meta.js';
import { Db } from './db/client.js';
import { BodyStore, bodyKey } from './storage/bodystore.js';
import { ModelClient } from './agent/model.js';
import { routes } from './http/routes.js';
import { withCors } from './http/cors.js';

export { AgentObject };

export interface Env {
  ENVIRONMENT: string;
  DB: { connectionString: string };
  DB_FRESH: { connectionString: string };
  BODIES: D1Database;
  AGENT: DurableObjectNamespace<AgentObject>;
  /**
   * Encrypts per-user BYOK model credentials. Required for credential writes.
   * There is intentionally no worker-level model key: one shared key would
   * make every user share it and hide their spend. See agent.md §9.
   */
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  GOOGLE_REDIRECT_URI?: string;
  SESSION_SECRET?: string;
  ENCRYPTION_KEY?: string;
  /**
   * Comma-separated list of browser origins allowed to call this API.
   * Unset or empty means NO origin is allowed — the API sends no CORS headers
   * at all, which is the same thing it did before CORS existed. See
   * http/cors.ts for why a wildcard is never acceptable here.
   */
  CORS_ORIGINS?: string;
}

/** Tools available outside a run. Meta tools are added per-run. */
function baseRegistry(): ToolRegistry {
  return new ToolRegistry()
    .registerAll(todoTools as never)
    .registerAll(memoryTools as never)
    // email.search/get/get_thread read the local projection; the rest of
    // email.* and all of calendar.* declare their contract and fail with
    // NEEDS_CONNECTION until the Google connection exists (tools/gated.ts).
    .registerAll(emailTools as never)
    .registerAll(calendarTools as never);
}

export default {
  /**
   * Cross-origin wrapper. Kept separate from `dispatch` so every path is
   * covered, including `/health` and the WebSocket upgrade, which the Hono
   * sub-app never sees.
   */
  async fetch(request: Request, env: Env): Promise<Response> {
    return withCors(request, env, (req) => this.dispatch(req, env));
  },

  async dispatch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\/v1/, '') || '/';

    // ── Health ────────────────────────────────────────────────────────────
    if (path === '/health') {
      return Response.json({
        status: 'ok',
        environment: env.ENVIRONMENT,
        version: '0.2.0',
        // Operator-level readiness only. Per-user BYOK keys are never reported
        // here and are never readable from this endpoint — see
        // GET /settings/providers, which returns booleans and fingerprints.
        credentials_encrypted: Boolean(env.ENCRYPTION_KEY),
      });
    }

    // ── Agent WebSocket ───────────────────────────────────────────────────
    if (path === '/agent/stream') {
      if (request.headers.get('Upgrade') !== 'websocket') {
        return new Response('expected websocket upgrade', { status: 426 });
      }
      const id = env.AGENT.idFromName('main');
      return env.AGENT.get(id).fetch(request);
    }

    // ── Kill switch ───────────────────────────────────────────────────────
    // Intercepted here rather than delegated to `routes`, because the switch has
    // to live in TWO places and they must never disagree:
    //   1. the Durable Object, which is the only thing that can abort a run
    //      that is already in flight, and
    //   2. users.prefs, so the API and UI agree on the persisted state.
    // An earlier version wrote only to Postgres, so engaging the switch left the
    // agent happily running. A safety control that can disagree with itself is
    // not a safety control.
    if (path === '/kill-switch') {
      const id = env.AGENT.idFromName('main');
      const doRes = await env.AGENT.get(id).fetch(
        new Request('https://do/kill-switch', {
          method: request.method,
          ...(request.method === 'PUT' || request.method === 'POST'
            ? { body: JSON.stringify(await readEngaged(request)) }
            : {}),
        }),
      );
      const live = (await doRes.json()) as { engaged: boolean };

      if (request.method === 'GET') {
        const persisted = await routes.fetch(
          new Request(new URL('/kill-switch', url.origin), request),
          env,
        );
        const body = (await persisted.json()) as { data?: { global?: boolean } };
        return Response.json({
          success: true,
          data: { ...(body.data ?? {}), global: live.engaged || Boolean(body.data?.global) },
          error: null,
        });
      }

      return Response.json({
        success: true,
        data: { global: live.engaged, skills: {} },
        error: null,
      });
    }

    // ── Kill switch (DO live state) ───────────────────────────────────────
    if (path === '/kill-switch/live') {
      const id = env.AGENT.idFromName('main');
      return env.AGENT.get(id).fetch(
        new Request('https://do/kill-switch', {
          method: request.method,
          ...(request.method === 'POST' ? { body: await request.text() } : {}),
        }),
      );
    }

    // ── Sync cursor (DO-owned; keeps the tick off Postgres) ───────────────
    if (path === '/emails/sync/cursor') {
      const id = env.AGENT.idFromName('main');
      return env.AGENT.get(id).fetch(
        new Request('https://do/sync-cursor', {
          method: request.method,
          ...(request.method === 'POST' ? { body: await request.text() } : {}),
        }),
      );
    }

    // ── Storage diagnostics ───────────────────────────────────────────────
    if (path === '/storage/usage') {
      const usage = await new BodyStore(env.BODIES).usage();
      return Response.json({ backend: 'd1', ...usage });
    }

    if (path === '/storage/roundtrip') {
      return Response.json(await storageRoundTrip(new BodyStore(env.BODIES)));
    }

    // ── Tool catalogue ───────────────────────────────────────────────────
    if (path === '/tools') {
      // Meta tools need a context to bind against; for the catalogue we only
      // need their names, descriptions and schemas, so a null delegate is fine.
      const registry = baseRegistry().registerAll(
        createMetaTools({ depth: 0, maxDepth: 2, delegate: async () => null }) as never,
      );
      return Response.json({
        success: true,
        data: registry.all().map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
          permissions: t.permissions,
          reversible: t.reversible,
          source: t.source,
        })),
        error: null,
      });
    }

    // ── API ───────────────────────────────────────────────────────────────
    // `routes` is a Hono app; give it the full origin and let it route by path.
    return routes.fetch(new Request(new URL(path + url.search, url.origin), request), env);
  },

  /**
   * Cron. Two triggers: a 5-minute heartbeat and a 15-minute one.
   *
   * The heartbeat MUST stay within the ~10 ms cron CPU budget AND MUST NOT query
   * Postgres. Reading the Gmail cursor from the Durable Object is what keeps Neon
   * suspended. Getting this wrong is the single most expensive mistake available
   * in this codebase: a compute that never sleeps exhausts its 100 CU-hour
   * allowance and the agent goes dark.
   */
  async scheduled(controller: ScheduledController, env: Env): Promise<void> {
    const started = Date.now();
    const which = controller.cron;
    try {
      const id = env.AGENT.idFromName('main');

      if (which === '*/5 * * * *') {
        // THE TICK. Everything it needs lives in the Durable Object: the kill
        // switch, the mail cursor and the parked schedule. An idle tick reads
        // only that object's storage and issues no query at all, which is what
        // keeps Neon suspended (ARCHITECTURE §5, agent.md invariant 1). The
        // Worker itself does no work here by design — putting the due-check in
        // the Worker would mean a Postgres round trip on every tick.
        const res = await env.AGENT.get(id).fetch(
          new Request('https://do/heartbeat', { method: 'POST' }),
        );
        const report = (await res.json()) as Record<string, unknown>;
        console.log(JSON.stringify({ kind: 'heartbeat', cron: which, ...report }));
        return;
      }

      // 15-minute tick: maintenance that may touch Postgres, but stays cheap.
      const usage = await new BodyStore(env.BODIES).usage();
      console.log(
        JSON.stringify({
          kind: 'maintenance',
          cron: which,
          bodies: usage.objects,
          bytes: usage.bytes,
          ms: Date.now() - started,
        }),
      );
    } catch (error) {
      console.error(
        JSON.stringify({
          kind: 'cron_error',
          cron: which,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
    }
  },
};

/** The kill switch lives on the DO so it can abort in-flight runs. */
/** Accept either `{ engaged }` (DO shape) or `{ global }` (API shape). */
async function readEngaged(request: Request): Promise<{ engaged: boolean }> {
  try {
    const body = (await request.clone().json()) as { engaged?: boolean; global?: boolean };
    return { engaged: Boolean(body.engaged ?? body.global) };
  } catch {
    return { engaged: false };
  }
}


/**
 * End-to-end check of the body store: write an object larger than D1's 2 MB
 * single-value cap, read it back, confirm byte-for-byte reassembly.
 */
async function storageRoundTrip(store: BodyStore) {
  const key = `${bodyKey.artifact('selftest')}/${Date.now()}`;
  const size = 2_500_000;
  const payload = new Uint8Array(size);
  for (let i = 0; i < size; i++) payload[i] = i % 251;

  const meta = await store.put(key, payload, 'application/octet-stream', 1);
  const read = await store.get(key);

  let identical = false;
  if (read && read.content.byteLength === size) {
    identical = true;
    for (let i = 0; i < size; i++) {
      if (read.content[i] !== payload[i]) {
        identical = false;
        break;
      }
    }
  }

  await store.delete(key);
  return {
    wrote_bytes: size,
    chunks: meta.chunks,
    read_bytes: read?.content.byteLength ?? 0,
    byte_identical: identical,
    cleaned_up: true,
  };
}
