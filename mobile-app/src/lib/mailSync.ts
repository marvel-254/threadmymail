/**
 * MailSync — the sync engine: 180-day history import + realtime IDLE push.
 *
 * Design rules (all enforced here, not in the UI):
 *
 *  - History is imported in small batches (IMPORT_BATCH_SIZE) so a single run
 *    never blocks the JS thread for long, and stops after MAX_IMPORT_BATCHES
 *    so one sync cannot run for minutes. The user can pull to refresh to
 *    continue.
 *  - Only headers + previews are stored (see `mailStore`); bodies are fetched
 *    on demand. The store enforces MAX_CACHED_MESSAGES at write time, so the
 *    APK's data directory cannot grow without bound.
 *  - IDLE gives realtime push while the app is running. The engine stops IDLE
 *    before issuing any other command on the same connection (the native
 *    module requires this), then restarts it.
 *  - The engine is pure TypeScript: it talks only to the `MailBridge`
 *    interface, so it is testable without the native module.
 */
import {
  HISTORY_DAYS,
  IMPORT_BATCH_SIZE,
  MAX_IMPORT_BATCHES,
  htmlToText,
  sinceDate,
  threadIdFor,
  toStoredMessage,
  uidFromMessageId,
  type Message,
  type SyncState,
} from './mail';
import {
  deleteMessage,
  loadMessage,
  loadMessages,
  markRead,
  setStarred,
  updateFlags,
  upsertMessages,
} from './mailStore';
import { logActivity, type UndoPayload } from './agent/activityStore';
import { notifyNewMessages } from './notifications';
import type {
  BridgeAccount,
  BridgeMailbox,
  BridgeMailboxInfo,
  MailBridge,
} from './mailBridge';
import type { MessageHeader } from 'react-native-mail-engine';

export type SyncListener = (state: SyncState, messages: Message[]) => void;

export type MailActionResult = {
  /** Activity row id, so the UI can offer Undo in its toast. */
  activityId: string | null;
  /** Whether the live IMAP mailbox confirmed the move/delete. */
  serverChanged: boolean;
  error?: string;
};

export class MailSync {
  private bridge: MailBridge;
  private account: BridgeAccount | null = null;
  private mailbox: BridgeMailbox | null = null;
  private stopIdle: (() => void) | null = null;
  private state: SyncState = {
    phase: 'idle',
    progress: 0,
    imported: 0,
    cappedAt: null,
    lastSyncedAt: null,
    error: null,
  };
  private listeners = new Set<SyncListener>();
  private running = false;
  /** Session-only body cache: fast re-opens, never written to SQLite. */
  private bodyCache = new Map<string, { text: string }>();
  /** Serialises mailbox access so folder switches and bodies cannot interleave. */
  private queue: Promise<unknown> = Promise.resolve();
  /** Resolved once per connection: Archive/Trash paths from LIST special-use flags. */
  private folderCache: { archive?: string | null; trash?: string | null } = {};

  constructor(
    bridge: MailBridge,
    /** Legacy keeps numeric ids/thread fallbacks so existing caches still match. */
    readonly accountId = 'legacy',
  ) {
    this.bridge = bridge;
  }

  /**
   * Undo a logged mail action. Routes to this account's live mailbox when it
   * is connected; the local half always succeeds through mailStore.
   */
  async restoreUndo(payload: UndoPayload): Promise<void> {
    if (payload.kind === 'mail_restore') {
      await upsertMessages([payload.message]);
      const uid = uidFromMessageId(payload.message.id);
      if (!this.account || !Number.isFinite(uid)) return;
      try {
        await this.withMailbox(payload.message.folder ?? 'INBOX', false, async (mailbox) => {
          if (payload.operation === 'move') {
            await mailbox.moveMessages([uid], payload.folder);
          } else {
            await mailbox.removeFlags([uid], ['\\Deleted']);
          }
        });
      } catch {
        // Local Undo already succeeded; server Undo is best-effort.
      }
      return;
    }

    if (payload.kind === 'mail_thread_restore') {
      await upsertMessages(payload.messages);
      const uids = payload.messages
        .map((message) => uidFromMessageId(message.id))
        .filter((uid) => Number.isFinite(uid));
      if (!this.account || uids.length === 0) return;
      try {
        await this.withMailbox(payload.messages[0]?.folder ?? 'INBOX', false, async (mailbox) => {
          if (payload.operation === 'move') {
            await mailbox.moveMessages(uids, payload.folder);
          } else {
            await mailbox.removeFlags(uids, ['\\Deleted']);
          }
        });
      } catch {
        // Local Undo already succeeded; server Undo is best-effort.
      }
      return;
    }

    if (payload.kind === 'mail_thread_flags') {
      for (const item of payload.items) {
        await updateFlags(item.messageId, {
          unread: item.unread,
          starred: item.starred,
        });
      }
      if (!this.account) return;
      const first = payload.items[0];
      const folder = payload.folder
        ?? (first ? (await loadMessage(first.messageId))?.folder : undefined)
        ?? 'INBOX';
      try {
        await this.withMailbox(folder, false, async (mailbox) => {
          for (const item of payload.items) {
            const uid = uidFromMessageId(item.messageId);
            if (!Number.isFinite(uid)) continue;
            if (item.unread !== undefined) {
              await mailbox.markSeen([uid], !item.unread);
            }
            if (item.starred !== undefined) {
              if (item.starred) {
                await mailbox.addFlags([uid], ['\\Flagged']);
              } else {
                await mailbox.removeFlags([uid], ['\\Flagged']);
              }
            }
          }
        });
      } catch {
        // Local Undo already succeeded; server Undo is best-effort.
      }
      return;
    }

    await updateFlags(payload.messageId, {
      unread: payload.unread,
      starred: payload.starred,
      needsReply: payload.needsReply,
    });
    const uid = uidFromMessageId(payload.messageId);
    if (!this.account || !Number.isFinite(uid)) return;
    const message = await loadMessage(payload.messageId);
    try {
      await this.withMailbox(message?.folder ?? 'INBOX', false, async (mailbox) => {
        if (payload.unread !== undefined) {
          await mailbox.markSeen([uid], !payload.unread);
        }
        if (payload.starred !== undefined) {
          if (payload.starred) {
            await mailbox.addFlags([uid], ['\\Flagged']);
          } else {
            await mailbox.removeFlags([uid], ['\\Flagged']);
          }
        }
      });
    } catch {
      // Local Undo already succeeded; server flags are best-effort.
    }
  }

  /** Subscribe to state + message changes. Returns an unsubscribe fn. */
  subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getState(): SyncState {
    return { ...this.state };
  }

  private emit() {
    // Fire-and-forget: listeners load messages themselves.
    for (const l of this.listeners) l({ ...this.state }, []);
  }

  private setState(patch: Partial<SyncState>) {
    this.state = { ...this.state, ...patch };
    this.emit();
  }

  /**
   * Connect, import the last HISTORY_DAYS days in batches, then start IDLE.
   * Safe to call repeatedly; a running sync is not restarted.
   */
  async start(config: {
    imap: { host: string; port: number; security?: 'tls' | 'starttls' | 'plain' };
    smtp?: { host: string; port: number; security?: 'tls' | 'starttls' | 'plain' };
    auth: { user: string; password: string };
  }): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.bodyCache.clear();
    this.folderCache = {};
    try {
      this.setState({ phase: 'importing', progress: 0, imported: 0, error: null });
      const alreadyConnected = !!this.account;
      // SMTP is optional in the bridge type but required for the harness to be able
      // to send at all — pass it whenever the account has one, so send() works.
      this.account = await this.bridge.connect({
        imap: config.imap,
        smtp: config.smtp,
        auth: { type: 'password', user: config.auth.user, password: config.auth.password },
      });
      this.mailbox = await this.account.openInbox();
      if (!alreadyConnected) {
        await logActivity({
          type: 'sync_connect',
          outcome: 'ok',
          detail: 'Connected to IMAP and opened the inbox.',
        });
      }

      const imported = await this.importHistory();
      this.startIdle();
      this.setState({ phase: 'idle-watching', lastSyncedAt: new Date().toISOString() });
      if (imported > 0) {
        await logActivity({
          type: 'sync_import',
          outcome: 'ok',
          detail: `Imported ${imported} message header${imported === 1 ? '' : 's'} from the last ${HISTORY_DAYS} days.`,
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ phase: 'error', error: message });
      await logActivity({
        type: 'sync_error',
        outcome: 'error',
        detail: `Sync failed: ${message}`,
      });
    } finally {
      this.running = false;
    }
  }

  private messageId(uid: number): string {
    return this.accountId === 'legacy' ? String(uid) : `${this.accountId}:${uid}`;
  }

  private enqueue<T>(run: () => Promise<T>): Promise<T> {
    const task = this.queue.then(run);
    this.queue = task.catch(() => undefined);
    return task;
  }

  private async openInboxAgain(): Promise<void> {
    if (!this.account) return;
    try {
      this.mailbox = await this.account.openInbox();
      this.startIdle();
    } catch (err) {
      this.mailbox = null;
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ phase: 'error', error: message });
    }
  }

  /**
   * Run one operation against a specific mailbox. IDLE is stopped first; other
   * folders are opened read-only or read-write as needed, then INBOX is
   * reselected and IDLE restarted. All mailbox work is serialised.
   */
  private withMailbox<T>(
    folder: string,
    readOnly: boolean,
    run: (mailbox: BridgeMailbox) => Promise<T>,
  ): Promise<T> {
    return this.enqueue(async () => {
      if (!this.account) throw new Error('Connect an email account first.');
      if (this.running) throw new Error('The inbox import is still running. Try again in a moment.');
      const stopIdle = this.stopIdle;
      this.stopIdle = null;
      stopIdle?.();

      if (folder === 'INBOX') {
        if (!this.mailbox) this.mailbox = await this.account.openInbox();
        try {
          return await run(this.mailbox);
        } finally {
          if (this.mailbox) this.startIdle();
        }
      }

      const inbox = this.mailbox;
      this.mailbox = null;
      if (inbox) {
        try {
          await inbox.close();
        } catch {
          // The folder switch below re-establishes the session anyway.
        }
      }

      let mailbox: BridgeMailbox | null = null;
      try {
        mailbox = await this.account.openMailbox(folder, readOnly);
        return await run(mailbox);
      } finally {
        if (mailbox) {
          try {
            await mailbox.close();
          } catch {
            // Ignore close failures; INBOX is reopened next.
          }
        }
        await this.openInboxAgain();
      }
    });
  }

  /** List selectable folders with the server's message/unseen counts. */
  async listFolders(): Promise<BridgeMailboxInfo[]> {
    if (!this.account) throw new Error('Connect an email account first.');
    const folders = await this.account.listMailboxes();
    const selectable = folders.filter((folder) => folder.selectable);
    if (!selectable.some((folder) => folder.path === 'INBOX')) {
      selectable.unshift({
        path: 'INBOX',
        name: 'Inbox',
        delimiter: '/',
        flags: ['\\Inbox'],
        selectable: true,
      });
    }
    return selectable;
  }

  /**
   * Lazily cache the newest headers in a folder. INBOX is imported by
   * `start()`, so folder browsing never runs during the initial history import.
   */
  async syncFolder(folder: string, limit = 100): Promise<number> {
    if (folder === 'INBOX') return 0;
    const headers = await this.withMailbox(
      folder,
      true,
      (mailbox) => mailbox.fetchHeaders({ limit }),
    );
    const messages = headers.map((header) => this.headerToMessage(header, folder));
    if (messages.length > 0) {
      await upsertMessages(messages);
      this.emit();
    }
    return messages.length;
  }

  /** Map an IMAP envelope to the header-only row the cache stores. */
  private headerToMessage(h: MessageHeader, folder = 'INBOX'): Message {
    return toStoredMessage({
      id: this.messageId(h.uid),
      accountId: this.accountId,
      folder,
      threadId: threadIdFor({
        messageId: h.messageId,
        inReplyTo: h.inReplyTo,
        references: h.references,
        subject: h.subject,
        fromAddress: h.from[0]?.email,
        date: h.date ? new Date(h.date).toISOString() : undefined,
        accountId: this.accountId === 'legacy' ? undefined : this.accountId,
      }),
      from: h.from[0]?.name || h.from[0]?.email || 'Unknown',
      fromAddress: h.from[0]?.email ?? '',
      subject: h.subject ?? '(no subject)',
      preview: h.preview ?? '',
      date: h.date ? new Date(h.date).toISOString() : new Date(0).toISOString(),
      unread: !h.flags.includes('\\Seen'),
      starred: h.flags.includes('\\Flagged'),
      needsReply: h.flags.includes('\\Answered') === false && !h.flags.includes('\\Seen'),
      hasAttachment: h.hasAttachments,
    });
  }

  /** Import the last HISTORY_DAYS days in bounded batches. */
  private async importHistory(): Promise<number> {
    if (!this.mailbox) return 0;
    const since = sinceDate(HISTORY_DAYS);
    let imported = 0;
    let batch = 0;
    let lastUid: number | undefined;

    while (batch < MAX_IMPORT_BATCHES) {
      const headers = await this.mailbox.fetchHeaders({
        limit: IMPORT_BATCH_SIZE,
        since,
        ...(lastUid !== undefined ? { sinceUid: lastUid } : {}),
      });
      if (headers.length === 0) break;

      const messages: Message[] = headers.map((h) => this.headerToMessage(h));

      const { cappedAt } = await upsertMessages(messages);
      imported += messages.length;
      batch += 1;
      lastUid = headers[headers.length - 1].uid;

      this.setState({
        progress: Math.min(1, imported / (IMPORT_BATCH_SIZE * MAX_IMPORT_BATCHES)),
        imported,
        cappedAt,
      });

      // If we got fewer than a full batch, we've reached the end.
      if (headers.length < IMPORT_BATCH_SIZE) break;
    }
    return imported;
  }

  /** Start IMAP IDLE for realtime push. Stops any existing IDLE first. */
  private startIdle(): void {
    if (!this.mailbox) return;
    this.stopIdle?.();
    this.stopIdle = this.mailbox.idle(
      (event) => {
        // New mail arrived. Stop IDLE, fetch the new UIDs, restart IDLE.
        // IDLE holds the single connection, so it MUST be stopped before any
        // other command runs on the mailbox.
        this.stopIdle?.();
        this.stopIdle = null;
        void this.onIdleMail(event);
      },
      (err) => this.onIdleError(err),
    );
  }

  private async onIdleMail(event: { uids: number[] }): Promise<void> {
    // IDLE is already stopped here (the event handler did it). Fetch the new
    // headers, persist them, then restart IDLE.
    if (!this.mailbox) return;
    try {
      const headers = await this.mailbox.fetchHeaders({ limit: event.uids.length || 50 });
      const messages: Message[] = headers.map((h) => this.headerToMessage(h));
      await upsertMessages(messages);
      void notifyNewMessages(messages);
      this.setState({ lastSyncedAt: new Date().toISOString() });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.setState({ phase: 'error', error: message });
      await logActivity({
        type: 'sync_error',
        outcome: 'error',
        detail: `Realtime mail fetch failed: ${message}`,
      });
    } finally {
      // Restart IDLE unless we're shutting down.
      if (this.mailbox) this.startIdle();
    }
  }

  private onIdleError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    this.setState({ phase: 'error', error: message });
    void logActivity({
      type: 'sync_error',
      outcome: 'error',
      detail: `Realtime connection failed: ${message}`,
    });
  }

  /** Mark a message read (local + server). */
  async markRead(id: string): Promise<void> {
    const before = await loadMessage(id);
    await markRead(id);
    const uid = uidFromMessageId(id);
    if (Number.isFinite(uid)) {
      try {
        await this.withMailbox(
          before?.folder ?? 'INBOX',
          false,
          (mailbox) => mailbox.markSeen([uid], true),
        );
      } catch {
        // Local state is already updated; server flag is best-effort.
      }
    }
    if (before?.unread) {
      await logActivity({
        type: 'mark_read',
        outcome: 'ok',
        detail: `Marked "${before.subject}" read.`,
        targetType: 'message',
        targetId: id,
        subject: before.subject,
        undoPayload: { kind: 'mail_flags', messageId: id, unread: true },
      });
    }
    this.emit();
  }

  /** Toggle starred (local + server). */
  async toggleStar(id: string): Promise<void> {
    const msg = await loadMessage(id);
    if (!msg) return;
    const nextStarred = !msg.starred;
    await setStarred(id, nextStarred);
    const uid = uidFromMessageId(id);
    if (Number.isFinite(uid)) {
      try {
        await this.withMailbox(msg.folder, false, async (mailbox) => {
          if (nextStarred) {
            await mailbox.addFlags([uid], ['\\Flagged']);
          } else {
            await mailbox.removeFlags([uid], ['\\Flagged']);
          }
        });
      } catch {
        // best-effort
      }
    }
    await logActivity({
      type: 'star',
      outcome: 'ok',
      detail: `${nextStarred ? 'Starred' : 'Unstarred'} "${msg.subject}".`,
      targetType: 'message',
      targetId: id,
      subject: msg.subject,
      undoPayload: { kind: 'mail_flags', messageId: id, starred: msg.starred },
    });
    this.emit();
  }

  /** Toggle read/unread locally, then best-effort on the server. */
  async toggleRead(id: string): Promise<void> {
    const before = await loadMessage(id);
    if (!before) return;
    const unread = !before.unread;
    await updateFlags(id, { unread });
    const uid = uidFromMessageId(id);
    if (Number.isFinite(uid)) {
      try {
        await this.withMailbox(
          before.folder,
          false,
          (mailbox) => mailbox.markSeen([uid], !unread),
        );
      } catch {
        // Local state is already updated; server flag is best-effort.
      }
    }
    await logActivity({
      type: unread ? 'mark_unread' : 'mark_read',
      outcome: 'ok',
      detail: `Marked "${before.subject}" ${unread ? 'unread' : 'read'}.`,
      targetType: 'message',
      targetId: id,
      subject: before.subject,
      undoPayload: { kind: 'mail_flags', messageId: id, unread: before.unread },
    });
    this.emit();
  }

  private async threadMessages(threadId: string, folder = 'INBOX'): Promise<Message[]> {
    return (await loadMessages(this.accountId, folder))
      .filter((message) => message.threadId === threadId);
  }

  /** Mark every message in a conversation read or unread, with one Undo entry. */
  async setThreadRead(threadId: string, read: boolean, folder = 'INBOX'): Promise<void> {
    const messages = await this.threadMessages(threadId, folder);
    const changed = messages.filter((message) => message.unread === read);
    if (changed.length === 0) return;

    for (const message of changed) {
      await updateFlags(message.id, { unread: !read });
    }
    const uids = changed
      .map((message) => uidFromMessageId(message.id))
      .filter((uid) => Number.isFinite(uid));
    if (uids.length > 0) {
      try {
        await this.withMailbox(folder, false, (mailbox) => mailbox.markSeen(uids, read));
      } catch {
        // Local state is already updated; server flags are best-effort.
      }
    }

    const subject = messages[0]?.subject ?? '';
    await logActivity({
      type: read ? 'mark_read' : 'mark_unread',
      outcome: 'ok',
      detail: `Marked conversation "${subject}" ${read ? 'read' : 'unread'} (${changed.length} message${changed.length === 1 ? '' : 's'}).`,
      targetType: 'thread',
      targetId: threadId,
      subject,
      undoPayload: {
        kind: 'mail_thread_flags',
        folder,
        items: changed.map((message) => ({
          messageId: message.id,
          unread: message.unread,
        })),
      },
    });
    this.emit();
  }

  /** Toggle the whole conversation: any unread → read, otherwise unread. */
  async toggleThreadRead(threadId: string, folder = 'INBOX'): Promise<void> {
    const messages = await this.threadMessages(threadId, folder);
    if (messages.length === 0) return;
    await this.setThreadRead(threadId, messages.some((message) => message.unread), folder);
  }

  /** Star or unstar the whole conversation (any starred → unstar all). */
  async toggleThreadStar(threadId: string, folder = 'INBOX'): Promise<void> {
    const messages = await this.threadMessages(threadId, folder);
    if (messages.length === 0) return;
    const starred = !messages.some((message) => message.starred);
    for (const message of messages) {
      await updateFlags(message.id, { starred });
    }
    const uids = messages
      .map((message) => uidFromMessageId(message.id))
      .filter((uid) => Number.isFinite(uid));
    if (uids.length > 0) {
      try {
        await this.withMailbox(folder, false, async (mailbox) => {
          if (starred) {
            await mailbox.addFlags(uids, ['\\Flagged']);
          } else {
            await mailbox.removeFlags(uids, ['\\Flagged']);
          }
        });
      } catch {
        // Local state is already updated; server flags are best-effort.
      }
    }
    const subject = messages[0].subject;
    await logActivity({
      type: 'star',
      outcome: 'ok',
      detail: `${starred ? 'Starred' : 'Unstarred'} conversation "${subject}" (${messages.length} message${messages.length === 1 ? '' : 's'}).`,
      targetType: 'thread',
      targetId: threadId,
      subject,
      undoPayload: {
        kind: 'mail_thread_flags',
        folder,
        items: messages.map((message) => ({
          messageId: message.id,
          starred: message.starred,
        })),
      },
    });
    this.emit();
  }

  /**
   * Archive every cached message in a conversation. Undo restores the rows and
   * moves them back to the folder they came from.
   */
  async archiveThread(threadId: string, folder = 'INBOX'): Promise<MailActionResult> {
    const messages = await this.threadMessages(threadId, folder);
    return this.moveThread(threadId, messages, 'archive');
  }

  /** Delete every cached message in a conversation, with the same Undo rules. */
  async removeThread(threadId: string, folder = 'INBOX'): Promise<MailActionResult> {
    const messages = await this.threadMessages(threadId, folder);
    return this.moveThread(threadId, messages, 'delete');
  }

  private async moveThread(
    threadId: string,
    messages: Message[],
    kind: 'archive' | 'delete',
  ): Promise<MailActionResult> {
    const first = messages[0];
    if (!first) return { activityId: null, serverChanged: false, error: 'Conversation not found.' };

    const uids = messages
      .map((message) => uidFromMessageId(message.id))
      .filter((uid) => Number.isFinite(uid));
    let serverChanged = false;
    let operation: 'move' | 'delete' = 'move';
    let error: string | undefined;

    if (uids.length > 0) {
      try {
        await this.withMailbox(first.folder, false, async (mailbox) => {
          if (kind === 'archive') {
            const destination = await this.resolveFolder('archive');
            if (!destination) throw new Error('This server did not advertise an Archive folder.');
            await mailbox.moveMessages(uids, destination);
          } else {
            const trash = await this.resolveFolder('trash');
            if (trash) {
              await mailbox.moveMessages(uids, trash);
            } else {
              await mailbox.deleteMessages(uids, false);
              operation = 'delete';
            }
          }
        });
        serverChanged = true;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    } else {
      error = 'Not connected — changed on this device only.';
    }

    for (const message of messages) {
      await deleteMessage(message.id);
    }
    const verb = kind === 'archive' ? 'Archived' : 'Deleted';
    const count = messages.length;
    const activityId = await logActivity({
      type: kind,
      outcome: serverChanged ? 'ok' : 'error',
      detail: serverChanged
        ? `${verb} conversation "${first.subject}" (${count} message${count === 1 ? '' : 's'}).`
        : `${verb} conversation "${first.subject}" on this device; server change failed${error ? `: ${error}` : '.'}`,
      targetType: 'thread',
      targetId: threadId,
      subject: first.subject,
      undoPayload: {
        kind: 'mail_thread_restore',
        messages,
        folder: first.folder,
        operation,
      },
    });
    this.emit();
    return { activityId, serverChanged, error };
  }

  /**
   * Archive: move out of INBOX to the folder advertised with \Archive (or
   * Gmail's \All), then drop the cached row. Undo moves it back.
   */
  async archive(id: string): Promise<MailActionResult> {
    const message = await loadMessage(id);
    if (!message) return { activityId: null, serverChanged: false, error: 'Message not found.' };

    const uid = uidFromMessageId(id);
    let serverChanged = false;
    let error: string | undefined;
    if (Number.isFinite(uid)) {
      try {
        await this.withMailbox(message.folder, false, async (mailbox) => {
          const destination = await this.resolveFolder('archive');
          if (!destination) throw new Error('This server did not advertise an Archive folder.');
          await mailbox.moveMessages([uid], destination);
        });
        serverChanged = true;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    } else {
      error = 'Not connected — archived on this device only.';
    }

    await deleteMessage(id);
    const activityId = await logActivity({
      type: 'archive',
      outcome: serverChanged ? 'ok' : 'error',
      detail: serverChanged
        ? `Archived "${message.subject}".`
        : `Archived "${message.subject}" on this device; server move failed${error ? `: ${error}` : '.'}`,
      targetType: 'message',
      targetId: id,
      subject: message.subject,
      undoPayload: {
        kind: 'mail_restore',
        message,
        folder: message.folder,
        operation: 'move',
      },
    });
    this.emit();
    return { activityId, serverChanged, error };
  }

  /**
   * Delete to the server's Trash folder when it has one; otherwise mark
   * \Deleted without expunging so Undo can still clear the flag.
   */
  async remove(id: string): Promise<MailActionResult> {
    const message = await loadMessage(id);
    if (!message) return { activityId: null, serverChanged: false, error: 'Message not found.' };

    const uid = uidFromMessageId(id);
    let serverChanged = false;
    let operation: 'move' | 'delete' = 'move';
    let error: string | undefined;
    if (Number.isFinite(uid)) {
      try {
        await this.withMailbox(message.folder, false, async (mailbox) => {
          const trash = await this.resolveFolder('trash');
          if (trash) {
            await mailbox.moveMessages([uid], trash);
          } else {
            await mailbox.deleteMessages([uid], false);
            operation = 'delete';
          }
        });
        serverChanged = true;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }
    } else {
      error = 'Not connected — deleted on this device only.';
    }

    await deleteMessage(id);
    const activityId = await logActivity({
      type: 'delete',
      outcome: serverChanged ? 'ok' : 'error',
      detail: serverChanged
        ? `Deleted "${message.subject}"${operation === 'move' ? ' to Trash' : ''}.`
        : `Deleted "${message.subject}" on this device; server delete failed${error ? `: ${error}` : '.'}`,
      targetType: 'message',
      targetId: id,
      subject: message.subject,
      undoPayload: {
        kind: 'mail_restore',
        message,
        folder: message.folder,
        operation,
      },
    });
    this.emit();
    return { activityId, serverChanged, error };
  }

  /** Resolve Archive/Trash by IMAP special-use flags, then by name/path. */
  private async resolveFolder(kind: 'archive' | 'trash'): Promise<string | null> {
    if (this.folderCache[kind] !== undefined) return this.folderCache[kind] ?? null;
    if (!this.account) return null;

    const boxes = await this.account.listMailboxes();
    const specialUse = kind === 'archive' ? ['\\archive', '\\all'] : ['\\trash'];
    const names = kind === 'archive'
      ? ['archive', 'all mail']
      : ['trash', 'deleted messages', 'deleted items', 'bin'];
    const match = boxes.find((box) => box.flags.some(
      (flag) => specialUse.includes(flag.toLowerCase()),
    )) ?? boxes.find((box) => {
      const name = box.name.toLowerCase();
      const path = box.path.toLowerCase();
      return names.some((candidate) => name === candidate || path === candidate || path.endsWith(`/${candidate}`));
    });
    this.folderCache[kind] = match?.path ?? null;
    return this.folderCache[kind] ?? null;
  }

  /**
   * Search the selected IMAP mailbox, not just the local cache.
   *
   * IMAP SEARCH runs on the server, so it can find mail older than the
   * 180-day import window and matches inside message bodies. Header envelopes
   * for the first 40 UIDs are fetched one by one (the native API has no
   * UID-list fetch), persisted so the result is tappable, and returned newest
   * first. Mailbox access is serialised with folder switches and body fetches.
   */
  searchServer(query: string, folder = 'INBOX'): Promise<Message[]> {
    return this.searchServerNow(query, folder);
  }

  private async searchServerNow(query: string, folder: string): Promise<Message[]> {
    const term = query.trim();
    if (term.length < 2) return [];
    if (!this.account) {
      throw new Error('Connect an email account to search this folder.');
    }

    const messages = await this.withMailbox(folder, false, async (mailbox) => {
      const uids = await mailbox.search({ text: term });
      const unique = [...new Set(uids)].slice(0, 40);
      const found: Message[] = [];
      for (const uid of unique) {
        const headers = await mailbox.fetchHeaders({ uidRange: [uid, uid], limit: 1 });
        const header = headers.find((item) => item.uid === uid);
        if (header) found.push(this.headerToMessage(header, folder));
      }
      return found;
    });
    if (messages.length > 0) {
      await upsertMessages(messages);
      this.emit();
    }
    return messages.sort((a, b) => b.date.localeCompare(a.date));
  }

  /**
   * Fetch a full message body on demand.
   *
   * Bodies are intentionally never persisted: the result lives in a session
   * map and is gone on restart, which keeps the storage invariant intact.
   * Mailbox access is serialised so IDLE and folder switches cannot overlap.
   */
  fetchBody(id: string): Promise<{ text: string }> {
    return this.fetchBodyNow(id);
  }

  private async fetchBodyNow(id: string): Promise<{ text: string }> {
    const cached = this.bodyCache.get(id);
    if (cached) return cached;
    const uid = uidFromMessageId(id);
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new Error('This message has no IMAP UID to fetch.');
    }
    const message = await loadMessage(id);
    const msg = await this.withMailbox(
      message?.folder ?? 'INBOX',
      true,
      (mailbox) => mailbox.fetchMessage(uid),
    );
    const text =
      (msg.textBody ?? '').trim() ||
      htmlToText(msg.htmlBody ?? '') ||
      '';
    const result = { text };
    if (text) this.bodyCache.set(id, result);
    return result;
  }

  /** Send a message over SMTP. */
  async send(message: {
    to: string | string[];
    cc?: string | string[];
    subject: string;
    text?: string;
    html?: string;
  }): Promise<void> {
    if (!this.account) throw new Error('Not connected');
    const recipients = (Array.isArray(message.to) ? message.to : [message.to]).join(', ');
    try {
      await this.account.send(message);
      await logActivity({
        type: 'send',
        outcome: 'ok',
        detail: `Sent "${message.subject}" to ${recipients}. Sends cannot be undone.`,
        targetType: 'message',
        targetId: null,
        subject: message.subject,
      });
    } catch (err) {
      await logActivity({
        type: 'send',
        outcome: 'error',
        detail: `Send to ${recipients} failed: ${err instanceof Error ? err.message : String(err)}.`,
        targetType: 'message',
        targetId: null,
        subject: message.subject,
      });
      throw err;
    }
  }

  /** Stop IDLE and disconnect. */
  async stop(): Promise<void> {
    this.bodyCache.clear();
    this.stopIdle?.();
    this.stopIdle = null;
    if (this.mailbox) {
      try {
        await this.mailbox.close();
      } catch {
        // ignore
      }
      this.mailbox = null;
    }
    if (this.account) {
      try {
        await this.account.disconnect();
      } catch {
        // ignore
      }
      this.account = null;
    }
    this.setState({ phase: 'idle' });
  }
}
