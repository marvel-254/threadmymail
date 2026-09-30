/**
 * The error type and JSON envelope, in their own module.
 *
 * These used to live in routes.ts. Extracting them is what lets http/auth.ts
 * throw the same shaped errors as everything else without a circular import —
 * routes.ts imports authRoutes, so auth.ts cannot import routes.ts back.
 *
 * The envelope is `{ success, data, error }` on every response, success or
 * failure, so a client never has to branch on the HTTP status to find out
 * whether the call worked.
 */

export class HttpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function ok<T>(data: T, status = 200): Response {
  return json(status, { success: true, data, error: null });
}

export function fail(error: unknown): Response {
  if (error instanceof HttpError) {
    return json(error.status, {
      success: false,
      data: null,
      error: { code: error.code, message: error.message, detail: null },
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  console.error('[http] unhandled', message);
  return json(500, {
    success: false,
    data: null,
    error: { code: 'INTERNAL', message: 'Unexpected error.', detail: null },
  });
}
