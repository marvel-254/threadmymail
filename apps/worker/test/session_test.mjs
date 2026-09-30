// Session cookies and the production identity gate.
//
// The bug this file exists to prevent: ThreadMyMail was deployed with a public
// URL and every request attributed to one hardcoded user. Anything that let an
// unauthenticated caller be that user — or that let a caller choose their own
// user id — reopened that hole. Both are tested here.
import assert from 'node:assert';

const SECRET = 'a-session-secret-of-adequate-length';
const OTHER_SECRET = 'an-entirely-different-secret-value';
const UID = '00000000-0000-4000-8000-000000000001';
const NOW = 1_700_000_000;

let p = 0, f = 0;
const t = async (name, fn) => {
  try { await fn(); p++; console.log('  ok   ' + name); }
  catch (e) { f++; console.log('  FAIL ' + name + '\n        ' + e.message); }
};

const src = await import('../src/http/session.ts');
const { signSession, verifySession, parseCookies, timingSafeEqual, buildSessionCookie,
        SESSION_COOKIE, SESSION_TTL_SECONDS } = src;

const payload = (over = {}) => ({ uid: UID, iat: NOW, exp: NOW + 3600, ...over });

// ── Round trip ──────────────────────────────────────────────────────────────

await t('a freshly signed session verifies', async () => {
  const token = await signSession(payload(), SECRET);
  const got = await verifySession(token, SECRET, NOW + 10);
  assert.equal(got.uid, UID);
  assert.equal(got.exp, NOW + 3600);
});

await t('the cookie contains the token, HttpOnly, Secure, SameSite=Lax', async () => {
  const { cookie, token } = await buildSessionCookie(UID, SECRET, true, NOW);
  assert.ok(cookie.includes(`${SESSION_COOKIE}=`), 'cookie is named correctly');
  assert.ok(cookie.includes(token), 'cookie carries the signed token');
  assert.ok(/HttpOnly/.test(cookie), 'HttpOnly — not readable from JS');
  assert.ok(/Secure/.test(cookie), 'Secure over TLS');
  assert.ok(/SameSite=Lax/.test(cookie), 'Lax, so the OAuth callback still sends it');
  assert.ok(cookie.includes(`Max-Age=${SESSION_TTL_SECONDS}`));
});

await t('the cookie drops Secure over plain http (local dev)', async () => {
  const { cookie } = await buildSessionCookie(UID, SECRET, false, NOW);
  assert.ok(!/;\s*Secure/.test(cookie), 'no Secure flag on http');
  assert.ok(/HttpOnly/.test(cookie));
});

// ── Rejection: every failure mode returns null, never throws ────────────────

await t('a tampered payload is rejected', async () => {
  const token = await signSession(payload(), SECRET);
  const [body, mac] = token.split('.');
  const forged = Buffer.from(JSON.stringify(payload({ uid: '11111111-1111-4111-8111-111111111111' })))
    .toString('base64url');
  assert.equal(await verifySession(`${forged}.${mac}`, SECRET, NOW), null);
  assert.ok(body !== forged);
});

await t('a tampered signature is rejected', async () => {
  const token = await signSession(payload(), SECRET);
  const [body, mac] = token.split('.');
  const flipped = mac.slice(0, -1) + (mac.slice(-1) === 'A' ? 'B' : 'A');
  assert.equal(await verifySession(`${body}.${flipped}`, SECRET, NOW), null);
});

await t('a token signed with another secret is rejected', async () => {
  const token = await signSession(payload(), OTHER_SECRET);
  assert.equal(await verifySession(token, SECRET, NOW), null);
});

await t('an expired token is rejected', async () => {
  const token = await signSession(payload({ exp: NOW + 10 }), SECRET);
  assert.equal(await verifySession(token, SECRET, NOW + 11), null);
});

await t('a token expiring exactly now is rejected', async () => {
  const token = await signSession(payload({ exp: NOW }), SECRET);
  assert.equal(await verifySession(token, SECRET, NOW), null);
});

await t('a token one second before expiry still works', async () => {
  const token = await signSession(payload({ exp: NOW + 10 }), SECRET);
  assert.ok(await verifySession(token, SECRET, NOW + 9));
});

await t('malformed tokens return null rather than throwing', async () => {
  for (const bad of ['', '.', 'a.', '.b', 'a.b.c', 'nodot', '!!!.???', 'x'.repeat(500)]) {
    assert.equal(await verifySession(bad, SECRET, NOW), null, `input: ${JSON.stringify(bad.slice(0, 20))}`);
  }
  assert.equal(await verifySession(undefined, SECRET, NOW), null);
});

await t('a valid signature over a payload with no uid is rejected', async () => {
  const token = await signSession({ iat: NOW, exp: NOW + 10 }, SECRET);
  assert.equal(await verifySession(token, SECRET, NOW), null);
});

await t('a payload that is not JSON is rejected', async () => {
  const body = Buffer.from('not json at all').toString('base64url');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(SECRET),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = Buffer.from(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body)))
    .toString('base64url');
  assert.equal(await verifySession(`${body}.${mac}`, SECRET, NOW), null);
});

// ── Fail closed ─────────────────────────────────────────────────────────────

await t('a short SESSION_SECRET is refused, not used', async () => {
  await assert.rejects(() => signSession(payload(), 'tooshort'), /at least 16/);
  // And a token signed under a short secret must not verify either.
  assert.equal(await verifySession('a.b', 'tooshort', NOW), null);
});

await t('a missing SESSION_SECRET is refused', async () => {
  await assert.rejects(() => signSession(payload(), undefined), /SESSION_SECRET/);
  assert.equal(await verifySession('a.b', undefined, NOW), null);
});

await t('an absent cookie yields null, not a throw', async () => {
  const cookies = parseCookies(null);
  assert.equal(cookies[SESSION_COOKIE], undefined);
  assert.equal(await verifySession(cookies[SESSION_COOKIE], SECRET, NOW), null);
});

// ── Cookie parsing ──────────────────────────────────────────────────────────

await t('Cookie headers parse, including several at once', () => {
  const c = parseCookies('tmm_session=abc; tmm_oauth_state=xyz; other=1');
  assert.equal(c.tmm_session, 'abc');
  assert.equal(c.tmm_oauth_state, 'xyz');
  assert.equal(c.other, '1');
});

await t('a percent-encoded cookie value is decoded', () => {
  assert.equal(parseCookies('tmm_session=a%2Bb%3Dc').tmm_session, 'a+b=c');
});

await t('a malformed Cookie header degrades instead of throwing', () => {
  assert.deepEqual(parseCookies(''), {});
  assert.deepEqual(parseCookies(';;='), {});
  assert.equal(parseCookies('novalue').novalue, undefined);
});

// ── Constant-time comparison, used for the OAuth state check ────────────────

await t('timingSafeEqual accepts only exact matches', () => {
  assert.equal(timingSafeEqual('abc123', 'abc123'), true);
  assert.equal(timingSafeEqual('abc123', 'abc124'), false);
  assert.equal(timingSafeEqual('abc123', 'abc12'), false);
  assert.equal(timingSafeEqual('', ''), true);
});

console.log(`\n  ${p} passed, ${f} failed`);
process.exit(f ? 1 : 0);
