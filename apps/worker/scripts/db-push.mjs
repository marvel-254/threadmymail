#!/usr/bin/env node
/**
 * Apply a SQL file to Neon over its HTTP interface.
 *
 * The pooled endpoint rejects multi-statement prepared statements, so the file
 * is split on statement boundaries and each statement is sent separately.
 *
 * Usage:
 *   node scripts/db-push.mjs [path-to.sql] [--dry-run]
 *
 * Reads the connection string from .dev.vars. Never prints the password.
 */
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request as httpsRequest } from 'node:https';

const HERE = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = resolve(HERE, '..');

/**
 * This machine has no IPv6 route, and Node's global fetch (undici) tries IPv6
 * first and fails without falling back. curl falls back; undici does not.
 * Forcing `family: 4` on node:https avoids the ENETUNREACH entirely.
 */
function postJson(host, pathname, headers, body, attempt = 0) {
  return new Promise((resolvePromise, rejectPromise) => {
    const payload = JSON.stringify(body);
    const req = httpsRequest(
      {
        host,
        family: 4,
        method: 'POST',
        path: pathname,
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...headers,
        },
        timeout: 30_000,
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          data += chunk;
        });
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
      // The link to Neon is intermittent on this machine; retry before giving up.
      if (attempt < 4) {
        const delay = 1000 * 2 ** attempt;
        setTimeout(
          () =>
            postJson(host, pathname, headers, body, attempt + 1).then(
              resolvePromise,
              rejectPromise,
            ),
          delay,
        );
      } else {
        rejectPromise(error);
      }
    });

    req.write(payload);
    req.end();
  });
}

const dryRun = process.argv.includes('--dry-run');
const fileArg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const FILE = resolve(WORKER_DIR, fileArg || 'drizzle/0000_initial.sql');

function loadConnectionString() {
  const raw = readFileSync(resolve(WORKER_DIR, '.dev.vars'), 'utf8');
  const line = raw
    .split('\n')
    .find((l) => l.trim().startsWith('DATABASE_URL_POOLED') || l.trim().startsWith('DATABASE_URL'));
  if (!line) throw new Error('No DATABASE_URL in .dev.vars');
  const value = line.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
  return value;
}

/** Split a SQL file into statements, ignoring comments and string bodies. */
function splitStatements(sql) {
  const stripped = sql
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n');

  const statements = [];
  let current = '';
  let inSingle = false;
  let inDouble = false;
  let inLineComment = false;

  for (let i = 0; i < stripped.length; i++) {
    const ch = stripped[i];
    const next = stripped[i + 1];

    if (inLineComment) {
      if (ch === '\n') inLineComment = false;
      current += ch;
      continue;
    }
    if (!inSingle && !inDouble && ch === '-' && next === '-') {
      inLineComment = true;
      current += ch;
      continue;
    }
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    if (ch === '"' && !inSingle) inDouble = !inDouble;

    if (ch === ';' && !inSingle && !inDouble) {
      if (current.trim()) statements.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) statements.push(current.trim());
  return statements;
}

const conn = loadConnectionString();
const target = new URL(conn);
const host = target.hostname;

const sql = readFileSync(FILE, 'utf8');
const statements = splitStatements(sql);

console.log(`File:   ${FILE}`);
console.log(`Target: ${host.replace(/-pooler/, '')}`);
console.log(`Statements: ${statements.length}\n`);

if (dryRun) {
  for (const [i, s] of statements.entries()) {
    const head = s.split('\n')[0].slice(0, 72);
    console.log(`${String(i + 1).padStart(3)}. ${head}${s.length > 72 ? '…' : ''}`);
  }
  console.log('\n--dry-run: nothing was executed.');
  process.exit(0);
}

let ok = 0;
const failures = [];

for (const [i, statement] of statements.entries()) {
  const label = statement.split('\n')[0].slice(0, 68);

  let result;
  try {
    result = await postJson(
      host,
      '/sql',
      { 'Neon-Connection-String': conn },
      { query: statement },
    );
  } catch (error) {
    failures.push({ i: i + 1, label, message: `network: ${error.message}` });
    console.log(`\n\nNETWORK FAILURE at statement ${i + 1}: ${label}\n  ${error.message}`);
    break;
  }

  if (result.status === 200 && !result.body.message) {
    ok++;
    process.stdout.write(`\r  ${ok}/${statements.length} applied`);
  } else {
    failures.push({
      i: i + 1,
      label,
      message: result.body.message || `HTTP ${result.status}`,
    });
    console.log(`\n\nFAILED at statement ${i + 1}: ${label}\n  ${result.body.message}`);
    // Continue: most statements are independent CREATE ... IF NOT EXISTS.
  }
}

console.log(`\n\nApplied: ${ok}/${statements.length}`);

if (failures.length) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ${f.i}. ${f.label}\n     ${f.message}`);
  process.exit(1);
}

console.log('\nSchema applied.');
