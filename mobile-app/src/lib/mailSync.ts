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
  sinceDate,
  toStoredMessage,
  type Message,
  type SyncState,
} from './mail';
import { loadMessages, markRead, setStarred, upsertMessages } from './mailStore';
import type { BridgeAccount, BridgeMailbox, MailBridge } from './mailBridge';

export type SyncListener = (state: SyncState, messages: Message[]) => void;

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

  constructor(bridge: MailBridge) {
    this.bridge = bridge;
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
  async start(config: { imap: { host: string; port: number; security?: string }; auth: { user: string; password: string } }): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      this.setState({ phase: 'importing', progress: 0, imported: 0, error: null });
      this.account = await this.bridge.connect({
        imap: { host: config.imap.host, port: config.imap.port, security: config.imap.security as 'tls' | 'starttls' | 'plain' },
        auth: { type: 'password', user: config.auth.user, password: config.auth.password },
      });
      this.mailbox = await this.account.openInbox();

      await this.importHistory();
      this.startIdle();
      this.setState({ phase: 'idle-watching', lastSyncedAt: new Date().toISOString() });
    } catch (err) {
      this.setState({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.running = false;
    }
  }

  /** Import the last HISTORY_DAYS days in bounded batches. */
  private async importHistory(): Promise<void> {
    if (!this.mailbox) return;
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
          threadId: h.messageId ?? String(h.uid),
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
          threadId: h.messageId ?? String(h.uid),
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
      this.setState({ lastSyncedAt: new Date().toISOString() });
    } catch (err) {
      this.setState({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
    } finally {
      // Restart IDLE unless we're shutting down.
      if (this.mailbox) this.startIdle();
    }
  }

  private onIdleError(err: unknown): void {
    this.setState({ phase: 'error', error: err instanceof Error ? err.message : String(err) });
  }

  /** Mark a message read (local + server). */
  async markRead(id: string): Promise<void> {
    await markRead(id);
    const uid = Number(id);
    if (this.mailbox && Number.isFinite(uid)) {
      try {
        await this.mailbox.markSeen([uid]);
      } catch {
        // Local state is already updated; server flag is best-effort.
      }
    }
    this.emit();
  }

  /** Toggle starred (local + server). */
  async toggleStar(id: string): Promise<void> {
    const messages = await loadMessages();
    const msg = messages.find((m) => m.id === id);
    if (!msg) return;
    await setStarred(id, !msg.starred);
    const uid = Number(id);
    if (this.mailbox && Number.isFinite(uid)) {
      try {
        await this.mailbox.addFlags([uid], ['\\Flagged']);
      } catch {
        // best-effort
      }
    }
    this.emit();
  }

  /** Send a message over SMTP. */
  async send(message: { to: string | string[]; subject: string; text?: string; html?: string }): Promise<void> {
    if (!this.account) throw new Error('Not connected');
    await this.account.send(message);
  }

  /** Stop IDLE and disconnect. */
  async stop(): Promise<void> {
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
