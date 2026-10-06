/**
 * AccountStore — email account credentials + provider presets.
 *
 * Credentials live in the OS keychain (expo-secure-store), never in SQLite or
 * AsyncStorage. The sync engine reads them through this module.
 */
import * as SecureStore from 'expo-secure-store';

const ACCOUNT_KEY = 'threadmymail.account.v1';

export type EmailProvider = {
  id: string;
  label: string;
  imapHost: string;
  imapPort: number;
  imapSecurity: 'tls' | 'starttls' | 'plain';
  smtpHost: string;
  smtpPort: number;
  smtpSecurity: 'tls' | 'starttls' | 'plain';
};

export const EMAIL_PROVIDERS: EmailProvider[] = [
  {
    id: 'gmail',
    label: 'Gmail',
    imapHost: 'imap.gmail.com',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.gmail.com',
    smtpPort: 465,
    smtpSecurity: 'tls',
  },
  {
    id: 'outlook',
    label: 'Outlook / Microsoft 365',
    imapHost: 'outlook.office365.com',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.office365.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
  },
  {
    id: 'yahoo',
    label: 'Yahoo',
    imapHost: 'imap.mail.yahoo.com',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.mail.yahoo.com',
    smtpPort: 465,
    smtpSecurity: 'tls',
  },
  {
    id: 'icloud',
    label: 'iCloud',
    imapHost: 'imap.mail.me.com',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: 'smtp.mail.me.com',
    smtpPort: 587,
    smtpSecurity: 'starttls',
  },
  {
    id: 'custom',
    label: 'Custom / self-hosted',
    imapHost: '',
    imapPort: 993,
    imapSecurity: 'tls',
    smtpHost: '',
    smtpPort: 587,
    smtpSecurity: 'starttls',
  },
];

export type AccountConfig = {
  providerId: string;
  email: string;
  /** App password or account password. */
  password: string;
  /** Resolved IMAP endpoint (custom overrides). */
  imap: { host: string; port: number; security: 'tls' | 'starttls' | 'plain' };
  /** Resolved SMTP endpoint (custom overrides). */
  smtp: { host: string; port: number; security: 'tls' | 'starttls' | 'plain' };
};

/** Save the account. Returns the resolved config. */
export async function saveAccount(input: {
  providerId: string;
  email: string;
  password: string;
  customImapHost?: string;
  customImapPort?: number;
  customSmtpHost?: string;
  customSmtpPort?: number;
}): Promise<AccountConfig> {
  const provider = EMAIL_PROVIDERS.find((p) => p.id === input.providerId) ?? EMAIL_PROVIDERS[0];
  const isCustom = input.providerId === 'custom';
  const config: AccountConfig = {
    providerId: input.providerId,
    email: input.email.trim(),
    password: input.password,
    imap: {
      host: isCustom && input.customImapHost ? input.customImapHost.trim() : provider.imapHost,
      port: isCustom && input.customImapPort ? input.customImapPort : provider.imapPort,
      security: provider.imapSecurity,
    },
    smtp: {
      host: isCustom && input.customSmtpHost ? input.customSmtpHost.trim() : provider.smtpHost,
      port: isCustom && input.customSmtpPort ? input.customSmtpPort : provider.smtpPort,
      security: provider.smtpSecurity,
    },
  };
  await SecureStore.setItemAsync(ACCOUNT_KEY, JSON.stringify(config));
  return config;
}

/** Load the saved account, or null if none. */
export async function loadAccount(): Promise<AccountConfig | null> {
  const raw = await SecureStore.getItemAsync(ACCOUNT_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AccountConfig;
  } catch {
    return null;
  }
}

/** Remove the saved account. */
export async function clearAccount(): Promise<void> {
  await SecureStore.deleteItemAsync(ACCOUNT_KEY);
}
