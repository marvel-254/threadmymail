/**
 * MailStore — SQLite persistence for the inbox.
 *
 * The store is deliberately narrow: it persists exactly the fields the UI needs
 * (the `Message` shape from `lib/mail`), never full MIME bodies. Bodies are
 * fetched on demand when a thread is opened and are not written back.
 *
 * The cache cap is enforced here, at write time, so the data directory cannot
 * grow without bound no matter how much mail the account has.
 */
import * as SQLite from 'expo-sqlite';
import {
  MAX_CACHED_MESSAGES,
  applyCacheCap,
  threadIdFor,
  type Message,
} from './mail';

type BindParams = Record<string, SQLite.SQLiteBindValue>;

const DB_NAME = 'threadmymail.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS messages (
          id TEXT PRIMARY KEY NOT NULL,
          thread_id TEXT NOT NULL,
          sender TEXT NOT NULL,
          sender_address TEXT NOT NULL,
          subject TEXT NOT NULL,
          preview TEXT NOT NULL,
          date TEXT NOT NULL,
          unread INTEGER NOT NULL DEFAULT 0,
          starred INTEGER NOT NULL DEFAULT 0,
          needs_reply INTEGER NOT NULL DEFAULT 0,
          has_attachment INTEGER NOT NULL DEFAULT 0
        );
        CREATE INDEX IF NOT EXISTS idx_messages_date ON messages(date DESC);
        CREATE INDEX IF NOT EXISTS idx_messages_thread ON messages(thread_id);
        CREATE TABLE IF NOT EXISTS mail_meta (
          key TEXT PRIMARY KEY NOT NULL,
          value TEXT NOT NULL
        );
      `);
      await migrateThreadIds(db);
      return db;
    });
  }
  return dbPromise;
}

/**
 * One-time backfill for caches created before conversation threading. Old rows
 * only stored their own Message-ID (or UID), so the best available key is the
 * normalized subject; the next sync replaces these with reference-based keys.
 */
async function migrateThreadIds(db: SQLite.SQLiteDatabase): Promise<void> {
  const marker = await db.getFirstAsync<{ value: string }>(
    `SELECT value FROM mail_meta WHERE key = 'thread_backfill_v1'`,
  );
  if (marker) return;

  const rows = await db.getAllAsync<{
    id: string;
    subject: string;
    sender_address: string;
    date: string;
  }>('SELECT id, subject, sender_address, date FROM messages');
  for (const row of rows) {
    const threadId = threadIdFor({
      subject: row.subject,
      fromAddress: row.sender_address,
      date: row.date,
    });
    await db.runAsync('UPDATE messages SET thread_id = $thread_id WHERE id = $id', {
      $thread_id: threadId,
      $id: row.id,
    });
  }
  await db.runAsync(
    `INSERT OR REPLACE INTO mail_meta (key, value) VALUES ('thread_backfill_v1', $value)`,
    { $value: String(Date.now()) },
  );
}

function toRow(m: Message): BindParams {
  return {
    id: m.id,
    thread_id: m.threadId,
    sender: m.from,
    sender_address: m.fromAddress,
    subject: m.subject,
    preview: m.preview,
    date: m.date,
    unread: m.unread ? 1 : 0,
    starred: m.starred ? 1 : 0,
    needs_reply: m.needsReply ? 1 : 0,
    has_attachment: m.hasAttachment ? 1 : 0,
  };
}

function fromRow(row: Record<string, unknown>): Message {
  return {
    id: String(row.id),
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
  };
}

/** Insert or update a batch of messages, then enforce the cache cap. */
export async function upsertMessages(messages: Message[]): Promise<{ cappedAt: number | null }> {
  const db = await openDb();
  await db.withTransactionAsync(async () => {
    for (const m of messages) {
      const row = toRow(m);
      await db.runAsync(
        `INSERT INTO messages (id, thread_id, sender, sender_address, subject, preview, date, unread, starred, needs_reply, has_attachment)
         VALUES ($id, $thread_id, $sender, $sender_address, $subject, $preview, $date, $unread, $starred, $needs_reply, $has_attachment)
         ON CONFLICT(id) DO UPDATE SET
           thread_id = excluded.thread_id,
           sender = excluded.sender,
           sender_address = excluded.sender_address,
           subject = excluded.subject,
           preview = excluded.preview,
           date = excluded.date,
           unread = excluded.unread,
           starred = excluded.starred,
           needs_reply = excluded.needs_reply,
           has_attachment = excluded.has_attachment`,
        row,
      );
    }
  });

  // Enforce the cap: count, and if over, delete the oldest rows past the cap.
  const countRow = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM messages');
  const total = countRow?.n ?? 0;
  if (total > MAX_CACHED_MESSAGES) {
    const excess = total - MAX_CACHED_MESSAGES;
    await db.runAsync(
      `DELETE FROM messages WHERE id IN (
         SELECT id FROM messages ORDER BY date DESC LIMIT -1 OFFSET $keep
       )`,
      { $keep: MAX_CACHED_MESSAGES },
    );
    return { cappedAt: MAX_CACHED_MESSAGES };
  }
  return { cappedAt: null };
}

/** Load all cached messages, newest first. */
export async function loadMessages(): Promise<Message[]> {
  const db = await openDb();
  const rows = await db.getAllAsync<Record<string, unknown>>(
    'SELECT * FROM messages ORDER BY date DESC',
  );
  return rows.map(fromRow);
}

/** Load a single message by id (for the thread view). */
export async function loadMessage(id: string): Promise<Message | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<Record<string, unknown>>(
    'SELECT * FROM messages WHERE id = $id',
    { $id: id },
  );
  return row ? fromRow(row) : null;
}

/** Toggle the starred flag. */
export async function setStarred(id: string, starred: boolean): Promise<void> {
  const db = await openDb();
  await db.runAsync('UPDATE messages SET starred = $starred WHERE id = $id', {
    $starred: starred ? 1 : 0,
    $id: id,
  });
}

/** Mark a message read. */
export async function markRead(id: string): Promise<void> {
  const db = await openDb();
  await db.runAsync('UPDATE messages SET unread = 0 WHERE id = $id', { $id: id });
}

/** Remove a message from the local cache (archive/delete). */
export async function deleteMessage(id: string): Promise<void> {
  const db = await openDb();
  await db.runAsync('DELETE FROM messages WHERE id = $id', { $id: id });
}

/** Persist the classifier's needs-reply flag. */
export async function setNeedsReply(id: string, needsReply: boolean): Promise<void> {
  const db = await openDb();
  await db.runAsync('UPDATE messages SET needs_reply = $needs_reply WHERE id = $id', {
    $needs_reply: needsReply ? 1 : 0,
    $id: id,
  });
}

/** Restore several cached flags at once (used by Undo). */
export async function updateFlags(
  id: string,
  flags: { unread?: boolean; starred?: boolean; needsReply?: boolean },
): Promise<void> {
  const assignments: string[] = [];
  const params: BindParams = { $id: id };
  if (flags.unread !== undefined) {
    assignments.push('unread = $unread');
    params.$unread = flags.unread ? 1 : 0;
  }
  if (flags.starred !== undefined) {
    assignments.push('starred = $starred');
    params.$starred = flags.starred ? 1 : 0;
  }
  if (flags.needsReply !== undefined) {
    assignments.push('needs_reply = $needs_reply');
    params.$needs_reply = flags.needsReply ? 1 : 0;
  }
  if (assignments.length === 0) return;
  const db = await openDb();
  await db.runAsync(`UPDATE messages SET ${assignments.join(', ')} WHERE id = $id`, params);
}

/** Total cached count. */
export async function countMessages(): Promise<number> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM messages');
  return row?.n ?? 0;
}

/** Unread cached count, used by the tab badge and launcher badge. */
export async function countUnreadMessages(): Promise<number> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ n: number }>(
    'SELECT COUNT(*) AS n FROM messages WHERE unread = 1',
  );
  return row?.n ?? 0;
}
