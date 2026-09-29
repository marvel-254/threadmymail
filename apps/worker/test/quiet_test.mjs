import assert from 'node:assert';
const { applyQuietHours, resolveNextDue, morningBriefingId } = await import('/tmp/hb/hb.mjs');

let p = 0, f = 0;
const t = (name, fn) => { try { fn(); p++; console.log('  ok   ' + name); } catch (e) { f++; console.log('  FAIL ' + name + '\n        ' + e.message); } };

// 2026-09-29T14:00:00Z, a Tuesday.
const T = Date.parse('2026-09-29T14:00:00Z');
const prefs = (qh) => ({ timezone: 'UTC', quiet_hours: qh, digest_time: '07:00' });

console.log('\n— a quiet window always yields a moment to re-queue at —');
for (const kind of ['cron', 'digest', 'event']) {
  t(`${kind}: defer with a resolvable atMs (never null)`, () => {
    const d = applyQuietHours(kind, { start: '13:00', end: '15:00' }, 'UTC', T);
    assert.equal(d.defer, true);
    assert.equal(d.atMs, Date.parse('2026-09-29T15:00:00Z'), 'atMs was ' + d.atMs);
  });
}
t('no window: never defers', () => {
  assert.equal(applyQuietHours('cron', null, 'UTC', T).defer, false);
});
t('outside the window: never defers', () => {
  assert.equal(applyQuietHours('cron', { start: '22:00', end: '07:00' }, 'UTC', T).defer, false);
});

console.log('\n— a cron skill survives quiet hours instead of being unscheduled —');
t('re-queuing cron at the window end lands on a real slot', () => {
  const end = applyQuietHours('cron', { start: '13:00', end: '15:00' }, 'UTC', T).atMs;
  const next = resolveNextDue({ type: 'cron', config: { expr: '30 3 * * *' } }, prefs(null), end);
  assert.notEqual(next, null, 'resolveNextDue returned null — the skill would be dropped');
  // 03:30 the following day, since 15:00 today is already past 03:30.
  assert.equal(next.dueMs, Date.parse('2026-09-30T03:30:00Z'));
});
t('an every-minute cron gets a slot one minute after the window', () => {
  const end = applyQuietHours('cron', { start: '13:00', end: '15:00' }, 'UTC', T).atMs;
  const next = resolveNextDue({ type: 'cron', config: { expr: '* * * * *' } }, prefs(null), end);
  assert.equal(next.dueMs, Date.parse('2026-09-29T15:01:00Z'));
});
t('a midnight-spanning window resolves to the right morning', () => {
  // 02:00 local is inside 22:00-07:00.
  const at = Date.parse('2026-09-29T02:00:00Z');
  const d = applyQuietHours('digest', { start: '22:00', end: '07:00' }, 'UTC', at);
  assert.equal(d.defer, true);
  assert.equal(d.atMs, Date.parse('2026-09-29T07:00:00Z'));
});

console.log('\n' + p + ' passed, ' + f + ' failed');
process.exit(f ? 1 : 0);
