/**
 * Mail store — the inbox data model and the sync rules.
 *
 * Two constraints shape everything here:
 *
 *  1. APK size. The app must not bloat. History is imported for at most
 *     HISTORY_DAYS_DAYS days, and each imported message keeps only its header
 *     and preview — never the full MIME body. Bodies are fetched on demand when
 *     a thread is opened. That caps local growth at roughly a few hundred KB
 *     per thousand messages rather than tens of MB.
 *
 *  2. Freshness. New mail must appear without the user pulling to refresh, so
 *     the store exposes an IDLE-driven push path alongside the one-shot import.
 *
 * The IMAP bridge itself is a native module and is not wired yet; this module
 * owns the rules and the state, and the bridge will feed it.
 */

/** How far back the one-shot history import looks. */
export const HISTORY_DAYS = 180;

/**
 * Ceiling on locally cached messages. Once reached, the oldest rows are evicted
 * first — this is the hard guarantee that the APK's data directory cannot grow
 * without bound regardless of how much mail the account has.
 */
export const MAX_CACHED_MESSAGES = 5_000;

/** Messages fetched per batch during import. Smaller batches keep jank low. */
export const IMPORT_BATCH_SIZE = 50;

/** Hard cap on a single import run, so one sync cannot run for minutes. */
export const MAX_IMPORT_BATCHES = 12; // 12 * 50 = 600 headers per run

export type MailFilter = 'all' | 'unread' | 'needs_reply' | 'starred';

export type Message = {
  id: string;
  threadId: string;
  from: string;
  fromAddress: string;
  subject: string;
  preview: string;
  /** ISO 8601. */
  date: string;
  unread: boolean;
  starred: boolean;
  /** True when the agent believes a reply is expected. */
  needsReply: boolean;
  hasAttachment: boolean;
  /** Only present once the thread is opened — never stored by the importer. */
  body?: string;
};

export type Thread = {
  id: string;
  subject: string;
  participants: string[];
  lastDate: string;
  messageCount: number;
  unreadCount: number;
  needsReply: boolean;
};

export type SyncState = {
  phase: 'idle' | 'importing' | 'idle-watching' | 'offline' | 'error';
  /** 0–1 for the history import. */
  progress: number;
  /** Rows written so far this run. */
  imported: number;
  cappedAt: number | null;
  lastSyncedAt: string | null;
  error: string | null;
};

export const INITIAL_SYNC_STATE: SyncState = {
  phase: 'idle',
  progress: 0,
  imported: 0,
  cappedAt: null,
  lastSyncedAt: null,
  error: null,
};

/** ISO date `days` ago, used as the IMAP SINCE bound. */
export function sinceDate(days: number, now = new Date()): string {
  const d = new Date(now.getTime() - days * 86_400_000);
  return d.toISOString().slice(0, 10);
}

/**
 * Reduce a fetched message to what we are willing to store. This is the single
 * place where the bloat rule is enforced — if a field is not listed here, it
 * does not reach disk.
 */
export function toStoredMessage(raw: {
  id: string;
  threadId: string;
  from: string;
  fromAddress: string;
  subject: string;
  preview: string;
  date: string;
  unread?: boolean;
  starred?: boolean;
  needsReply?: boolean;
  hasAttachment?: boolean;
}): Message {
  return {
    id: raw.id,
    threadId: raw.threadId,
    from: raw.from,
    fromAddress: raw.fromAddress,
    subject: raw.subject,
    // A preview is a truncated first paragraph; cap it hard.
    preview: raw.preview.slice(0, 300),
    date: raw.date,
    unread: raw.unread ?? false,
    starred: raw.starred ?? false,
    needsReply: raw.needsReply ?? false,
    hasAttachment: raw.hasAttachment ?? false,
    // body deliberately omitted
  };
}

/**
 * Evict oldest-first once the cache exceeds its ceiling. Returns the retained
 * list; callers write the difference back to storage.
 */
export function applyCacheCap(messages: Message[], cap = MAX_CACHED_MESSAGES): Message[] {
  if (messages.length <= cap) return messages;
  const sorted = [...messages].sort((a, b) => b.date.localeCompare(a.date));
  return sorted.slice(0, cap);
}

/** Group messages into threads, newest thread first. */
export function buildThreads(messages: Message[]): Thread[] {
  const byThread = new Map<string, Message[]>();
  for (const m of messages) {
    const list = byThread.get(m.threadId);
    if (list) list.push(m);
    else byThread.set(m.threadId, [m]);
  }

  return [...byThread.entries()]
    .map(([id, msgs]) => {
      const sorted = [...msgs].sort((a, b) => b.date.localeCompare(a.date));
      return {
        id,
        subject: sorted[0].subject,
        participants: [...new Set(sorted.map((m) => m.from))],
        lastDate: sorted[0].date,
        messageCount: sorted.length,
        unreadCount: sorted.filter((m) => m.unread).length,
        needsReply: sorted.some((m) => m.needsReply),
      };
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/** Apply a filter and a free-text query. */
export function selectMessages(
  messages: Message[],
  filter: MailFilter,
  query: string,
): Message[] {
  const q = query.trim().toLowerCase();
  return messages
    .filter((m) => {
      if (filter === 'unread' && !m.unread) return false;
      if (filter === 'needs_reply' && !m.needsReply) return false;
      if (filter === 'starred' && !m.starred) return false;
      if (!q) return true;
      return (
        m.subject.toLowerCase().includes(q) ||
        m.from.toLowerCase().includes(q) ||
        m.preview.toLowerCase().includes(q)
      );
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Relative time label, Gmail-style: 3:04 PM · Yesterday · Mar 4. */
export function formatListTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const sameDay = d.toDateString() === now.toDateString();
  if (sameDay) {
    return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  const yesterday = new Date(now.getTime() - 86_400_000);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}
