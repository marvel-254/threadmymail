/**
 * The skills engine: what runs, when, and under what limits.
 *
 * THE NEON TRAP SHAPES THIS FILE (docs/ARCHITECTURE.md §5, agent.md invariant 1).
 *   The 5-minute tick runs forever. If each one asks Postgres what is due, Neon
 *   never suspends, the compute bill grows without bound, and the agent goes
 *   dark. So the schedule is *computed once* — when the user changes something
 *   — and parked in the Durable Object's own storage. A tick then reads its own
 *   SQLite and touches the database only when it genuinely has work, which is
 *   the difference between a compute that sleeps and one that does not.
 *
 *   The consequence worth stating: a schedule is only as fresh as the last
 *   poke. Every mutation that can change what is due calls refreshSchedule().
 *
 * WHY A `digest` TRIGGER EXISTS RATHER THAN A CRON SKILL:
 *   Cron expressions are UTC. "Every morning at 07:00" means different
 *   instants for different users, and DST would shift it twice a year. The
 *   briefing is a local wall-clock promise, so it gets its own trigger type
 *   resolved through the timezone helpers in schedule.ts.
 */

import { Db } from '../db/client.js';
import {
  nextCronOccurrence,
  nextDailyOccurrence,
  nextQuietHoursEnd,
  isValidCron,
  DEFAULT_TIMEZONE,
  type QuietHoursWindow,
} from './schedule.js';
import { loadAgentConfigFresh, type NormalizedPrefs } from './config.js';
import { checkBudget } from './config.js';

/** How the heartbeat came to consider a skill. Recorded on the run row. */
export type TriggerKind = 'cron' | 'event' | 'digest';

export interface ScheduleEntry {
  skill_id: string;
  user_id: string;
  kind: TriggerKind;
  /**
   * Absolute epoch ms. A negative value means "armed, waiting for an event" —
   * event skills are in the table so the cursor check can find them, but they
   * are never due on a timer.
   */
  next_due_ms: number;
}

/** Sentinel for "event-triggered and waiting". Never matches the due query. */
export const EVENT_ARMED = -1;

/**
 * Fixed id for the shipped briefing skill. A constant makes seeding idempotent
 * (one INSERT ... ON CONFLICT DO NOTHING) and keeps the row addressable from
 * the schedule without a name lookup, which is a mutable key.
 */
/**
 * The namespace prefix for the per-user briefing skill id. Not a fixed UUID:
 * `skills.id` is the global primary key, so a constant id would let the first
 * user who ever opened Settings claim the briefing for every user who follows
 * (ON CONFLICT DO NOTHING would swallow every later insert, and the skill is
 * filtered by user_id, so the briefing would simply never appear for them).
 */
const BRIEFING_NAMESPACE = 'tmm:morning-briefing:';

/**
 * A deterministic, well-formed UUID derived from the user id.
 *
 * Deterministic so `ensureMorningBriefing` stays idempotent without a unique
 * constraint on anything else, and derived from user_id so two users can never
 * collide. Version 5 bits are set for cosmetic RFC 4122 conformance only — this
 * is a name-based id, not a random one.
 */
export async function morningBriefingId(userId: string): Promise<string> {
  const digest = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(BRIEFING_NAMESPACE + userId)),
  );
  const bytes = digest.slice(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

const MORNING_BRIEFING = {
  name: 'Morning briefing',
  description:
    'On waking, a short read on what needs you today: open tasks, anything you ' +
    'promised, and what is on the calendar.',
  instructions: [
    'You are writing a briefing for the start of the user’s day. You ran on a schedule, before the app was opened.',
    '',
    'Do this:',
    '1. Call todo.list for anything still open. Call memory.recall or memory.list_pinned if the profile suggests ongoing commitments.',
    '2. Call calendar.list_events for today. If it returns a structured error because no calendar is connected, say so in one clause and carry on — do not treat it as an empty day and do not retry.',
    '3. Call email.search only if it returns results; same rule for a missing connection.',
    '',
    'Then write the briefing as plain prose, under 150 words:',
    '- Lead with the single thing that matters most today, if there is one.',
    '- Then anything time-sensitive, then anything blocked on someone else.',
    '- Omit empty categories entirely rather than writing "nothing scheduled".',
    '',
    'Rules:',
    '- You are reading, not acting. You have no tool that sends, replies, books, or deletes, and that is deliberate.',
    '- Never invent a commitment, a meeting, or a deadline. Only report what a tool returned.',
    '- If a tool failed, say which one and why in a single short clause. A wrong briefing is worse than a short one.',
    '- Call notify with a one-line headline for the notification, then write the full briefing as your reply.',
  ].join('\n'),
  // Read-only plus the two tools that affect only this user's own account. No
  // outward tool is listed, so the model is never even shown the option to send
  // mail at 07:00 without being asked.
  allowed_tools: [
    'todo.list',
    'todo.search',
    'memory.recall',
    'memory.list_pinned',
    'calendar.list_events',
    'email.search',
    'notify',
  ],
} as const;

interface SkillTrigger {
  type: string;
  config: Record<string, unknown>;
}

/** Untrusted JSONB → trigger. Anything unrecognised is treated as on_demand. */
function parseTrigger(raw: unknown): SkillTrigger {
  if (typeof raw === 'string') {
    try {
      return parseTrigger(JSON.parse(raw));
    } catch {
      return { type: 'on_demand', config: {} };
    }
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { type: 'on_demand', config: {} };
  }
  const source = raw as Record<string, unknown>;
  const config =
    typeof source.config === 'object' && source.config !== null && !Array.isArray(source.config)
      ? (source.config as Record<string, unknown>)
      : {};
  return { type: typeof source.type === 'string' ? source.type : 'on_demand', config };
}

function timezoneOf(prefs: NormalizedPrefs): string {
  return prefs.timezone ?? DEFAULT_TIMEZONE;
}

/**
 * The next instant a skill should run, or null when it has no timer at all
 * (an on-demand skill) or its trigger is unusable.
 *
 * Shared by the builder and the dispatcher so a skill cannot be scheduled at
 * one time and rescheduled at another: the two would disagree the first time
 * anyone looked.
 */
export function resolveNextDue(
  trigger: SkillTrigger,
  prefs: NormalizedPrefs,
  atMs: number,
): { dueMs: number; kind: TriggerKind } | null {
  switch (trigger.type) {
    case 'cron': {
      const expr = trigger.config.expr;
      if (!isValidCron(expr)) return null;
      const at = nextCronOccurrence(expr, atMs);
      return at === null ? null : { dueMs: at, kind: 'cron' };
    }
    case 'event':
      return { dueMs: EVENT_ARMED, kind: 'event' };
    case 'digest': {
      const at = nextDailyOccurrence(prefs.digest_time, timezoneOf(prefs), atMs);
      return at === null ? null : { dueMs: at, kind: 'digest' };
    }
    default:
      return null;
  }
}

interface SkillRow extends Record<string, unknown> {
  id: string;
  enabled: boolean;
  trigger: unknown;
}

/**
 * Seed the built-in briefing if this user has never had one.
 *
 * Idempotent by primary key, so it is safe on every schedule refresh. The
 * briefing is a real, editable skill row rather than hardcoded behaviour: the
 * user can rename it, narrow its tools, or delete it, and the schedule honours
 * that.
 */
export async function ensureMorningBriefing(db: Db, userId: string): Promise<boolean> {
  const row = await db.query<{ id: string }>(
    `INSERT INTO skills (
       id, user_id, name, description, instructions, allowed_tools, trigger, budget,
       model_slot, enabled, dry_run_until
     ) VALUES ($1, $2, $3, $4, $5, $6::text[], $7::jsonb, $8::jsonb, $9, TRUE, NULL)
     ON CONFLICT (id) DO NOTHING
     RETURNING id`,
    [
      await morningBriefingId(userId),
      userId,
      MORNING_BRIEFING.name,
      MORNING_BRIEFING.description,
      MORNING_BRIEFING.instructions,
      [...MORNING_BRIEFING.allowed_tools],
      JSON.stringify({ type: 'digest', config: {} }),
      JSON.stringify({ max_runs_per_day: 1 }),
      // The briefing is a background chore, not a conversation.
      'background',
    ],
  );
  return row.length > 0;
}

/**
 * Build the full schedule for one user and hand it to the Durable Object.
 *
 * This is the only place that reads the database on a schedule refresh, and it
 * only runs when the user has just changed something.
 */
export async function buildSchedule(db: Db, userId: string, atMs: number): Promise<ScheduleEntry[]> {
  // Every read here is FRESH, deliberately. buildSchedule always runs straight
  // after a write to skills or users, and the cached Hyperdrive session can be
  // a round trip behind (invariant 3) — which would park a schedule built from
  // the settings the user just replaced.
  const { prefs } = await loadAgentConfigFresh(db, userId);
  await ensureMorningBriefing(db, userId);

  const rows = await db.queryFresh<SkillRow>(
    `SELECT id, enabled, trigger FROM skills WHERE user_id = $1 AND enabled = TRUE`,
    [userId],
  );

  const entries: ScheduleEntry[] = [];
  for (const row of rows) {
    const next = resolveNextDue(parseTrigger(row.trigger), prefs, atMs);
    if (next === null) continue;
    entries.push({
      skill_id: row.id,
      user_id: userId,
      kind: next.kind,
      next_due_ms: next.dueMs,
    });
  }
  return entries;
}

export interface QuietDecision {
  /** True when the run must not happen now. */
  defer: boolean;
  /** When to try again, or null to drop this cycle entirely. */
  atMs: number | null;
}

/**
 * How quiet hours apply depends on what the skill is for, and treating them
 * uniformly is wrong in both directions:
 *
 *   digest — deferred to the moment quiet hours end. The user asked for this
 *     at 07:00; delivering it at 07:05 is correct, skipping it is not.
 *   event  — deferred for the same reason, once. A 23:30 email that needs
 *     triage is handled on waking rather than dropped.
 *   cron   — the cycle is skipped, but NOT deferred to the same instant. The
 *     caller recomputes the next slot from the moment quiet hours end, so a
 *     job whose slot fell inside the window wakes once and fires once. Simply
 *     re-queuing at `atMs` would re-claim and re-defer on every tick for the
 *     whole quiet period, and deferring to the window end itself would burst
 *     every missed cycle at once.
 *
 * `atMs` is the moment quiet hours end. It is returned for every kind: the
 * caller decides what "after that" means, and a null would be read as "remove
 * this skill from the schedule" — which would silently disable a recurring
 * skill the first time its slot landed at 3am.
 */
export function applyQuietHours(
  kind: TriggerKind,
  window: QuietHoursWindow | null,
  timezone: string,
  atMs: number,
): QuietDecision {
  const end = nextQuietHoursEnd(window, timezone, atMs);
  if (end === null) return { defer: false, atMs: null };
  return { defer: true, atMs: end };
}

export interface BudgetDecision {
  allowed: boolean;
  reason: string | null;
}

/**
 * Per-skill daily cap from `skills.budget`, layered on top of the account-wide
 * limits in prefs. The tighter of the two wins: a skill that says "3 runs a
 * day" must not spend the user's whole daily token budget on run four.
 */
export function checkSkillBudget(
  skillBudget: unknown,
  runsToday: number,
  prefs: NormalizedPrefs,
  budgetState: unknown,
  usage: { tokensUsed: number; costUsd: number; outboundCount: number },
): BudgetDecision {
  const caps = asRecord(skillBudget);
  const maxRuns = typeof caps?.max_runs_per_day === 'number' ? caps.max_runs_per_day : null;
  if (maxRuns !== null && Number.isFinite(maxRuns) && runsToday >= maxRuns) {
    return { allowed: false, reason: `skill run cap reached (${runsToday} >= ${maxRuns} today)` };
  }

  const maxTokens = typeof caps?.max_tokens === 'number' ? caps.max_tokens : null;
  const limits = {
    dailyTokens: Math.min(prefs.daily_token_limit, maxTokens ?? prefs.daily_token_limit),
    dailyCostUsd: prefs.daily_cost_usd_limit,
    maxOutbound: prefs.max_outbound_per_day,
  };
  const decision = checkBudget(budgetState, usage, limits);
  return { allowed: !decision.blocked, reason: decision.reason ?? null };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}
