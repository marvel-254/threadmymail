#!/usr/bin/env node
/**
 * Temporary oauth_tokens fixture for verifying Google-gated behaviour locally.
 *
 * Google OAuth is the LAST item of the final phase (docs/PLAN.md §9), so in
 * normal development there is no row in oauth_tokens and every gated surface
 * answers 503 NEEDS_CONNECTION. The two remaining branches — 200 "connected"
 * and 503 NEEDS_REAUTH — need a row to exist. This script creates one, flips
 * it, and removes it again, without ever holding a real token:
 *
 *   node scripts/seed-oauth-fixture.mjs seed     insert a tokenless google row
 *   node scripts/seed-oauth-fixture.mjs reauth   set needs_reauth = TRUE
 *   node scripts/seed-oauth-fixture.mjs fresh    set needs_reauth = FALSE
 *   node scripts/seed-oauth-fixture.mjs status   show the current row, if any
 *   node scripts/seed-oauth-fixture.mjs remove   delete the fixture row
 *
 * Guard rails: the row is created with access_token_encrypted NULL, and both
 * `seed` and `remove` refuse to touch any google row that HAS an encrypted
 * token, so a real connection (final phase) can never be clobbered by a
 * fixture run.
 *
 * Goes to Neon over its HTTP interface (no psql on this machine, and Node's
 * fetch/undici fails IPv6-only networks — see db-push.mjs for the same
 * reasoning). Reads DATABASE_URL from .dev.vars. Never prints the password.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpsRequest } from 'node:https';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = resolve(HERE, '..');

/** Keep in sync with DEV_USER_ID in src/http/routes.ts. */
const DEV_USER_ID = '00000000-0000-4000-8000-000000000001';

function loadConnectionString() {
  const raw = readFileSync(resolve(WORKER_DIR, '.dev.vars'), 'utf8');
  const line = raw.split('\n').find((l) => l.trim().startsWith('DATABASE_URL'));
  if (!line) throw new Error('No DATABASE_URL in .dev.vars');
  const value = line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  return value;
}

/**
 * Neon over node:https with `family: 4` — same workaround as db-push.mjs.
 * The link is intermittent here, so retry with backoff before giving up.
 */
function postSql(connectionString, query, attempt = 0) {
  return new Promise((resolvePromise, rejectPromise) => {
    const host = new URL(connectionString).hostname;
    const payload = JSON.stringify({ query });
    const req = httpsRequest(
      {
        host,
        family: 4,
        method: 'POST',
        path: '/sql',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          'Neon-Connection-String': connectionString,
        },
        timeout: 30_000,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(data);
          } catch {
            parsed = { message: `non-JSON response: ${data.slice(0, 200)}` };
          }
          resolvePromise({ status: res.statusCode, body: parsed });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('request timed out')));
    req.on('error', (error) => {
      if (attempt < 4) {
        setTimeout(
          () => postSql(connectionString, query, attempt + 1).then(resolvePromise, rejectPromise),
          1000 * 2 ** attempt,
        );
      } else {
        rejectPromise(error);
      }
    });
    req.write(payload);
    req.end();
  });
}

/** Neon /sql returns rows somewhere under `results[0]`; be tolerant. */
function rowsOf(body) {
  return body?.results?.[0]?.rows ?? body?.rows ?? [];
}

async function run(command) {
  const conn = loadConnectionString();
  const host = new URL(conn).hostname;
  console.log(`Target: ${host}  user: ${DEV_USER_ID}`);

  const GUARD = 'access_token_encrypted IS NULL';
  const WHERE = `user_id = '${DEV_USER_ID}' AND provider = 'google'`;

  const statements = {
    seed: [
      `DELETE FROM oauth_tokens WHERE ${WHERE} AND ${GUARD}`,
      `INSERT INTO oauth_tokens (user_id, provider, scopes, needs_reauth)
       VALUES ('${DEV_USER_ID}', 'google', ARRAY[]::text[], FALSE)`,
    ],
    reauth: [`UPDATE oauth_tokens SET needs_reauth = TRUE WHERE ${WHERE} AND ${GUARD}`],
    fresh: [`UPDATE oauth_tokens SET needs_reauth = FALSE WHERE ${WHERE} AND ${GUARD}`],
    remove: [`DELETE FROM oauth_tokens WHERE ${WHERE} AND ${GUARD}`],
    status: [
      `SELECT needs_reauth, ${GUARD.replace('IS NULL', 'IS NULL')} AS is_fixture, created_at
       FROM oauth_tokens WHERE ${WHERE}`,
    ],
  }[command];

  if (!statements) {
    console.error(`Unknown command: ${command}`);
    process.exit(2);
  }

  for (const sql of statements) {
    const result = await postSql(conn, sql);
    if (result.status !== 200 || result.body.message) {
      console.error(`FAILED: ${result.body.message || `HTTP ${result.status}`}`);
      process.exit(1);
    }
    if (command === 'status') {
      const rows = rowsOf(result.body);
      if (rows.length === 0) {
        console.log('No google row — gated surfaces will answer NEEDS_CONNECTION.');
      } else {
        console.log(JSON.stringify(rows[0], null, 2));
      }
    }
  }
  console.log(`Done: ${command}.`);
}

run(process.argv[2]);
