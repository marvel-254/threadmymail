// The production identity gate.
//
// ThreadMyMail was deployed at a public URL with no login: every request
// resolved to one hardcoded user, and the X-User-Id header was honoured from
// anywhere, so anyone who guessed that user's UUID — which is published in the
// source — owned the account. These tests pin the replacement behaviour.
//
//   node test/identity_test.mjs
import assert from 'node:assert';

import { resolveIdentity, DEV_USER_ID, BadUserHeader } from '../src/http/identity.ts';
import { signSession } from '../src/http/session.ts';

const SECRET = 'a-session-secret-of-adequate-length';
const UID_A = '00000000-0000-4000-8000-000000000001';
const UID_B = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const NOW = 1_700_000_000;

let p = 0, f = 0;
const t = async (name, fn) => {
  try { await fn(); p++; console.log('  ok   ' + name); }
  catch (e) { f++; console.log('  FAIL ' + name + '\n        ' + e.message); }
};

const tok = (uid) => signSession({ uid, iat: NOW, exp: NOW + 3600 }, SECRET);

/** The common case: production, with some cookie and header. */
const prod = async (cookies = {}, userHeader = undefined) =>
  resolveIdentity({
    cookies,
    cookie: Object.keys(cookies).length ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join('; ') : null,
    sessionSecret: SECRET,
    environment: 'production',
    userHeader,
    now: NOW,
  });

const dev = (userHeader = undefined) =>
  resolveIdentity({
    cookies: {},
    cookie: null,
    sessionSecret: SECRET,
    environment: 'development',
    userHeader,
    now: NOW,
  });

// ── Production: the whole point ─────────────────────────────────────────────

await t('production refuses an anonymous request', async () => {
  assert.equal(await prod(), null);
});

await t('production ignores X-User-Id, including the dev user id', async () => {
  // THE regression. This used to return the caller, which is the entire hole.
  assert.equal(await prod({}, DEV_USER_ID), null);
});

await t('production ignores an arbitrary valid UUID in the header', async () => {
  assert.equal(await prod({}, UID_B), null);
});

await t('production ignores a garbage header without erroring', async () => {
  // A malformed header is only an error where the header is honoured at all.
  assert.equal(await prod({}, 'not-a-uuid'), null);
});

await t('production ignores a forged session cookie', async () => {
  const forged = await signSession({ uid: UID_B, iat: NOW, exp: NOW + 3600 }, 'wrong-secret-entirely-here');
  assert.equal(await prod({ tmm_session: forged }), null);
});

await t('production accepts a valid session cookie', async () => {
  assert.equal(await prod({ tmm_session: await tok(UID_B) }), UID_B);
});

await t('production ignores an expired session cookie', async () => {
  const expired = await signSession({ uid: UID_B, iat: NOW - 7200, exp: NOW - 3600 }, SECRET);
  assert.equal(await prod({ tmm_session: expired }), null);
});

await t('a valid session cookie wins over a spoofed header in production', async () => {
  // The session decides. The header is not consulted at all.
  assert.equal(await prod({ tmm_session: await tok(UID_B) }, DEV_USER_ID), UID_B);
});

await t('production with no SESSION_SECRET set is anonymous, not permissive', async () => {
  // Must NOT fall through to the dev user just because the secret is missing.
  const result = await resolveIdentity({
    cookies: {},
    cookie: null,
    environment: 'production',
    now: NOW,
  });
  assert.equal(result, null);
});

// ── Development: unchanged convenience ──────────────────────────────────────

await t('development falls back to the dev user with no header', async () => {
  assert.equal(await dev(), DEV_USER_ID);
});

await t('development honours X-User-Id', async () => {
  assert.equal(await dev(UID_B), UID_B);
});

await t('development rejects a malformed X-User-Id with a specific error', async () => {
  await assert.rejects(() => dev('nope'), (e) => e instanceof BadUserHeader);
});

await t('development prefers a session cookie over the header', async () => {
  const result = await resolveIdentity({
    cookies: { tmm_session: await tok(UID_B) },
    cookie: `tmm_session=${await tok(UID_B)}`,
    sessionSecret: SECRET,
    environment: 'development',
    userHeader: UID_A,
    now: NOW,
  });
  assert.equal(result, UID_B);
});

await t('an unset environment behaves as development', async () => {
  const result = await resolveIdentity({
    cookies: {}, cookie: null, sessionSecret: SECRET, now: NOW,
  });
  assert.equal(result, DEV_USER_ID);
});

// ── The dev user id is a well-formed UUID ───────────────────────────────────

await t('DEV_USER_ID matches the UUID shape the header validator requires', () => {
  assert.match(DEV_USER_ID, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
});

console.log(`\n  ${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
