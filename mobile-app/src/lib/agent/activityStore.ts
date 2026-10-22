/**
 * Activity log — the on-device audit trail and the source of Undo.
 *
 * The log is append-only and lives in SQLite next to the mail cache. Retention
 * is bounded (90 days / 1,000 rows) so the audit trail cannot grow forever.
 *
 * Reversible entries store an inverse-operation payload. `mail_flags` restores
 * the local unread/starred/needs-reply values a single action changed;
 * `mail_restore` puts an archived/deleted row back in the cache and asks the
 * engine to reverse the server move. Sends deliberately have no payload: the UI
 * labels them as irreversible rather than pretending otherwise.
 */
import * as SQLite from 'expo-sqlite';
import { updateFlags, upsertMessages } from '../mailStore';
import type { Message } from '../mail';

const DB_NAME = 'threadmymail.db';
const RETENTION_DAYS = 90;
const MAX_ENTRIES = 1_000;

export type ActivityOutcome = 'ok' | 'error' | 'skipped';

export type MailFlagsUndo = {
  kind: 'mail_flags';
  messageId: string;
  unread?: boolean;
  starred?: boolean;
  needsReply?: boolean;
};

export type MailRestoreUndo = {
  kind: 'mail_restore';
  message: Message;
  /** Folder to move back into when the action was a folder move. */
  folder: string;
  operation: 'move' | 'delete';
};

export type MailThreadFlagsUndo = {
  kind: 'mail_thread_flags';
  /** Folder the thread was in when the flags changed. */
  folder?: string;
  items: Array<{
    messageId: string;
    unread?: boolean;
    starred?: boolean;
  }>;
};

export type MailThreadRestoreUndo = {
  kind: 'mail_thread_restore';
  messages: Message[];
  folder: string;
  operation: 'move' | 'delete';
};

export type UndoPayload =
  | MailFlagsUndo
  | MailRestoreUndo
  | MailThreadFlagsUndo
  | MailThreadRestoreUndo;

type MailUndoHandler = (payload: UndoPayload) => Promise<void>;

let mailUndoHandler: MailUndoHandler | null = null;

/**
 * The sync engine registers a handler so Undo can restore the server flags as
 * well as the cached row. Without a registered handler Undo still works locally.
 */
export function setMailUndoHandler(handler: MailUndoHandler | null): void {
  mailUndoHandler = handler;
}

export type ActivityEntry = {
  id: string;
  runId: string | null;
  /** Action key, e.g. `triage_decision`, `send`, `mark_read`. */
  type: string;
  outcome: ActivityOutcome;
  targetType: string | null;
  targetId: string | null;
  /** Message id for mail-related entries, when known. */
  messageId: string | null;
  subject: string | null;
  detail: string;
  undoPayload: UndoPayload | null;
  undone: boolean;
  createdAt: number;
};

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
          created_at INTEGER NOT NULL,
          target_type TEXT,
          target_id TEXT,
          undo_payload TEXT,
          undone INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_activity_created ON agent_activity(created_at DESC);
      `);
      await migrate(db);
      return db;
    });
  }
  return dbPromise;
}

/** Additive migration for installs created before Undo/target columns existed. */
async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const columns = await db.getAllAsync<{ name: string }>('PRAGMA table_info(agent_activity)');
  const names = new Set(columns.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ['target_type', 'TEXT'],
    ['target_id', 'TEXT'],
    ['undo_payload', 'TEXT'],
    ['undone', 'INTEGER NOT NULL DEFAULT 0'],
  ];
  for (const [name, definition] of additions) {
    if (!names.has(name)) {
      await db.execAsync(`ALTER TABLE agent_activity ADD COLUMN ${name} ${definition}`);
    }
  }
}

function parseUndoPayload(raw: unknown): UndoPayload | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw) as { kind?: unknown };
    if (
      parsed.kind !== 'mail_flags'
      && parsed.kind !== 'mail_restore'
      && parsed.kind !== 'mail_thread_flags'
      && parsed.kind !== 'mail_thread_restore'
    ) return null;
    return parsed as UndoPayload;
  } catch {
    return null;
  }
}

export async function logActivity(input: {
  runId?: string | null;
  type: string;
  outcome: ActivityOutcome;
  detail: string;
  targetType?: string | null;
  targetId?: string | null;
  messageId?: string | null;
  subject?: string | null;
  undoPayload?: UndoPayload | null;
}): Promise<string | null> {
  try {
    const db = await openDb();
    const messageId = input.messageId
      ?? (input.targetType === 'message' ? input.targetId ?? null : null);
    const id = activityId();
    await db.runAsync(
      `INSERT INTO agent_activity (
         id, run_id, type, outcome, message_id, subject, detail, created_at,
         target_type, target_id, undo_payload, undone
       ) VALUES (
         $id, $run_id, $type, $outcome, $message_id, $subject, $detail, $created_at,
         $target_type, $target_id, $undo_payload, 0
       )`,
      {
        $id: id,
        $run_id: input.runId ?? null,
        $type: input.type,
        $outcome: input.outcome,
        $message_id: messageId,
        $subject: input.subject ?? null,
        $detail: input.detail.slice(0, 500),
        $created_at: Date.now(),
        $target_type: input.targetType ?? null,
        $target_id: input.targetId ?? null,
        $undo_payload: input.undoPayload ? JSON.stringify(input.undoPayload) : null,
      },
    );
    await prune(db);
    return id;
  } catch {
    // Logging must never take the agent down; the run row still records it.
    return null;
  }
}

async function prune(db: SQLite.SQLiteDatabase): Promise<void> {
  const cutoff = Date.now() - RETENTION_DAYS * 86_400_000;
  await db.runAsync('DELETE FROM agent_activity WHERE created_at < $cutoff', { $cutoff: cutoff });
  await db.runAsync(
    `DELETE FROM agent_activity WHERE id NOT IN (
       SELECT id FROM agent_activity ORDER BY created_at DESC LIMIT $keep
     )`,
    { $keep: MAX_ENTRIES },
  );
}

let counter = 0;

function activityId(): string {
  counter = (counter + 1) % 1_000_000;
  return `act_${Date.now()}_${counter.toString(36)}`;
}

function fromRow(row: Record<string, unknown>): ActivityEntry {
  return {
    id: String(row.id),
    runId: row.run_id ? String(row.run_id) : null,
    type: String(row.type),
    outcome: String(row.outcome) as ActivityOutcome,
    targetType: row.target_type ? String(row.target_type) : null,
    targetId: row.target_id
      ? String(row.target_id)
      : row.message_id ? String(row.message_id) : null,
    messageId: row.message_id ? String(row.message_id) : null,
    subject: row.subject ? String(row.subject) : null,
    detail: String(row.detail),
    undoPayload: parseUndoPayload(row.undo_payload),
    undone: Boolean(row.undone),
    createdAt: Number(row.created_at),
  };
}

/** Newest-first page. `cursor` is the number of rows already loaded. */
export async function loadActivity(options: {
  limit?: number;
  cursor?: number;
} = {}): Promise<ActivityEntry[]> {
  const limit = Math.max(1, Math.min(100, options.limit ?? 50));
  const cursor = Math.max(0, options.cursor ?? 0);
  const db = await openDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    `SELECT * FROM agent_activity
     ORDER BY created_at DESC, id DESC
     LIMIT $limit OFFSET $cursor`,
    { $limit: limit, $cursor: cursor },
  );
  return rows.map(fromRow);
}

/** Backwards-compatible alias used by the first triage release. */
export async function listActivity(limit = 200): Promise<ActivityEntry[]> {
  return loadActivity({ limit });
}

export async function undoActivity(id: string): Promise<{ ok: boolean; error?: string }> {
  const db = await openDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM agent_activity WHERE id = $id',
    { $id: id },
  );
  if (!row) return { ok: false, error: 'That entry no longer exists.' };

  const entry = fromRow(row);
  if (entry.undone) return { ok: false, error: 'This action was already undone.' };
  if (!entry.undoPayload) return { ok: false, error: 'This action cannot be undone.' };

  try {
    if (entry.undoPayload.kind === 'mail_flags') {
      if (mailUndoHandler) {
        await mailUndoHandler(entry.undoPayload);
      } else {
        await updateFlags(entry.undoPayload.messageId, {
          unread: entry.undoPayload.unread,
          starred: entry.undoPayload.starred,
          needsReply: entry.undoPayload.needsReply,
        });
      }
    } else if (entry.undoPayload.kind === 'mail_restore') {
      if (mailUndoHandler) {
        await mailUndoHandler(entry.undoPayload);
      } else {
        await upsertMessages([entry.undoPayload.message]);
      }
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Undo failed.' };
  }

  await db.runAsync('UPDATE agent_activity SET undone = 1 WHERE id = $id', { $id: id });
  return { ok: true };
}

export async function clearActivity(): Promise<void> {
  const db = await openDb();
  await db.runAsync('DELETE FROM agent_activity');
}
