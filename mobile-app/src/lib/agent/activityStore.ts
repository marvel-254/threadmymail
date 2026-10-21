/**
 * Activity log — the on-device audit trail for every agent decision.
 *
 * The log is append-only and lives in SQLite next to the mail cache. It is
 * deliberately independent of the message cache so an evicted message still
 * leaves a record of what Millo decided about it.
 */
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'threadmymail.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS agent_activity (
          id TEXT PRIMARY KEY NOT NULL,
          run_id TEXT,
          type TEXT NOT NULL,
          outcome TEXT NOT NULL,
          message_id TEXT,
          subject TEXT,
          detail TEXT NOT NULL,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_activity_created ON agent_activity(created_at DESC);
      `);
      return db;
    });
  }
  return dbPromise;
}

export type ActivityOutcome = 'ok' | 'error' | 'skipped';

export type ActivityEntry = {
  id: string;
  runId: string | null;
  type: string;
  outcome: ActivityOutcome;
  messageId: string | null;
  subject: string | null;
  detail: string;
  createdAt: number;
};

let counter = 0;

function activityId(): string {
  counter = (counter + 1) % 1_000_000;
  return `act_${Date.now()}_${counter.toString(36)}`;
}

export async function logActivity(input: {
  runId?: string | null;
  type: string;
  outcome: ActivityOutcome;
  detail: string;
  messageId?: string | null;
  subject?: string | null;
}): Promise<void> {
  try {
    const db = await openDb();
    await db.runAsync(
      `INSERT INTO agent_activity (id, run_id, type, outcome, message_id, subject, detail, created_at)
       VALUES ($id, $run_id, $type, $outcome, $message_id, $subject, $detail, $created_at)`,
      {
        $id: activityId(),
        $run_id: input.runId ?? null,
        $type: input.type,
        $outcome: input.outcome,
        $message_id: input.messageId ?? null,
        $subject: input.subject ?? null,
        $detail: input.detail.slice(0, 500),
        $created_at: Date.now(),
      },
    );
  } catch {
    // Logging must never take the agent down; the run row still records it.
  }
}

export async function loadActivity(limit = 200): Promise<ActivityEntry[]> {
  const db = await openDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM agent_activity ORDER BY created_at DESC LIMIT $limit',
    { $limit: limit },
  );
  return rows.map((row) => ({
    id: String(row.id),
    runId: row.run_id ? String(row.run_id) : null,
    type: String(row.type),
    outcome: String(row.outcome) as ActivityOutcome,
    messageId: row.message_id ? String(row.message_id) : null,
    subject: row.subject ? String(row.subject) : null,
    detail: String(row.detail),
    createdAt: Number(row.created_at),
  }));
}

export async function clearActivity(): Promise<void> {
  const db = await openDb();
  await db.runAsync('DELETE FROM agent_activity');
}
