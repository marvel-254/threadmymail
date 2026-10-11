/**
 * emailTest — the onboarding / Settings "Test connection" for an email account.
 *
 * What it proves and what it deliberately does not:
 *
 *  - It opens the IMAP connection, opens INBOX, and reads one header. That is
 *    the read half of the email bridge spike — if this works, history import
 *    and IDLE will work, because they run over the same connection.
 *  - It does NOT send a test message. A silent "test" email arriving in the
 *    user's Sent folder is a poor first impression, and sending cannot be
 *    verified without one. SMTP is verified at the moment the user actually
 *    composes and sends, with the error surfaced inline there.
 */
import { createMailBridge, type BridgeConfig } from './mailBridge';

export type EmailTestResult = { ok: boolean; detail: string };

export async function testImap(config: {
  imap: BridgeConfig['imap'];
  smtp?: BridgeConfig['smtp'];
  user: string;
  password: string;
}): Promise<EmailTestResult> {
  if (!config.user.trim() || !config.password) {
    return { ok: false, detail: 'Enter an email address and app password first.' };
  }

  const bridge = createMailBridge();
  let account: Awaited<ReturnType<BridgeConfig extends never ? never : typeof bridge.connect>> | null = null;
  try {
    account = await bridge.connect({
      imap: config.imap,
      smtp: config.smtp,
      auth: { type: 'password', user: config.user.trim(), password: config.password },
    });
    const mailbox = await account.openInbox();
    const headers = await mailbox.fetchHeaders({ limit: 1 });
    await mailbox.close();
    await account.disconnect();
    account = null;
    return {
      ok: true,
      detail:
        headers.length > 0
          ? `Connected · INBOX readable`
          : `Connected · INBOX is empty`,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // Map the most common failure to a human instruction instead of raw
    // JavaMail noise.
    const detail = /(auth|password|credential|535|AUTHENTICATION)/i.test(msg)
      ? `${msg} —` + ' double-check the app password (not your normal password).'
      : /(connect|timeout|unreachable|socket)/i.test(msg)
        ? `${msg} —` + ' the server did not accept the connection.'
        : msg;
    return { ok: false, detail };
  } finally {
    if (account) {
      try {
        await account.disconnect();
      } catch {
        // Ignore — we are already on the error path.
      }
    }
  }
}
