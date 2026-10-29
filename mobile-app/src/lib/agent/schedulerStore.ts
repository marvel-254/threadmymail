/**
 * Scheduler Store — persists job definitions, run state, and next/last run times.
 *
 * Jobs survive restarts. Each firing passes the guardrail gate and logs to
 * the Activity store. Missed runs are caught up or marked skipped.
 */
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'threadmymail.db';

export type JobTrigger =
  | { type: 'cron'; expression: string }           // "0 7 * * *" or "*/15 * * * *"
  | { type: 'interval'; minutes: number }          // every N minutes
  | { type: 'event'; event: 'mail:new' | 'app:foreground' }
  | { type: 'manual' };

export type JobConstraints = {
  /** If true, skip during quiet hours (only for scheduled/interval). */
  respectQuietHours?: boolean;
  /** If true, check daily action budget. */
  respectBudget?: boolean;
  /** Max catch-up window in hours; null = never catch up. */
  catchUpWindowHours?: number | null;
};

export type Job = {
  id: string;
  name: string;
  trigger: JobTrigger;
  constraints: JobConstraints;
  enabled: boolean;
  nextRunAt: number | null;      // epoch ms, null = unscheduled
  lastRunAt: number | null;
  lastOutcome: 'ok' | 'skipped' | 'error' | null;
  createdAt: number;
  updatedAt: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS scheduler_jobs (
          id TEXT PRIMARY KEY NOT NULL,
          name TEXT NOT NULL,
          trigger_type TEXT NOT NULL,
          trigger_expression TEXT NOT NULL,
          constraints TEXT NOT NULL,
          enabled INTEGER NOT NULL DEFAULT 1,
          next_run_at INTEGER,
          last_run_at INTEGER,
          last_outcome TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_scheduler_jobs_enabled ON scheduler_jobs(enabled, next_run_at);
      `);
      return db;
    });
  }
  return dbPromise;
}

function fromRow(row: Record<string, unknown>): Job {
  return {
    id: String(row.id),
    name: String(row.name),
    trigger: JSON.parse(String(row.trigger_expression)),
    constraints: JSON.parse(String(row.constraints)),
    enabled: Number(row.enabled) === 1,
    nextRunAt: row.next_run_at ? Number(row.next_run_at) : null,
    lastRunAt: row.last_run_at ? Number(row.last_run_at) : null,
    lastOutcome: row.last_outcome ? String(row.last_outcome) as Job['lastOutcome'] : null,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

export async function getJob(id: string): Promise<Job | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM scheduler_jobs WHERE id = ?',
    [id],
  );
  return row ? fromRow(row) : null;
}

export async function listJobs(): Promise<Job[]> {
  const db = await openDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM scheduler_jobs ORDER BY name',
  );
  return rows.map(fromRow);
}

export async function upsertJob(job: Job): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO scheduler_jobs (id, name, trigger_type, trigger_expression, constraints, enabled, next_run_at, last_run_at, last_outcome, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       trigger_type = excluded.trigger_type,
       trigger_expression = excluded.trigger_expression,
       constraints = excluded.constraints,
       enabled = excluded.enabled,
       next_run_at = excluded.next_run_at,
       last_run_at = excluded.last_run_at,
       last_outcome = excluded.last_outcome,
       updated_at = excluded.updated_at`,
    [
      job.id,
      job.name,
      job.trigger.type,
      JSON.stringify(job.trigger),
      JSON.stringify(job.constraints),
      job.enabled ? 1 : 0,
      job.nextRunAt ?? null,
      job.lastRunAt ?? null,
      job.lastOutcome ?? null,
      job.createdAt,
      job.updatedAt,
    ],
  );
}

export async function deleteJob(id: string): Promise<void> {
  const db = await openDb();
  await db.runAsync('DELETE FROM scheduler_jobs WHERE id = ?', [id]);
}

export async function setJobEnabled(id: string, enabled: boolean): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    'UPDATE scheduler_jobs SET enabled = ?, updated_at = ? WHERE id = ?',
    [enabled ? 1 : 0, Date.now(), id],
  );
}

export async function setJobNextRun(id: string, nextRunAt: number | null): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    'UPDATE scheduler_jobs SET next_run_at = ?, updated_at = ? WHERE id = ?',
    [nextRunAt ?? null, Date.now(), id],
  );
}

export async function setJobLastRun(id: string, lastRunAt: number, outcome: Job['lastOutcome']): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    'UPDATE scheduler_jobs SET last_run_at = ?, last_outcome = ?, updated_at = ? WHERE id = ?',
    [lastRunAt, outcome ?? null, Date.now(), id],
  );
}

/**
 * Returns jobs that are due to run now (or overdue within catch-up window).
 * Only includes enabled jobs.
 */
export async function getDueJobs(now = Date.now()): Promise<Job[]> {
  const db = await openDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM scheduler_jobs
     WHERE enabled = 1
       AND next_run_at IS NOT NULL
       AND next_run_at <= ?
     ORDER BY next_run_at`,
    [now],
  );
  return rows.map(fromRow);
}

/**
 * Computes the next run time for a job from `base` (epoch ms).
 * Returns null for manual/event triggers (scheduled externally).
 */
export function computeNextRun(job: Job, base = Date.now()): number | null {
  const trigger = job.trigger;

  if (trigger.type === 'cron') {
    return cronNextRun(trigger.expression, base);
  }
  if (trigger.type === 'interval') {
    // Interval: every N minutes from the base time, aligned to the minute.
    const minutes = trigger.minutes;
    if (minutes <= 0) return null;
    const baseMinutes = Math.floor(base / 60_000);
    const nextMinutes = baseMinutes + minutes - (baseMinutes % minutes) + minutes;
    return nextMinutes * 60_000;
  }
  // manual / event triggers don't have a computed next run
  return null;
}

/**
 * Minimal cron next-run calculator (5-field: minute hour day-of-month month day-of-week).
 * Supports wildcard, step, range, and comma list syntax in each field. Returns
 * next epoch ms >= base.
 * Day-of-week: 0=Sun .. 6=Sat. Both day fields restricted → match if either matches.
 */
function cronNextRun(expression: string, base: number): number | null {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minSpec, hourSpec, domSpec, monthSpec, dowSpec] = parts;

  const now = new Date(base);
  // Start from the next minute boundary
  now.setSeconds(0, 0);
  if (now.getTime() <= base) now.setMinutes(now.getMinutes() + 1);

  const matches = (spec: string, value: number, max: number): boolean => {
    if (spec === '*') return true;
    if (spec.startsWith('*/')) {
      const step = parseInt(spec.slice(2), 10);
      return !isNaN(step) && step > 0 && value % step === 0;
    }
    const list = spec.split(',').map((s) => s.trim());
    for (const item of list) {
      if (item.includes('-')) {
        const [a, b] = item.split('-').map((n) => parseInt(n, 10));
        if (!isNaN(a) && !isNaN(b) && value >= a && value <= b) return true;
      } else {
        const n = parseInt(item, 10);
        if (!isNaN(n) && value === n) return true;
      }
    }
    return false;
  };

  // Search forward up to 1 year (525600 minutes)
  for (let i = 0; i < 525_600; i++) {
    const minutes = now.getMinutes();
    const hours = now.getHours();
    const date = now.getDate();
    const month = now.getMonth() + 1; // 1-12
    const dow = now.getDay(); // 0-6
    const domMatch = matches(domSpec, date, 31);
    const dowMatch = matches(dowSpec, dow, 6);
    const dayMatch = (domSpec === '*' && dowSpec === '*') || domMatch || dowMatch;

    if (
      matches(minSpec, minutes, 59) &&
      matches(hourSpec, hours, 23) &&
      dayMatch &&
      matches(monthSpec, month, 12)
    ) {
      return now.getTime();
    }
    now.setMinutes(now.getMinutes() + 1);
  }
  return null;
}