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

export type BridgeAccount = {
  /** Open the inbox and return a handle. */
  openInbox(): Promise<BridgeMailbox>;
  /** Send a message over SMTP. */
  send(message: {
    to: string | string[];
    subject: string;
    text?: string;
    html?: string;
  }): Promise<void>;
  /** Close the connection and free native resources. */
  disconnect(): Promise<void>;
};

export type BridgeMailbox = {
  /** Fetch newest-first envelopes, optionally since a date. */
  fetchHeaders(options: { limit?: number; since?: string }): Promise<MessageHeader[]>;
  /** Fetch a full parsed message by UID. */
  fetchMessage(uid: number): Promise<{ header: MessageHeader; textBody?: string; htmlBody?: string }>;
  /** Mark messages seen. */
  markSeen(uids: number[]): Promise<void>;
  /** Add flags (e.g. \Flagged for star). */
  addFlags(uids: number[], flags: string[]): Promise<void>;
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
      const { MailEngine } = require('react-native-mail-engine') as typeof import('react-native-mail-engine');
      const connectConfig: ConnectConfig = {
        imap: config.imap,
        smtp: config.smtp,
        auth: config.auth,
      };
      const account: MailAccount = await MailEngine.connect(connectConfig);
      return {
        async openInbox() {
          const mailbox: Mailbox = await account.openMailbox('INBOX');
          return {
            async fetchHeaders(options) {
              return mailbox.fetchHeaders({
                limit: options.limit,
                since: options.since,
                fetchPreview: true,
              });
            },
            async fetchMessage(uid) {
              const msg = await mailbox.fetchMessage(uid, { includeAttachments: false });
              return { header: msg.header, textBody: msg.textBody, htmlBody: msg.htmlBody };
            },
            async markSeen(uids) {
              await mailbox.markSeen(uids, true);
            },
            async addFlags(uids, flags) {
              await mailbox.addFlags(uids, flags);
            },
            idle(onMail, onError) {
              return mailbox.idle(onMail, (err) => onError?.(err));
            },
            async close() {
              await mailbox.close();
            },
          };
        },
        async send(message) {
          await account.send({
            to: message.to,
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
