const WORKER_ORIGIN = 'https://threadmymail-worker.twistedoliver211fs.workers.dev';

/** Keep API traffic, OAuth, and its HttpOnly cookie on the app's own host. */
export async function onRequest({ request }) {
  const incoming = new URL(request.url);
  const target = new URL(`${incoming.pathname}${incoming.search}`, WORKER_ORIGIN);
  // OAuth start and callback responses are redirects meant for the browser.
  // The default Worker fetch mode follows them server-side, swallowing the
  // Google navigation and making the SPA fall back to its landing route.
  return fetch(new Request(target, request), { redirect: 'manual' });
}
