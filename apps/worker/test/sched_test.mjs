/**
 * Time-math tests for agent/schedule.ts. Pure functions, fixed instants.
 *   node /tmp/sched_test.mjs
 */
import {
  parseCron, isValidCron, nextCronOccurrence,
  timezoneOffsetMs, wallClockToUtc, nextDailyOccurrence, inQuietHours,
} from '/tmp/schedule.mjs';

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log(`FAIL ${name}\n  got  ${g}\n  want ${w}`); }
};
const ok = (name, cond) => eq(name, !!cond, true);
const utc = (s) => Date.parse(s);

console.log('--- parseCron: rejects, rather than guessing ---');
for (const bad of ['', '0 0 * *', '0 0 * * * *', '60 0 * * *', '0 24 * * *',
                   '0 0 32 * *', '0 0 * 13 *', '0 0 * * 8', '5-1 0 * * *',
                   '*/0 * * * *', 'a b c d e', '0 0 1, * * *', '0 0 * * ,', null, 42, {}])
  eq(`invalid ${JSON.stringify(bad)}`, parseCron(bad), null);
ok('no silent fallback', isValidCron('61 * * * *') === false);

console.log('--- parseCron: accepts what a human types ---');
for (const good of ['* * * * *', '0 9 * * 1-5', '*/5 * * * *', '0 0 1 1 *',
                    '30 7 * * 1,3,5', '15 */4 * * *', '0 9-17 * * 1-5', '0 0 * * 7'])
  ok(`valid "${good}"`, isValidCron(good));
eq('7 collapses to 0 (Sunday)', [...parseCron('0 0 * * 7').dayOfWeek], [0]);
eq('dom restricted', parseCron('0 0 5 * *').domRestricted, true);
eq('*/n dom NOT restricted', parseCron('0 0 */2 * *').domRestricted, false);
eq('plain * dom NOT restricted', parseCron('0 0 * * *').domRestricted, false);

console.log('--- nextCronOccurrence: basics ---');
eq('daily 09:00 after 08:00Z', nextCronOccurrence('0 9 * * *', utc('2026-03-10T08:00:00Z')),
   utc('2026-03-10T09:00:00Z'));
eq('daily 09:00 after 09:00Z is TOMORROW (strictly after)',
   nextCronOccurrence('0 9 * * *', utc('2026-03-10T09:00:00Z')),
   utc('2026-03-11T09:00:00Z'));
eq('sub-minute remainder rounds up to next minute',
   nextCronOccurrence('* * * * *', utc('2026-03-10T09:00:30Z')),
   utc('2026-03-10T09:01:00Z'));
eq('every 5 min', nextCronOccurrence('*/5 * * * *', utc('2026-03-10T09:01:00Z')),
   utc('2026-03-10T09:05:00Z'));
eq('every 15 min past 09:07', nextCronOccurrence('*/15 * * * *', utc('2026-03-10T09:07:00Z')),
   utc('2026-03-10T09:15:00Z'));
eq('midnight', nextCronOccurrence('0 0 * * *', utc('2026-03-10T23:59:00Z')),
   utc('2026-03-11T00:00:00Z'));
eq('never (Feb 31)', nextCronOccurrence('0 0 31 2 *', utc('2026-03-10T00:00:00Z')), null);
eq('invalid expr', nextCronOccurrence('nope', 0), null);

console.log('--- nextCronOccurrence: month + leap rollover ---');
eq('Jan 1 next year', nextCronOccurrence('0 0 1 1 *', utc('2026-03-10T00:00:00Z')),
   utc('2027-01-01T00:00:00Z'));
eq('leap day 2028 (2026 is not)', nextCronOccurrence('0 0 29 2 *', utc('2026-03-10T00:00:00Z')),
   utc('2028-02-29T00:00:00Z'));
eq('Dec 31 -> Jan 1', nextCronOccurrence('0 12 31 12 *', utc('2026-12-31T13:00:00Z')),
   utc('2027-12-31T12:00:00Z'));

console.log('--- nextCronOccurrence: weekday rules (Vixie OR-semantics) ---');
// 2026-03-09 Mon, 03-10 Tue, 03-14 Sat, 03-15 Sun, 03-16 Mon
eq('Mon-Fri from Sat', nextCronOccurrence('0 9 * * 1-5', utc('2026-03-14T12:00:00Z')),
   utc('2026-03-16T09:00:00Z'));
eq('Sun(0) works', nextCronOccurrence('0 9 * * 0', utc('2026-03-10T12:00:00Z')),
   utc('2026-03-15T09:00:00Z'));
eq('Sun(7) == Sun(0)', nextCronOccurrence('0 9 * * 7', utc('2026-03-10T12:00:00Z')),
   utc('2026-03-15T09:00:00Z'));
// dom=1 OR dow=1: the next Monday (03-16) comes before the 1st of the month
// (04-01), and OR-semantics must take the earlier one. Getting this backwards
// would skip a week of briefings.
eq('dom OR dow -> nearest match, not month start', nextCronOccurrence('0 9 1 * 1', utc('2026-03-10T12:00:00Z')),
   utc('2026-03-16T09:00:00Z'));
// Same expression, sampled from Mon 30th after 09:00 so the next Monday (Apr 6)
// is AFTER the 1st (Apr 1) — the 1st must then win.
eq('dom OR dow -> takes the 1st when it is nearest', nextCronOccurrence('0 9 1 * 1', utc('2026-03-30T12:00:00Z')),
   utc('2026-04-01T09:00:00Z'));
// dom only restricted: the 15th, whatever weekday it is.
eq('dom only', nextCronOccurrence('0 9 15 * *', utc('2026-03-10T12:00:00Z')),
   utc('2026-03-15T09:00:00Z'));

console.log('--- timezone offsets ---');
eq('UTC offset', timezoneOffsetMs(utc('2026-03-10T12:00:00Z'), 'UTC'), 0);
eq('Berlin winter (+1)', timezoneOffsetMs(utc('2026-01-15T12:00:00Z'), 'Europe/Berlin'), 3600000);
eq('Berlin summer (+2)', timezoneOffsetMs(utc('2026-07-15T12:00:00Z'), 'Europe/Berlin'), 7200000);
eq('Kolkata half-hour (+5:30)', timezoneOffsetMs(utc('2026-07-15T12:00:00Z'), 'Asia/Kolkata'), 19800000);
eq('New York winter (-5)', timezoneOffsetMs(utc('2026-01-15T12:00:00Z'), 'America/New_York'), -18000000);
eq('New York summer (-4)', timezoneOffsetMs(utc('2026-07-15T12:00:00Z'), 'America/New_York'), -14400000);
eq('unknown zone', timezoneOffsetMs(0, 'Mars/Olympus'), null);
eq('garbage zone', timezoneOffsetMs(0, ''), null);
eq('sub-second does not leak into offset',
   timezoneOffsetMs(utc('2026-07-15T12:00:00Z') + 437, 'Europe/Berlin'), 7200000);

console.log('--- wallClockToUtc: local 07:00 -> correct instant ---');
eq('Berlin winter 07:00 local = 06:00Z',
   wallClockToUtc({ year: 2026, month: 1, day: 15, hour: 7, minute: 0 }, 'Europe/Berlin'),
   utc('2026-01-15T06:00:00Z'));
eq('Berlin summer 07:00 local = 05:00Z',
   wallClockToUtc({ year: 2026, month: 7, day: 15, hour: 7, minute: 0 }, 'Europe/Berlin'),
   utc('2026-07-15T05:00:00Z'));
eq('midnight is 00, never 24',
   wallClockToUtc({ year: 2026, month: 7, day: 15, hour: 0, minute: 0 }, 'Europe/Berlin'),
   utc('2026-07-14T22:00:00Z'));
eq('Kolkata 09:00 local = 03:30Z',
   wallClockToUtc({ year: 2026, month: 7, day: 15, hour: 9, minute: 0 }, 'Asia/Kolkata'),
   utc('2026-07-15T03:30:00Z'));
// True round-trip: for each zone, take the local wall clock at `at`, convert it
// back, and demand the identical instant. A hard-coded hour would only prove the
// one case I already know.
{
  let bad = 0;
  const cases = [
    ['Europe/Berlin', '2026-01-15T06:00:00Z'], ['Europe/Berlin', '2026-07-15T05:00:00Z'],
    ['America/New_York', '2026-01-15T12:00:00Z'], ['America/New_York', '2026-07-15T12:00:00Z'],
    ['Asia/Kolkata', '2026-07-15T03:30:00Z'], ['Australia/Sydney', '2026-01-15T22:00:00Z'],
    ['Pacific/Kiritimati', '2026-07-15T00:00:00Z'], ['Pacific/Chatham', '2026-03-10T00:00:00Z'],
    ['UTC', '2026-03-10T07:00:00Z'], ['America/Sao_Paulo', '2026-06-01T00:00:00Z'],
  ];
  for (const [tz, at] of cases) {
    const ms = utc(at);
    const local = new Date(ms + timezoneOffsetMs(ms, tz));
    const back = wallClockToUtc(
      { year: local.getUTCFullYear(), month: local.getUTCMonth() + 1, day: local.getUTCDate(),
        hour: local.getUTCHours(), minute: local.getUTCMinutes() }, tz);
    if (back !== ms) { bad++; console.log(`  round-trip broke: ${tz} @ ${at} -> ${new Date(back).toISOString()}`); }
  }
  eq('wall clock round-trips exactly in 10 zones/offsets', bad, 0);
}

console.log('--- DST transitions (the case that silently shifts an hour) ---');
// Berlin springs forward 2026-03-29 at 02:00 local -> 03:00 local, so 02:30
// does not exist. Must resolve to a real instant AFTER the gap (03:30 local),
// not oscillate between the two candidate offsets and not land before it.
eq('02:30 on spring-forward day lands after the gap',
   wallClockToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, 'Europe/Berlin'),
   utc('2026-03-29T01:30:00Z'));
eq('…and that instant really reads 03:30 local',
   new Date(wallClockToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, 'Europe/Berlin')
     + timezoneOffsetMs(wallClockToUtc({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, 'Europe/Berlin'), 'Europe/Berlin')
   ).toISOString().slice(11, 16), '03:30');
// 03:30 local itself exists (it is the instant the clocks jump to).
eq('03:30 on spring-forward day is exact',
   wallClockToUtc({ year: 2026, month: 3, day: 29, hour: 3, minute: 30 }, 'Europe/Berlin'),
   utc('2026-03-29T01:30:00Z'));
eq('07:00 after the transition uses +2',
   wallClockToUtc({ year: 2026, month: 3, day: 29, hour: 7, minute: 0 }, 'Europe/Berlin'),
   utc('2026-03-29T05:00:00Z'));
// Berlin falls back 2026-10-25 at 03:00 local -> 02:00, so 02:30 local happens
// TWICE. Both candidates are correct; the earlier must win so a daily action
// fires once rather than twice.
eq('ambiguous 02:30 on fall-back day -> the FIRST occurrence',
   wallClockToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, 'Europe/Berlin'),
   utc('2026-10-25T00:30:00Z'));
eq('…and it really reads 02:30 local',
   (() => { const at = wallClockToUtc({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, 'Europe/Berlin');
            return new Date(at + timezoneOffsetMs(at, 'Europe/Berlin')).toISOString().slice(11, 16); })(), '02:30');
eq('01:30 before the transition uses +2',
   wallClockToUtc({ year: 2026, month: 10, day: 25, hour: 1, minute: 30 }, 'Europe/Berlin'),
   utc('2026-10-24T23:30:00Z'));
eq('07:00 after the fall-back uses +1',
   wallClockToUtc({ year: 2026, month: 10, day: 25, hour: 7, minute: 0 }, 'Europe/Berlin'),
   utc('2026-10-25T06:00:00Z'));

console.log('--- nextDailyOccurrence ---');
eq('today, still ahead', nextDailyOccurrence('07:00', 'UTC', utc('2026-03-10T05:00:00Z')),
   utc('2026-03-10T07:00:00Z'));
eq('today already passed -> tomorrow', nextDailyOccurrence('07:00', 'UTC', utc('2026-03-10T08:00:00Z')),
   utc('2026-03-11T07:00:00Z'));
eq('exactly now is NOT now (strictly after)', nextDailyOccurrence('07:00', 'UTC', utc('2026-03-10T07:00:00Z')),
   utc('2026-03-11T07:00:00Z'));
eq('Berlin local 07:00', nextDailyOccurrence('07:00', 'Europe/Berlin', utc('2026-07-15T00:00:00Z')),
   utc('2026-07-15T05:00:00Z'));
// Kiritimati is +14: at 00:00Z it is already 14:00 local on the 15th, so 07:00
// local has passed and the next one is the 16th — still the 15th in UTC.
eq('Kiritimati (+14) rolls the LOCAL date forward', nextDailyOccurrence('07:00', 'Pacific/Kiritimati', utc('2026-07-15T00:00:00Z')),
   utc('2026-07-15T17:00:00Z'));
// The other direction: at 05:00Z it is 19:00 on the 14th in Kiritimati, so
// 07:00 local has passed and the next is the 16th — the 15th in UTC. A
// UTC-naive implementation would wrongly say the 16th 07:00 UTC.
eq('Kiritimati late-afternoon UTC rolls to the next UTC day', nextDailyOccurrence('07:00', 'Pacific/Kiritimati', utc('2026-07-14T05:00:00Z')),
   utc('2026-07-14T17:00:00Z'));
// At 20:00Z it is already 10:00 on the 15th local, so still the 15th in UTC.
eq('Kiritimati evening UTC rolls to tomorrow local', nextDailyOccurrence('07:00', 'Pacific/Kiritimati', utc('2026-07-14T20:00:00Z')),
   utc('2026-07-15T17:00:00Z'));
eq('23:30 valid', nextDailyOccurrence('23:30', 'UTC', utc('2026-03-10T05:00:00Z')),
   utc('2026-03-10T23:30:00Z'));
eq('00:00 valid', nextDailyOccurrence('00:00', 'UTC', utc('2026-03-10T05:00:00Z')),
   utc('2026-03-11T00:00:00Z'));
for (const bad of ['7:00', '07:60', '24:00', '0700', '', '07:00:00', null, 'am'])
  eq(`malformed "${bad}"`, nextDailyOccurrence(bad, 'UTC', 0), null);
eq('unknown zone', nextDailyOccurrence('07:00', 'Mars/Olympus', 0), null);

console.log('--- inQuietHours ---');
// 22:00-07:00 wraps midnight; 2026-03-10T02:00Z is inside.
eq('inside wrap window (02:00 local)', inQuietHours({ start: '22:00', end: '07:00' }, 'UTC', utc('2026-03-10T02:00:00Z')), true);
eq('inside wrap window (23:00)', inQuietHours({ start: '22:00', end: '07:00' }, 'UTC', utc('2026-03-10T23:00:00Z')), true);
eq('outside wrap window (12:00)', inQuietHours({ start: '22:00', end: '07:00' }, 'UTC', utc('2026-03-10T12:00:00Z')), false);
eq('start boundary is inside', inQuietHours({ start: '22:00', end: '07:00' }, 'UTC', utc('2026-03-10T22:00:00Z')), true);
eq('end boundary is outside', inQuietHours({ start: '22:00', end: '07:00' }, 'UTC', utc('2026-03-10T07:00:00Z')), false);
eq('daytime window 09-17 at 10:00', inQuietHours({ start: '09:00', end: '17:00' }, 'UTC', utc('2026-03-10T10:00:00Z')), true);
eq('daytime window 09-17 at 18:00', inQuietHours({ start: '09:00', end: '17:00' }, 'UTC', utc('2026-03-10T18:00:00Z')), false);
eq('daytime window 09-17 at 08:00', inQuietHours({ start: '09:00', end: '17:00' }, 'UTC', utc('2026-03-10T08:00:00Z')), false);
eq('start==end means OFF, not always-on', inQuietHours({ start: '22:00', end: '22:00' }, 'UTC', utc('2026-03-10T23:00:00Z')), false);
eq('no window', inQuietHours(null, 'UTC', 0), false);
eq('malformed window ignored', inQuietHours({ start: '9am', end: '17:00' }, 'UTC', 0), false);
// The timezone must actually be applied: 23:00 Berlin == 21:00 UTC (outside).
eq('evaluated in the user zone, not UTC',
   inQuietHours({ start: '22:00', end: '07:00' }, 'Europe/Berlin', utc('2026-03-10T21:00:00Z')), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
