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
import { logActivity, setMailUndoHandler } from './agent/activityStore';
import { notifyNewMessages } from './notifications';
import type { BridgeAccount, BridgeMailbox, MailBridge } from './mailBridge';

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
  /** Serialises body fetches so two threads cannot interleave IDLE restarts. */
  private bodyQueue: Promise<unknown> = Promise.resolve();
  /** Resolved once per connection: Archive/Trash paths from LIST special-use flags. */
  private folderCache: { archive?: string | null; trash?: string | null } = {};

  constructor(bridge: MailBridge) {
    this.bridge = bridge;
    // Undo restores the cached flags through mailStore, then best-effort on the
    // server via the live mailbox. If no account is connected the local half
    // still succeeds.
    setMailUndoHandler(async (payload) => {
      if (payload.kind === 'mail_restore') {
        await upsertMessages([payload.message]);
        const uid = Number(payload.message.id);
        if (!this.mailbox || !Number.isFinite(uid)) return;
        try {
          if (payload.operation === 'move') {
            await this.mailbox.moveMessages([uid], payload.folder);
          } else {
            await this.mailbox.removeFlags([uid], ['\\Deleted']);
          }
        } catch {
          // Local Undo already succeeded; server Undo is best-effort.
        }
        return;
      }

      if (payload.kind === 'mail_thread_restore') {
        await upsertMessages(payload.messages);
        const uids = payload.messages
          .map((message) => Number(message.id))
          .filter((uid) => Number.isFinite(uid));
        if (!this.mailbox || uids.length === 0) return;
        try {
          if (payload.operation === 'move') {
            await this.mailbox.moveMessages(uids, payload.folder);
          } else {
            await this.mailbox.removeFlags(uids, ['\\Deleted']);
          }
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
        if (!this.mailbox) return;
        try {
          for (const item of payload.items) {
            const uid = Number(item.messageId);
            if (!Number.isFinite(uid)) continue;
            if (item.unread !== undefined) {
              await this.mailbox.markSeen([uid], !item.unread);
            }
            if (item.starred !== undefined) {
              if (item.starred) {
                await this.mailbox.addFlags([uid], ['\\Flagged']);
              } else {
                await this.mailbox.removeFlags([uid], ['\\Flagged']);
              }
            }
          }
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
      const uid = Number(payload.messageId);
      if (!this.mailbox || !Number.isFinite(uid)) return;
      try {
        if (payload.unread !== undefined) {
          await this.mailbox.markSeen([uid], !payload.unread);
        }
        if (payload.starred !== undefined) {
          if (payload.starred) {
            await this.mailbox.addFlags([uid], ['\\Flagged']);
          } else {
            await this.mailbox.removeFlags([uid], ['\\Flagged']);
          }
        }
      } catch {
        // Local Undo already succeeded; server flags are best-effort.
      }
    });
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

      const messages: Message[] = headers.map((h) =>
        toStoredMessage({
          id: String(h.uid),
          threadId: threadIdFor({
            messageId: h.messageId,
            inReplyTo: h.inReplyTo,
            references: h.references,
            subject: h.subject,
            fromAddress: h.from[0]?.email,
            date: h.date ? new Date(h.date).toISOString() : undefined,
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
        }),
      );

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
      const messages: Message[] = headers.map((h) =>
        toStoredMessage({
          id: String(h.uid),
          threadId: threadIdFor({
            messageId: h.messageId,
            inReplyTo: h.inReplyTo,
            references: h.references,
            subject: h.subject,
            fromAddress: h.from[0]?.email,
            date: h.date ? new Date(h.date).toISOString() : undefined,
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
        }),
      );
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
    const uid = Number(id);
    if (this.mailbox && Number.isFinite(uid)) {
      try {
        await this.mailbox.markSeen([uid], true);
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
    const messages = await loadMessages();
    const msg = messages.find((m) => m.id === id);
    if (!msg) return;
    const nextStarred = !msg.starred;
    await setStarred(id, nextStarred);
    const uid = Number(id);
    if (this.mailbox && Number.isFinite(uid)) {
      try {
        if (nextStarred) {
          await this.mailbox.addFlags([uid], ['\\Flagged']);
        } else {
          await this.mailbox.removeFlags([uid], ['\\Flagged']);
        }
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
    const uid = Number(id);
    if (this.mailbox && Number.isFinite(uid)) {
      try {
        await this.mailbox.markSeen([uid], !unread);
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

  private async threadMessages(threadId: string): Promise<Message[]> {
    return (await loadMessages()).filter((message) => message.threadId === threadId);
  }

  /** Mark every message in a conversation read or unread, with one Undo entry. */
  async setThreadRead(threadId: string, read: boolean): Promise<void> {
    const messages = await this.threadMessages(threadId);
    const changed = messages.filter((message) => message.unread === read);
    if (changed.length === 0) return;

    for (const message of changed) {
      await updateFlags(message.id, { unread: !read });
    }
    const uids = changed
      .map((message) => Number(message.id))
      .filter((uid) => Number.isFinite(uid));
    if (this.mailbox && uids.length > 0) {
      try {
        await this.mailbox.markSeen(uids, read);
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
        items: changed.map((message) => ({
          messageId: message.id,
          unread: message.unread,
        })),
      },
    });
    this.emit();
  }

  /** Toggle the whole conversation: any unread → read, otherwise unread. */
  async toggleThreadRead(threadId: string): Promise<void> {
    const messages = await this.threadMessages(threadId);
    if (messages.length === 0) return;
    await this.setThreadRead(threadId, messages.some((message) => message.unread));
  }

  /** Star or unstar the whole conversation (any starred → unstar all). */
  async toggleThreadStar(threadId: string): Promise<void> {
    const messages = await this.threadMessages(threadId);
    if (messages.length === 0) return;
    const starred = !messages.some((message) => message.starred);
    for (const message of messages) {
      await updateFlags(message.id, { starred });
    }
    const uids = messages
      .map((message) => Number(message.id))
      .filter((uid) => Number.isFinite(uid));
    if (this.mailbox && uids.length > 0) {
      try {
        if (starred) {
          await this.mailbox.addFlags(uids, ['\\Flagged']);
        } else {
          await this.mailbox.removeFlags(uids, ['\\Flagged']);
        }
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
   * moves them back to INBOX.
   */
  async archiveThread(threadId: string): Promise<MailActionResult> {
    const messages = await this.threadMessages(threadId);
    return this.moveThread(threadId, messages, 'archive');
  }

  /** Delete every cached message in a conversation, with the same Undo rules. */
  async removeThread(threadId: string): Promise<MailActionResult> {
    const messages = await this.threadMessages(threadId);
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
      .map((message) => Number(message.id))
      .filter((uid) => Number.isFinite(uid));
    let serverChanged = false;
    let operation: 'move' | 'delete' = 'move';
    let error: string | undefined;

    if (this.mailbox && uids.length > 0) {
      try {
        if (kind === 'archive') {
          const destination = await this.resolveFolder('archive');
          if (!destination) throw new Error('This server did not advertise an Archive folder.');
          await this.mailbox.moveMessages(uids, destination);
        } else {
          const trash = await this.resolveFolder('trash');
          if (trash) {
            await this.mailbox.moveMessages(uids, trash);
          } else {
            await this.mailbox.deleteMessages(uids, false);
            operation = 'delete';
          }
        }
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
        folder: 'INBOX',
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

    const uid = Number(id);
    let serverChanged = false;
    let error: string | undefined;
    if (this.mailbox && Number.isFinite(uid)) {
      try {
        const destination = await this.resolveFolder('archive');
        if (!destination) throw new Error('This server did not advertise an Archive folder.');
        await this.mailbox.moveMessages([uid], destination);
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
        folder: 'INBOX',
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

    const uid = Number(id);
    let serverChanged = false;
    let operation: 'move' | 'delete' = 'move';
    let error: string | undefined;
    if (this.mailbox && Number.isFinite(uid)) {
      try {
        const trash = await this.resolveFolder('trash');
        if (trash) {
          await this.mailbox.moveMessages([uid], trash);
        } else {
          await this.mailbox.deleteMessages([uid], false);
          operation = 'delete';
        }
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
        folder: 'INBOX',
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
   * Fetch a full message body on demand.
   *
   * Bodies are intentionally never persisted: the result lives in a session
   * map and is gone on restart, which keeps the storage invariant intact.
   * IDLE owns the connection, so it is stopped around the fetch and restarted
   * afterwards. Fetches are serialised for the same reason.
   */
  fetchBody(id: string): Promise<{ text: string }> {
    const task = this.bodyQueue.then(() => this.fetchBodyNow(id));
    this.bodyQueue = task.catch(() => undefined);
    return task;
  }

  private async fetchBodyNow(id: string): Promise<{ text: string }> {
    const cached = this.bodyCache.get(id);
    if (cached) return cached;
    if (!this.mailbox) throw new Error('Not connected — showing the cached preview.');
    const uid = Number(id);
    if (!Number.isInteger(uid) || uid <= 0) {
      throw new Error('This message has no IMAP UID to fetch.');
    }

    const stopIdle = this.stopIdle;
    this.stopIdle = null;
    stopIdle?.();
    try {
      const msg = await this.mailbox.fetchMessage(uid);
      const text =
        (msg.textBody ?? '').trim() ||
        htmlToText(msg.htmlBody ?? '') ||
        '';
      const result = { text };
      if (text) this.bodyCache.set(id, result);
      return result;
    } finally {
      if (this.mailbox) this.startIdle();
    }
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
