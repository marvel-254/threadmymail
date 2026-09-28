#!/usr/bin/env node
/**
 * Phase 0 CPU spike runner.
 *
 * Probes the Durable Object with increasing CPU budgets and reports the
 * largest one that completes. The answer decides the architecture:
 *
 *   completes at high budgets → DO on Free has the documented ~30s → build on Cloudflare Free
 *   fails early            → Free gives DOs only 10ms → Workers Paid ($5) or Cloud Run
 *
 * Usage:
 *   npm run spike                       # against the deployed Worker
 *   npm run spike -- --url http://localhost:8787
 */
import { setTimeout as sleep } from 'node:timers/promises';

const args = process.argv.slice(2);
const urlFlag = args.indexOf('--url');
const BASE = (urlFlag >= 0 ? args[urlFlag + 1] : process.env.SPIKE_URL) ?? '';

// Calibrated against workerd locally: ~800 ns/iteration.
//   n=150,000     ≈  120 ms  → 10x the Workers Free cap. MUST complete.
//   n=40,000,000  ≈  28 s    → probes the documented 30 s DO ceiling.
//
// SIGNAL: whether a probe COMPLETES. Date.now() has no resolution inside a DO
// (a 3.4s probe reported 0ms), so elapsed time is reported but never trusted.
// If a probe is killed by the CPU limit, the DO's checkpointed chunk count is
// fetched from /spike/progress and reveals the real ceiling.
const BUDGETS = [1_000, 12_000, 150_000, 1_000_000, 8_000_000, 40_000_000];
const FREE_CAP_ITERATIONS = 150_000; // must complete to disprove the 10ms cap

function verdict(completed, iterations) {
  if (!completed) return 'FAILED — budget too small';
  if (iterations >= FREE_CAP_ITERATIONS) return '✓ completed well beyond the 10ms Workers cap';
  return 'completed — below the discriminating threshold';
}

if (!BASE) {
  console.error('Set SPIKE_URL or pass --url <worker-url>');
  process.exit(1);
}

console.log(`Target: ${BASE}\n`);

const results = [];
let disproved = false;

for (const n of BUDGETS) {
  process.stdout.write(`probe n=${n.toLocaleString()} … `);
  const started = Date.now();
  let body;
  let ok = false;

  try {
    const res = await fetch(`${BASE}/spike?n=${n}`, {
      signal: AbortSignal.timeout(180_000),
    });
    body = await res.json();
    ok = res.ok;
  } catch (error) {
    const wall = Date.now() - started;
    console.log(`REQUEST FAILED after ${wall}ms — ${error.message}`);
    // A killed CPU loop shows up as a failed request. Ask the DO how far it got.
    try {
      const pr = await fetch(`${BASE}/spike/progress`, { signal: AbortSignal.timeout(30_000) });
      const p = await pr.json();
      console.log(
        `  DO checkpoint: ${p.done_chunks} chunks × 100,000 = ~${(p.done_chunks * 100000).toLocaleString()} iterations completed before the kill`,
      );
    } catch {
      console.log('  (could not read checkpoint)');
    }
    results.push({ n, status: 'failed' });
    break;
  }

  const wall = Date.now() - started;
  if (ok) {
    console.log(
      `COMPLETED  server=${body.elapsed_ms}ms  wall=${wall}ms  ${body.ns_per_iteration}ns/iter — ${verdict(true, n)}`,
    );
    if (n >= FREE_CAP_ITERATIONS) disproved = true;
    results.push({ n, ...body });
  } else {
    console.log(
      `FAILED  server=${body.elapsed_ms}ms  ${body.chunks_completed ?? '?'} chunks done before kill — ${body.error ?? ''}`,
    );
    results.push({ n, ...body });
    break;
  }
  await sleep(1500);
}

console.log('\n── representative agent step ──');
try {
  const res = await fetch(`${BASE}/spike/step`, { signal: AbortSignal.timeout(60_000) });
  console.log(JSON.stringify(await res.json(), null, 2));
} catch (error) {
  console.log(`step failed: ${error.message}`);
}

console.log('══════════ VERDICT ══════════');
if (disproved) {
  console.log('Durable Objects on the Free plan completed a probe far beyond the');
  console.log('10ms Workers Free cap, without a resource-limit error.');
  console.log('→ PROCEED on Cloudflare Free. Phase 0 gate PASSED.');
} else {
  console.log('No probe at or above the discriminating threshold completed.');
  console.log('→ DO appears to share the ~10ms Workers Free cap.');
  console.log('   Do NOT build further. Choose Workers Paid ($5/mo) or Cloud Run.');
  console.log('   Ask the user before creating a GCP project (billing card).');
}
