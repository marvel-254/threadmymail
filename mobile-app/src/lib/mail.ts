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
  /** UID namespaced by account id for every account except the legacy one. */
  id: string;
  /** Account that owns this message. */
  accountId: string;
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
  accountId: string;
  subject: string;
  participants: string[];
  lastDate: string;
  messageCount: number;
  unreadCount: number;
  needsReply: boolean;
  starred: boolean;
  /** Newest message in the conversation (row subject/preview source). */
  latest: Message;
};

/** Remove reply/forward prefixes and collapse whitespace for subject grouping. */
export function normalizeSubject(subject: string): string {
  return subject
    .replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Conversation key. Prefer the root Message-ID from References, then the
 * immediate parent from In-Reply-To, then the message's own Message-ID. Only
 * messages with no usable IDs fall back to a normalized subject.
 */
export function threadIdFor(raw: {
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string[] | null;
  subject?: string | null;
  fromAddress?: string | null;
  date?: string | null;
  /** Scope subject/fallback keys so equal subjects in two accounts never merge. */
  accountId?: string | null;
}): string {
  const cleanId = (value: string | null | undefined) =>
    value?.replace(/[<>]/g, '').trim() || null;
  const root = raw.references?.map(cleanId).find(Boolean)
    ?? cleanId(raw.inReplyTo)
    ?? cleanId(raw.messageId);
  const scope = raw.accountId ? `${raw.accountId}:` : '';
  if (root) return `ref:${scope}${root}`;

  const subject = normalizeSubject(raw.subject ?? '').toLowerCase();
  if (subject && subject !== '(no subject)') return `subj:${scope}${subject}`;
  return `fallback:${scope}${(raw.fromAddress ?? '').toLowerCase()}:${(raw.date ?? '').slice(0, 10)}`;
}

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

/** Extract the owning account from a legacy numeric id or `accountId:uid`. */
export function accountIdFromMessageId(id: string): string {
  const separator = id.lastIndexOf(':');
  return separator > 0 ? id.slice(0, separator) : 'legacy';
}

/** Extract the IMAP UID from a legacy numeric id or `accountId:uid`. */
export function uidFromMessageId(id: string): number {
  const tail = id.slice(id.lastIndexOf(':') + 1);
  return Number(tail);
}

/**
 * Reduce a fetched message to what we are willing to store. This is the single
 * place where the bloat rule is enforced — if a field is not listed here, it
 * does not reach disk.
 */
export function toStoredMessage(raw: {
  id: string;
  accountId: string;
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
    accountId: raw.accountId,
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

/** Group messages into conversations, newest thread first. */
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
        accountId: sorted[0].accountId,
        subject: sorted[0].subject,
        participants: [...new Set(sorted.map((m) => m.from))],
        lastDate: sorted[0].date,
        messageCount: sorted.length,
        unreadCount: sorted.filter((m) => m.unread).length,
        needsReply: sorted.some((m) => m.needsReply),
        starred: sorted.some((m) => m.starred),
        latest: sorted[0],
      };
    })
    .sort((a, b) => b.lastDate.localeCompare(a.lastDate));
}

/** Apply filters and search to whole conversations, not individual messages. */
export function selectThreads(
  threads: Thread[],
  filter: MailFilter,
  query: string,
): Thread[] {
  const q = query.trim().toLowerCase();
  return threads.filter((thread) => {
    if (filter === 'unread' && thread.unreadCount === 0) return false;
    if (filter === 'needs_reply' && !thread.needsReply) return false;
    if (filter === 'starred' && !thread.starred) return false;
    if (!q) return true;
    return (
      thread.subject.toLowerCase().includes(q) ||
      thread.participants.some((participant) => participant.toLowerCase().includes(q)) ||
      thread.latest.preview.toLowerCase().includes(q)
    );
  });
}

/**
 * Reduce an HTML-only message to readable text.
 *
 * The thread view is a plain `Text`, so a full HTML renderer would be the wrong
 * first step. This strips scripts/styles and tags, keeps paragraph breaks, and
 * decodes the handful of entities that show up in ordinary mail.
 */
export function htmlToText(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
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
