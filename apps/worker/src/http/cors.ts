/**
 * Cross-origin access.
 *
 * The frontend is a separate origin from the Worker: a Vite dev server while
 * developing, and a Cloudflare Pages site once it is published. Both call this
 * API cross-origin, so it needs CORS to be usable at all.
 *
 * Two things this deliberately does NOT do:
 *
 * 1. It never sends `Access-Control-Allow-Origin: *`. Every request is
 *    attributed to DEV_USER_ID with no login (see routes.ts), so a wildcard
 *    would let any page in any browser the user visits read and write that
 *    account — todos, skills, and the credential store. Origins are enumerated.
 *
 * 2. It never fails open. If CORS_ORIGINS is unset, no origin is allowed and
 *    the headers are simply absent, which is the same thing the browser saw
 *    before this existed. A misconfigured variable degrades to the previous
 *    behaviour instead of opening the API up.
 *
 * A disallowed origin gets NO Access-Control-* headers rather than a 403.
 * The request is still executed — it may be curl, a worker, or a native client
 * that does not care about CORS — and the browser is the thing that enforces
 * the policy, by refusing to hand the response to the calling page. Rejecting
 * outright would break those non-browser clients for no security gain.
 */

const DEFAULT_MAX_AGE = 600;

export type CorsEnv = { CORS_ORIGINS?: string };

/** The methods this API actually uses. */
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'DELETE', 'OPTIONS'] as const;

/**
 * Request headers worth naming. The list is explicit rather than echoing the
 * caller's `Access-Control-Request-Headers`, because echoing is equivalent to
 * a wildcard and would re-open the door this module exists to close.
 */
const HEADERS = [
  'Content-Type',
  'Authorization',
  'Accept',
  'X-Requested-With',
] as const;

/** Parse the configured allowlist, memoised per Worker isolate. */
let cached: { key: string | undefined; origins: Set<string> } | null = null;

function allowed(env: CorsEnv): Set<string> {
  if (cached && cached.key === env.CORS_ORIGINS) return cached.origins;
  const origins = new Set<string>();
  for (const raw of (env.CORS_ORIGINS ?? '').split(',')) {
    const origin = raw.trim();
    // Reject '*' outright rather than letting it through as a literal: a
    // wildcard here would be indistinguishable from open access.
    if (origin.length > 0 && origin !== '*') origins.add(origin);
  }
  cached = { key: env.CORS_ORIGINS, origins };
  return origins;
}

/** Headers to attach to a real response, or {} if this origin is not allowed. */
export function corsHeaders(request: Request, env: CorsEnv): Record<string, string> {
  const origin = request.headers.get('Origin');
  // No Origin header: not a browser cross-origin request. Nothing to allow.
  if (!origin) return {};
  if (!allowed(env).has(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    // Echoing the exact origin is what makes this legal alongside credentials.
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Expose-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

/** True when this is a CORS preflight we should answer and stop there. */
export function isPreflight(request: Request): boolean {
  return request.method === 'OPTIONS' && request.headers.get('Origin') !== null;
}

/** The preflight response, or null when the origin is not on the allowlist. */
export function preflightResponse(request: Request, env: CorsEnv): Response | null {
  const base = corsHeaders(request, env);
  // No headers means the origin is unknown. Returning 403 here (rather than an
  // unheadered 204) is the one case we do reject: a preflight is a browser
  // asking permission, and the honest answer is no.
  if (Object.keys(base).length === 0) return new Response(null, { status: 403 });
  return new Response(null, {
    status: 204,
    headers: {
      ...base,
      'Access-Control-Allow-Methods': METHODS.join(', '),
      'Access-Control-Allow-Headers': HEADERS.join(', '),
      'Access-Control-Max-Age': String(DEFAULT_MAX_AGE),
    },
  });
}

/**
 * Handle a preflight, or pass the request through with CORS headers attached.
 * Wraps the real dispatcher so `/health` and the WebSocket route are covered
 * too, not just the Hono sub-app.
 */
export async function withCors(
  request: Request,
  env: CorsEnv,
  handle: (request: Request) => Promise<Response>,
): Promise<Response> {
  if (isPreflight(request)) return preflightResponse(request, env) ?? new Response(null, { status: 403 });

  const response = await handle(request);
  const extra = corsHeaders(request, env);
  if (Object.keys(extra).length === 0) return response;

  // WebSocket upgrades carry no CORS semantics, and a 101 has no body to
  // protect; copying headers onto it is at best noise.
  if (response.status === 101) return response;

  // Copy into a new Response because a Response returned from a redirect or
  // an immutable body may reject header mutation. The WebSocket branch above
  // is the one case where `response` must be passed through untouched.
  const out = new Response(response.body, response);
  for (const [k, v] of Object.entries(extra)) out.headers.set(k, v);
  return out;
}
