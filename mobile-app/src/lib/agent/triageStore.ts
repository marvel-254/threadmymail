/**
 * Triage persistence — run history, classifier verdicts, and the "needs your
 * eye" query.
 *
 * Verdicts are stored per message and overwritten by the latest run, so the
 * briefing always reflects the newest classification instead of accumulating
 * duplicate rows. Runs themselves are append-only audit records.
 */
import * as SQLite from 'expo-sqlite';
import type { Message } from '../mail';

const DB_NAME = 'threadmymail.db';

export type TriageVerdict = 'ignore' | 'read-later' | 'needs-reply' | 'action-required';

export type TriageRunStatus = 'running' | 'completed' | 'cancelled' | 'skipped' | 'error';

export type TriageRun = {
  id: string;
  trigger: 'manual' | 'scheduled';
  status: TriageRunStatus;
  startedAt: number;
  finishedAt: number | null;
  total: number;
  classified: number;
  shadow: boolean;
  error: string | null;
};

export type TriageResult = {
  messageId: string;
  runId: string;
  verdict: TriageVerdict;
  reason: string;
  createdAt: number;
};

export type NeedsEyeVerdict = 'needs-reply' | 'action-required';

export type NeedsEyeItem = {
  message: Message;
  verdict: NeedsEyeVerdict;
  reason: string;
  runId: string;
  classifiedAt: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS triage_runs (
          id TEXT PRIMARY KEY NOT NULL,
          trigger TEXT NOT NULL,
          status TEXT NOT NULL,
          started_at INTEGER NOT NULL,
          finished_at INTEGER,
          total INTEGER NOT NULL DEFAULT 0,
          classified INTEGER NOT NULL DEFAULT 0,
          shadow INTEGER NOT NULL DEFAULT 0,
          error TEXT
        );
        CREATE TABLE IF NOT EXISTS triage_results (
          message_id TEXT PRIMARY KEY NOT NULL,
          run_id TEXT NOT NULL,
          verdict TEXT NOT NULL,
          reason TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_triage_results_verdict ON triage_results(verdict);
        CREATE INDEX IF NOT EXISTS idx_triage_runs_started ON triage_runs(started_at DESC);
      `);
      return db;
    });
  }
  return dbPromise;
}

function runFromRow(row: Record<string, unknown>): TriageRun {
  return {
    id: String(row.id),
    trigger: String(row.trigger) as TriageRun['trigger'],
    status: String(row.status) as TriageRunStatus,
    startedAt: Number(row.started_at),
    finishedAt: row.finished_at === null ? null : Number(row.finished_at),
    total: Number(row.total),
    classified: Number(row.classified),
    shadow: Boolean(row.shadow),
    error: row.error ? String(row.error) : null,
  };
}

export async function createTriageRun(input: {
  id: string;
  trigger: TriageRun['trigger'];
  total: number;
  shadow: boolean;
}): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `INSERT INTO triage_runs (id, trigger, status, started_at, finished_at, total, classified, shadow, error)
     VALUES ($id, $trigger, 'running', $started_at, NULL, $total, 0, $shadow, NULL)`,
    {
      $id: input.id,
      $trigger: input.trigger,
      $started_at: Date.now(),
      $total: input.total,
      $shadow: input.shadow ? 1 : 0,
    },
  );
}

export async function finishTriageRun(input: {
  id: string;
  status: TriageRunStatus;
  classified: number;
  error?: string | null;
}): Promise<void> {
  const db = await openDb();
  await db.runAsync(
    `UPDATE triage_runs
     SET status = $status, finished_at = $finished_at, classified = $classified, error = $error
     WHERE id = $id`,
    {
      $id: input.id,
      $status: input.status,
      $finished_at: Date.now(),
      $classified: input.classified,
      $error: input.error ?? null,
    },
  );
}

export async function saveTriageResults(
  runId: string,
  results: Array<{ messageId: string; verdict: TriageVerdict; reason: string }>,
): Promise<void> {
  if (results.length === 0) return;
  const db = await openDb();
  await db.withTransactionAsync(async () => {
    for (const result of results) {
      await db.runAsync(
        `INSERT INTO triage_results (message_id, run_id, verdict, reason, created_at)
         VALUES ($message_id, $run_id, $verdict, $reason, $created_at)
         ON CONFLICT(message_id) DO UPDATE SET
           run_id = excluded.run_id,
           verdict = excluded.verdict,
           reason = excluded.reason,
           created_at = excluded.created_at`,
        {
          $message_id: result.messageId,
          $run_id: runId,
          $verdict: result.verdict,
          $reason: result.reason.slice(0, 200),
          $created_at: Date.now(),
        },
      );
    }
  });
}

export async function loadNeedsEye(limit = 20): Promise<NeedsEyeItem[]> {
  try {
    const db = await openDb();
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT r.message_id AS result_message_id, r.verdict, r.reason, r.run_id, r.created_at AS classified_at,
              m.thread_id, m.sender, m.sender_address, m.subject, m.preview, m.date,
              m.unread, m.starred, m.needs_reply, m.has_attachment
       FROM triage_results r
       JOIN messages m ON m.id = r.message_id
       WHERE r.verdict IN ('needs-reply', 'action-required')
       ORDER BY r.created_at DESC
       LIMIT $limit`,
      { $limit: limit },
    );
    return rows.map((row) => ({
      message: {
        id: String(row.result_message_id),
        threadId: String(row.thread_id),
        from: String(row.sender),
        fromAddress: String(row.sender_address),
        subject: String(row.subject),
        preview: String(row.preview),
        date: String(row.date),
        unread: Boolean(row.unread),
        starred: Boolean(row.starred),
        needsReply: Boolean(row.needs_reply),
        hasAttachment: Boolean(row.has_attachment),
      },
      verdict: String(row.verdict) as NeedsEyeVerdict,
      reason: String(row.reason),
      runId: String(row.run_id),
      classifiedAt: Number(row.classified_at),
    }));
  } catch {
    // The mail cache and the verdict table are written by different modules;
    // if the cache has not been opened yet there is simply nothing to show.
    return [];
  }
}

/** Ids that already have a verdict, so repeat runs do not re-spend budget. */
export async function loadClassifiedMessageIds(): Promise<Set<string>> {
  const db = await openDb();
  const rows = await db.getAllAsync<{ message_id: string }>(
    'SELECT message_id FROM triage_results',
  );
  return new Set(rows.map((row) => row.message_id));
}

export async function loadLatestTriageRun(): Promise<TriageRun | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM triage_runs ORDER BY started_at DESC LIMIT 1',
  );
  return row ? runFromRow(row) : null;
}

/** True when a scheduled triage has already been attempted today. */
export async function hasScheduledRunToday(now = new Date()): Promise<boolean> {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const db = await openDb();
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT COUNT(*) AS n FROM triage_runs
     WHERE trigger = 'scheduled' AND started_at >= $midnight`,
    { $midnight: midnight },
  );
  return (row?.n ?? 0) > 0;
}

export async function clearTriageResults(): Promise<void> {
  const db = await openDb();
  await db.runAsync('DELETE FROM triage_results');
}
