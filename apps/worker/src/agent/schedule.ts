/**
 * Time math for the heartbeat. Pure: no database, no clock, no I/O.
 *
 * WHY THIS FILE IS SEPARATE AND BOTHERED WITH TESTS:
 *   The heartbeat decides when the agent acts without asking the user. A cron
 *   bug here is not a crash — it is the agent firing at 03:00, or never firing,
 *   or firing every minute and burning the budget. Those are the failure modes
 *   nobody notices in review and everybody notices at 03:00.
 *
 *   Everything here takes `fromMs` explicitly rather than reading the clock, so
 *   the whole surface is testable at fixed instants.
 *
 * TIMEZONES: wall-clock times ("07:00 in Europe/Berlin") are not instants. The
 * conversion goes through Intl's offset for a candidate instant, iterated
 * twice, because the offset itself depends on the instant (DST). Getting this
 * wrong shifts every scheduled action by an hour twice a year.
 */

/** Two fields, 24-hour. `07:00`, not `7:00am` — the stored format. */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * How far ahead a cron expression may legitimately reach. Five years covers
 * "0 0 29 2 *" (Feb 29th) with room to spare, and bounds the search so a
 * malformed-but-parseable expression like "0 0 31 2 *" fails loudly instead of
 * spinning.
 */
const MAX_SEARCH_DAYS = 366 * 5;

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/** One parsed cron field: the set of values it matches. */
type Field = ReadonlySet<number>;

interface ParsedCron {
  minute: Field;
  hour: Field;
  dayOfMonth: Field;
  month: Field;
  dayOfWeek: Field;
  /**
   * Vixie-cron semantics: when BOTH day-of-month and day-of-week are
   * restricted, a day matches if EITHER does. Restricting only one is the usual
   * "every day at 9" case, and the alternative (AND) silently never fires.
   */
  domRestricted: boolean;
  dowRestricted: boolean;
}

// ── Cron ────────────────────────────────────────────────────────────────────

const FIELD_RANGES = {
  minute: [0, 59] as const,
  hour: [0, 23] as const,
  dayOfMonth: [1, 31] as const,
  month: [1, 12] as const,
  // 7 is accepted as an alias for Sunday, which people type out of habit.
  dayOfWeek: [0, 7] as const,
};

/**
 * Parse a 5-field cron expression. Returns null for anything unrecognised —
 * there is deliberately no "best effort" fallback, because a schedule that
 * silently becomes "never" or "every minute" is worse than a visible error.
 *
 * Supported per field: a bare star, a star with a step (`*` slash n), a
 * single value, a value range, a range with a step, and comma lists of any of
 * those. No names (JAN/MON), no `@daily`, no seconds field.
 */
export function parseCron(expr: unknown): ParsedCron | null {
  if (typeof expr !== 'string') return null;
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [f0, f1, f2, f3, f4] = parts as [string, string, string, string, string];

  const minute = parseField(f0, FIELD_RANGES.minute);
  const hour = parseField(f1, FIELD_RANGES.hour);
  const dayOfMonth = parseField(f2, FIELD_RANGES.dayOfMonth);
  const month = parseField(f3, FIELD_RANGES.month);
  const dayOfWeek = parseField(f4, FIELD_RANGES.dayOfWeek);
  if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) return null;

  // Day-of-week 7 collapsed to 0 so Sunday is one value, not two.
  const dow = new Set<number>();
  for (const day of dayOfWeek) dow.add(day === 7 ? 0 : day);

  // `*` and `*` slash n are both "every value" for the OR/AND question below.
  const unrestricted = (field: string): boolean =>
    field === '*' || /^\*\/\d+$/.test(field);

  return {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek: dow,
    domRestricted: !unrestricted(f2),
    dowRestricted: !unrestricted(f4),
  };
}

export function isValidCron(expr: unknown): boolean {
  return parseCron(expr) !== null;
}

function parseField(raw: string, [min, max]: readonly [number, number]): Field | null {
  const out = new Set<number>();
  for (const chunk of raw.split(',')) {
    const part = chunk.trim();
    if (part === '') return null;

    const segments = part.split('/');
    if (segments.length > 2) return null;
    const range = segments[0] ?? '';
    const stepRaw = segments[1];

    let step = 1;
    if (stepRaw !== undefined) {
      if (!/^\d+$/.test(stepRaw)) return null;
      step = Number(stepRaw);
      // `*/0` would be an infinite loop; a step above the field width can never
      // match anything useful.
      if (step < 1 || step > max - min + 1) return null;
    }

    let lo: number;
    let hi: number;
    if (range === '*') {
      lo = min;
      hi = max;
    } else if (/^\d+$/.test(range)) {
      lo = hi = Number(range);
    } else {
      const bounds = /^(\d+)-(\d+)$/.exec(range);
      if (!bounds) return null;
      lo = Number(bounds[1]);
      hi = Number(bounds[2]);
      // A descending range is a typo, not a wrap-around.
      if (lo > hi) return null;
    }

    if (lo < min || hi > max) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size > 0 ? out : null;
}

/**
 * The next instant strictly after `fromMs` at which `expr` fires, in epoch ms.
 * Null when the expression is invalid or cannot fire within the search bound
 * (e.g. "0 0 31 2 *" — February 31st).
 *
 * The search skips whole months/days/hours rather than stepping a minute at a
 * time, so a rare expression costs a few dozen iterations, not a million.
 */
export function nextCronOccurrence(expr: unknown, fromMs: number): number | null {
  const cron = parseCron(expr);
  if (cron === null || !Number.isFinite(fromMs)) return null;

  // Start at the next whole minute: cron has no second resolution, so firing on
  // the current minute would be surprising and non-idempotent.
  let t = Math.floor(fromMs / MINUTE_MS) * MINUTE_MS + MINUTE_MS;
  const limit = fromMs + MAX_SEARCH_DAYS * DAY_MS;

  while (t <= limit) {
    const d = new Date(t);

    if (!cron.month.has(d.getUTCMonth() + 1)) {
      // Jump to the first instant of the next month.
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
      continue;
    }
    if (!matchesDay(cron, d)) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
      continue;
    }
    if (!cron.hour.has(d.getUTCHours())) {
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours() + 1);
      continue;
    }
    if (!cron.minute.has(d.getUTCMinutes())) {
      t += MINUTE_MS;
      continue;
    }
    return t;
  }
  return null;
}

function matchesDay(cron: ParsedCron, d: Date): boolean {
  const dom = cron.dayOfMonth.has(d.getUTCDate());
  const dow = cron.dayOfWeek.has(d.getUTCDay());
  if (cron.domRestricted && cron.dowRestricted) return dom || dow;
  return dom && dow;
}

// ── Daily wall-clock times in a named timezone ──────────────────────────────

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
}

/**
 * UTC offset in ms for `timeZone` at instant `ts` (east of UTC is positive),
 * or null if the zone is unknown.
 *
 * Intl is the only source of timezone data available in a Worker — no bundled
 * tz database, and the ICU data ships with V8, so it stays current.
 */
export function timezoneOffsetMs(ts: number, timeZone: string): number | null {
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      // h23, not hour12:false — the latter yields hour "24" for midnight on some
      // ICU versions, which is off by a whole day downstream.
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return null;
  }

  const parts = new Map<string, string>();
  for (const part of formatter.formatToParts(new Date(ts))) parts.set(part.type, part.value);

  const year = Number(parts.get('year'));
  const month = Number(parts.get('month'));
  const day = Number(parts.get('day'));
  const hour = Number(parts.get('hour'));
  const minute = Number(parts.get('minute'));
  const second = Number(parts.get('second'));
  if ([year, month, day, hour, minute, second].some((n) => !Number.isFinite(n))) return null;

  // The zone renders the instant as a wall clock; re-reading that as if it were
  // UTC gives the offset.
  const asUtc = Date.UTC(year, month - 1, day, hour, minute, second);
  // Round ts to the second first: Intl truncates, so a sub-second remainder
  // would otherwise show up as a spurious sub-second offset.
  return asUtc - Math.floor(ts / 1000) * 1000;
}

/**
 * The instant matching a wall-clock time in a zone.
 *
 * Resolved by trying both offsets that bracket the instant rather than by
 * iterating, because iteration does not terminate in the two cases that matter:
 *
 *   Spring forward (a wall clock that does not exist): 02:30 local on the
 *   transition day. Offset(guess) alternates +1/+2 forever. An earlier version
 *   of this function looped three times and returned whichever value it
 *   happened to hold — silently an hour off, twice a year.
 *
 *   Fall back (a wall clock that happens twice): both candidates are correct;
 *   the earlier is returned so a daily digest fires once, not twice.
 *
 * A candidate is correct only if its own local wall clock reads back as the
 * requested one. For a gap neither does, and the pre-transition offset is used,
 * which lands the instant just after the gap (02:30 requested → 03:30 local) —
 * the same disambiguation Temporal calls "compatible/later". A briefing is
 * never better delivered before the hour the user asked for.
 *
 * Null for an unknown zone.
 */
export function wallClockToUtc(wall: WallClock, timeZone: string): number | null {
  const naive = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  if (!Number.isFinite(naive)) return null;

  // 26h in each direction clears every real-world transition, including the
  // 24h date-line jumps, so these are the offsets on either side of `naive`.
  const before = timezoneOffsetMs(naive - 26 * 3_600_000, timeZone);
  const after = timezoneOffsetMs(naive + 26 * 3_600_000, timeZone);
  if (before === null || after === null) return null;

  const candidates = [...new Set([naive - before, naive - after])].sort((a, b) => a - b);
  for (const candidate of candidates) {
    const offset = timezoneOffsetMs(candidate, timeZone);
    // Reads back as the requested wall clock → this candidate is that instant.
    if (offset !== null && candidate + offset === naive) return candidate;
  }
  // The wall clock does not exist here (spring-forward gap).
  return naive - before;
}

/** The calendar date in `timeZone` at instant `ts`, as a plain object. */
function zonedDate(ts: number, timeZone: string): { year: number; month: number; day: number } | null {
  const offset = timezoneOffsetMs(ts, timeZone);
  if (offset === null) return null;
  const d = new Date(ts + offset);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/** Defaults to UTC rather than the Worker zone, which is UTC but not promised. */
export const DEFAULT_TIMEZONE = 'UTC';

/**
 * The next instant after `fromMs` at which the local wall clock reads `hhmm`
 * ("07:00") in `timeZone`. Null for a malformed time or unknown zone.
 *
 * Only today and tomorrow are considered, which is sufficient: a zone whose
 * offset is unknown at all three candidate instants has no usable answer.
 */
export function nextDailyOccurrence(hhmm: string, timeZone: string, fromMs: number): number | null {
  const match = HHMM.exec(hhmm ?? '');
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);

  const today = zonedDate(fromMs, timeZone);
  if (today === null) return null;

  for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
    const probe = new Date(Date.UTC(today.year, today.month - 1, today.day + dayOffset));
    const at = wallClockToUtc(
      {
        year: probe.getUTCFullYear(),
        month: probe.getUTCMonth() + 1,
        day: probe.getUTCDate(),
        hour,
        minute,
      },
      timeZone,
    );
    if (at !== null && at > fromMs) return at;
  }
  return null;
}

export interface QuietHoursWindow {
  start: string;
  end: string;
}

/**
 * True when `atMs` falls inside the user's quiet hours, evaluated in their
 * timezone.
 *
 * A window whose start is later than its end wraps midnight (22:00–07:00),
 * which is the normal case and the reason this is not a pair of comparisons.
 * A window where start equals end is treated as off, not as "always quiet":
 * the likelier intent of "22:00 to 22:00" is "disabled", and guessing
 * "always" would silently stop the agent forever.
 */
export function inQuietHours(
  window: QuietHoursWindow | null | undefined,
  timeZone: string,
  atMs: number,
): boolean {
  if (!window) return false;
  const start = HHMM.exec(window.start ?? '');
  const end = HHMM.exec(window.end ?? '');
  if (!start || !end) return false;

  const startMinutes = Number(start[1]) * 60 + Number(start[2]);
  const endMinutes = Number(end[1]) * 60 + Number(end[2]);
  if (startMinutes === endMinutes) return false;

  const offset = timezoneOffsetMs(atMs, timeZone);
  if (offset === null) return false;
  const local = new Date(atMs + offset);
  const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();

  return startMinutes < endMinutes
    ? minutes >= startMinutes && minutes < endMinutes
    : minutes >= startMinutes || minutes < endMinutes;
}

/**
 * The instant the current quiet-hours window ends, or null when not inside one.
 *
 * Used to defer work rather than drop it: a briefing that came due at 23:00
 * should arrive when the user wakes, not be skipped until tomorrow.
 */
export function nextQuietHoursEnd(
  window: QuietHoursWindow | null | undefined,
  timeZone: string,
  atMs: number,
): number | null {
  if (!inQuietHours(window, timeZone, atMs)) return null;
  return nextDailyOccurrence(window!.end, timeZone, atMs);
}
