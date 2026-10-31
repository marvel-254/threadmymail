/**
 * MailBridge — the seam between the sync engine and the native IMAP/SMTP module.
 *
 * The engine (`mailSync.ts`) only ever talks to this interface. That keeps the
 * engine pure TypeScript (testable, no native import at module load) and makes
 * the native module swappable: today it wraps `react-native-mail-engine`, and a
 * custom JavaMail module could replace it without touching the engine.
 *
 * The native module is a Nitro module and cannot run in Expo Go — it needs a
 * development build. `createMailBridge` therefore imports it lazily and throws a
 * clear error if the native side is missing, so the app still boots in Expo Go
 * with the inbox in "offline" state rather than crashing.
 */
import type {
  ConnectConfig,
  MailAccount,
  Mailbox,
  MessageHeader,
  NewMailEvent,
} from 'react-native-mail-engine';

export type BridgeMailboxInfo = {
  path: string;
  name: string;
  delimiter: string;
  flags: string[];
  selectable: boolean;
  exists?: number;
  unseen?: number;
};

export type BridgeAccount = {
  /** List folders so the engine can resolve Archive/Trash and browse mailboxes. */
  listMailboxes(): Promise<BridgeMailboxInfo[]>;
  /** Open the inbox and return a handle. */
  openInbox(): Promise<BridgeMailbox>;
  /** Select any mailbox by IMAP path. */
  openMailbox(path: string, readOnly?: boolean): Promise<BridgeMailbox>;
  /** Send a message over SMTP. */
  send(message: {
    to: string | string[];
    cc?: string | string[];
    subject: string;
    text?: string;
    html?: string;
  }): Promise<void>;
  /** Close the connection and free native resources. */
  disconnect(): Promise<void>;
};

export type BridgeMailbox = {
  /** Fetch newest-first envelopes, optionally since a date. */
  fetchHeaders(options: { limit?: number; since?: string; sinceUid?: number; uidRange?: [number, number] }): Promise<MessageHeader[]>;
  /** Fetch a full parsed message by UID. */
  fetchMessage(uid: number): Promise<{ header: MessageHeader; textBody?: string; htmlBody?: string }>;
  /** Server-side IMAP search; resolves to matching UIDs. */
  search(criteria: { text?: string; from?: string; to?: string; subject?: string; body?: string }): Promise<number[]>;
  /** Mark messages seen or unseen. */
  markSeen(uids: number[], seen?: boolean): Promise<void>;
  /** Add flags (e.g. \Flagged for star). */
  addFlags(uids: number[], flags: string[]): Promise<void>;
  /** Remove flags (e.g. unstar). */
  removeFlags(uids: number[], flags: string[]): Promise<void>;
  /** Move messages to another folder. */
  moveMessages(uids: number[], destinationPath: string): Promise<void>;
  /** Set \Deleted; expunge controls whether the server also removes them permanently. */
  deleteMessages(uids: number[], expunge: boolean): Promise<void>;
  /** Start IMAP IDLE; returns an unsubscribe function. */
  idle(onMail: (event: NewMailEvent) => void, onError?: (err: unknown) => void): () => void;
  /** Close the mailbox. */
  close(): Promise<void>;
};

export type BridgeConfig = {
  imap: { host: string; port: number; security?: 'tls' | 'starttls' | 'plain' };
  smtp?: { host: string; port: number; security?: 'tls' | 'starttls' | 'plain' };
  auth: { type: 'password'; user: string; password: string };
};

export interface MailBridge {
  connect(config: BridgeConfig): Promise<BridgeAccount>;
}

/**
 * Adapter over `react-native-mail-engine`. The native module is imported lazily
 * so importing this file never crashes in Expo Go.
 */
export function createMailBridge(): MailBridge {
  return {
    async connect(config: BridgeConfig): Promise<BridgeAccount> {
      // Lazy require: throws only when a real connection is attempted.
      let MailEngine: typeof import('react-native-mail-engine').MailEngine;
      try {
        ({ MailEngine } = require('react-native-mail-engine') as typeof import('react-native-mail-engine'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          'IMAP is not available in this build. Use a development or release APK (`npx expo run:android`), not Expo Go. ' +
            msg,
        );
      }
      if (!MailEngine?.connect) {
        throw new Error(
          'IMAP native module is not linked. Rebuild the app with `npx expo run:android`.',
        );
      }
      const connectConfig: ConnectConfig = {
        imap: config.imap,
        smtp: config.smtp,
        auth: config.auth,
      };
      const account: MailAccount = await MailEngine.connect(connectConfig);
      const wrapMailbox = (mailbox: Mailbox): BridgeMailbox => ({
        async fetchHeaders(options) {
          return mailbox.fetchHeaders({
            limit: options.limit,
            since: options.since,
            sinceUid: options.sinceUid,
            uidRange: options.uidRange,
            fetchPreview: true,
          });
        },
        async fetchMessage(uid) {
          const msg = await mailbox.fetchMessage(uid, { includeAttachments: false });
          return { header: msg.header, textBody: msg.textBody, htmlBody: msg.htmlBody };
        },
        async search(criteria) {
          return mailbox.search(criteria);
        },
        async markSeen(uids, seen = true) {
          await mailbox.markSeen(uids, seen);
        },
        async addFlags(uids, flags) {
          await mailbox.addFlags(uids, flags);
        },
        async removeFlags(uids, flags) {
          await mailbox.removeFlags(uids, flags);
        },
        async moveMessages(uids, destinationPath) {
          await mailbox.moveMessages(uids, destinationPath);
        },
        async deleteMessages(uids, expunge) {
          await mailbox.deleteMessages(uids, expunge);
        },
        idle(onMail, onError) {
          return mailbox.idle(onMail, (err) => onError?.(err));
        },
        async close() {
          await mailbox.close();
        },
      });
      return {
        async listMailboxes() {
          const mailboxes = await account.listMailboxes();
          return mailboxes.map((mailbox) => ({
            path: mailbox.path,
            name: mailbox.name,
            delimiter: mailbox.delimiter,
            flags: mailbox.flags,
            selectable: mailbox.selectable,
            exists: mailbox.exists,
            unseen: mailbox.unseen,
          }));
        },
        async openInbox() {
          return wrapMailbox(await account.openMailbox('INBOX'));
        },
        async openMailbox(path, readOnly = false) {
          return wrapMailbox(await account.openMailbox(path, readOnly));
        },
        async send(message) {
          await account.send({
            to: message.to,
            cc: message.cc,
            subject: message.subject,
            text: message.text,
            html: message.html,
          });
        },
        async disconnect() {
          await account.disconnect();
        },
      };
    },
  };
}
