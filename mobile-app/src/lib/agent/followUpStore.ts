/**
 * Follow-up persistence — per-thread snoozes and the once-a-day reminder marker.
 *
 * Snoozes live on the device next to the mail cache. The marker records that a
 * reminder already ran for a local day, so the in-app scheduler does not retry
 * every minute after the configured time.
 */
import * as SQLite from 'expo-sqlite';
import { localDayKey } from '../guardrails';

const DB_NAME = 'threadmymail.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS followup_snoozes (
          thread_id TEXT PRIMARY KEY NOT NULL,
          until INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS followup_reminders (
          day TEXT PRIMARY KEY NOT NULL,
          count INTEGER NOT NULL,
          created_at INTEGER NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

/** Thread id → epoch ms until which it should stay out of the follow-up list. */
export async function loadFollowUpSnoozes(): Promise<Map<string, number>> {
  const db = await openDb();
  const rows = await db.getAllAsync<{ thread_id: string; until: number }>(
    'SELECT thread_id, until FROM followup_snoozes WHERE until > $now',
    { $now: Date.now() },
  );
  return new Map(rows.map((row) => [row.thread_id, Number(row.until)]));
}

/** Snooze a thread for `days` days. Re-snoozing replaces the old deadline. */
export async function snoozeFollowUp(threadId: string, days = 2): Promise<number> {
  const db = await openDb();
  const now = Date.now();
  const until = now + Math.max(1, Math.round(days)) * 86_400_000;
  await db.runAsync(
    `INSERT INTO followup_snoozes (thread_id, until, updated_at)
     VALUES ($thread_id, $until, $now)
     ON CONFLICT(thread_id) DO UPDATE SET until = excluded.until, updated_at = excluded.updated_at`,
    { $thread_id: threadId, $until: until, $now: now },
  );
  return until;
}

export async function hasFollowUpReminderToday(now = new Date()): Promise<boolean> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ day: string }>(
    'SELECT day FROM followup_reminders WHERE day = $day',
    { $day: localDayKey(now) },
  );
  return !!row;
}

/** Record that today's reminder check ran, even when there was nothing stale. */
export async function markFollowUpReminder(
  count: number,
  now = new Date(),
): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO followup_reminders (day, count, created_at)
     VALUES ($day, $count, $created_at)
     ON CONFLICT(day) DO UPDATE SET count = excluded.count, created_at = excluded.created_at`,
    { $day: localDayKey(now), $count: count, $created_at: Date.now() },
  );
}
