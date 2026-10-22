/**
 * AccountStore — email account credentials + provider presets.
 *
 * Credentials live in the OS keychain (expo-secure-store), never in SQLite or
 * AsyncStorage. The sync engine reads them through this module.
 */
import * as SecureStore from 'expo-secure-store';

const ACCOUNTS_KEY = 'threadmymail.accounts.v1';
const LEGACY_ACCOUNT_KEY = 'threadmymail.account.v1';
const LEGACY_ACCOUNT_ID = 'legacy';

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
  /** Stable local id. Cached rows are namespaced with this. */
  id: string;
  /** Exactly one account is the default for new compose/search. */
  primary: boolean;
  providerId: string;
  email: string;
  /** App password or account password. */
  password: string;
  /** Resolved IMAP endpoint (custom overrides). */
  imap: { host: string; port: number; security: 'tls' | 'starttls' | 'plain' };
  /** Resolved SMTP endpoint (custom overrides). */
  smtp: { host: string; port: number; security: 'tls' | 'starttls' | 'plain' };
};

function newAccountId(): string {
  return `acct_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function withIdentity(config: Omit<AccountConfig, 'id' | 'primary'>, id?: string): AccountConfig {
  return { ...config, id: id ?? newAccountId(), primary: false };
}

function normalizeAccounts(raw: unknown): AccountConfig[] | null {
  if (!Array.isArray(raw)) return null;
  const accounts = raw.filter((item): item is AccountConfig => {
    if (!item || typeof item !== 'object') return false;
    const value = item as Partial<AccountConfig>;
    return typeof value.email === 'string' && typeof value.password === 'string';
  }).map((account, index) => ({
    ...account,
    id: account.id || (index === 0 ? LEGACY_ACCOUNT_ID : newAccountId()),
    primary: account.primary === true,
  }));
  if (accounts.length === 0) return [];
  if (!accounts.some((account) => account.primary)) accounts[0]!.primary = true;
  let seenPrimary = false;
  for (const account of accounts) {
    if (account.primary && seenPrimary) account.primary = false;
    if (account.primary) seenPrimary = true;
  }
  return accounts;
}

async function persist(accounts: AccountConfig[]): Promise<void> {
  if (accounts.length === 0) {
    await SecureStore.deleteItemAsync(ACCOUNTS_KEY);
    return;
  }
  await SecureStore.setItemAsync(ACCOUNTS_KEY, JSON.stringify(accounts));
}

/**
 * Load every connected account. Upgrades the original single-account key to a
 * one-element list and gives it the stable `legacy` id so its existing
 * unprefixed cached message ids keep working.
 */
export async function loadAccounts(): Promise<AccountConfig[]> {
  const raw = await SecureStore.getItemAsync(ACCOUNTS_KEY);
  if (raw) {
    try {
      const parsed = normalizeAccounts(JSON.parse(raw));
      if (parsed) return parsed;
    } catch {
      // Fall through to the legacy key.
    }
  }

  const legacyRaw = await SecureStore.getItemAsync(LEGACY_ACCOUNT_KEY);
  if (legacyRaw) {
    try {
      const legacy = JSON.parse(legacyRaw) as Omit<AccountConfig, 'id' | 'primary'>;
      const account: AccountConfig = { ...legacy, id: LEGACY_ACCOUNT_ID, primary: true };
      await persist([account]);
      await SecureStore.deleteItemAsync(LEGACY_ACCOUNT_KEY);
      return [account];
    } catch {
      // Ignore malformed legacy data.
    }
  }
  return [];
}

/** Save a new account, or update the matching one. Returns the resolved config. */
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
  const email = input.email.trim();
  const resolved: Omit<AccountConfig, 'id' | 'primary'> = {
    providerId: input.providerId,
    email,
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

  const accounts = await loadAccounts();
  const existing = accounts.findIndex(
    (account) => account.email.toLowerCase() === email.toLowerCase(),
  );
  if (existing >= 0) {
    const next = { ...accounts[existing]!, ...resolved };
    accounts[existing] = next;
    await persist(accounts);
    return next;
  }

  const account: AccountConfig = {
    ...withIdentity(resolved),
    primary: accounts.length === 0,
  };
  await persist([...accounts, account]);
  return account;
}

/** Load the primary account, or the first one when no primary is marked. */
export async function loadAccount(): Promise<AccountConfig | null> {
  const accounts = await loadAccounts();
  return accounts.find((account) => account.primary) ?? accounts[0] ?? null;
}

export async function setPrimaryAccount(id: string): Promise<AccountConfig[]> {
  const accounts = (await loadAccounts()).map((account) => ({
    ...account,
    primary: account.id === id,
  }));
  await persist(accounts);
  return accounts;
}

export async function removeAccount(id: string): Promise<AccountConfig[]> {
  const remaining = (await loadAccounts()).filter((account) => account.id !== id);
  if (remaining.length > 0 && !remaining.some((account) => account.primary)) {
    remaining[0]!.primary = true;
  }
  await persist(remaining);
  return remaining;
}

/** Remove every saved account. */
export async function clearAccount(): Promise<void> {
  await persist([]);
  await SecureStore.deleteItemAsync(LEGACY_ACCOUNT_KEY);
}
