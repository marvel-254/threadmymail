/**
 * Per-user agent configuration: model slots, autonomy policy, budgets.
 *
 * All of this originates in the `users` row as JSONB, hand-editable and
 * user-owned, so every read here is treated as hostile input. Secrets never
 * live in these columns: BYOK keys are encrypted in `plugin_credentials` and
 * are not part of NormalizedSettings (docs/ARCHITECTURE.md §12).
 */

import { Db } from '../db/client';
import { normalizeSettings } from './persona';

export type ModelSlot = 'primary' | 'background' | 'inherit';

export type NewContactPolicy = 'ask' | 'allow' | 'block';

export interface ModelConfig {
  /** Provider id from agent/providers.ts. Unknown ids fall back to openrouter. */
  provider: string;
  /** Empty when unset; the model router resolves the real id from env. */
  model: string;
  temperature: number;
  max_tokens: number;
  /**
   * Override for the provider's base URL. Only meaningful for `custom` and
   * local providers; validated by `validateBaseUrl` on the way in.
   */
  baseUrl: string;
}

export interface QuietHours {
  /** 'HH:MM' local to userTimezone. */
  start: string;
  end: string;
}

export interface NormalizedPrefs {
  new_contact_policy: NewContactPolicy;
  new_contact_allowlist: string[];
  quiet_hours: QuietHours | null;
  notification_threshold: number;
  timezone: string | null;
  daily_token_limit: number;
  daily_cost_usd_limit: number;
  max_outbound_per_day: number;
}

export interface NormalizedSettings {
  primary: ModelConfig;
  background: ModelConfig;
  max_steps: number;
  prefs: NormalizedPrefs;
}

/** Hard ceiling on tool-loop iterations for a single run. */
export const MAX_TOOL_STEPS = 12;

/** parent → child → grandchild. A subagent at this depth cannot delegate. */
export const MAX_SUBAGENT_DEPTH = 2;

/**
 * The user row is created lazily on first Google OAuth (Phase 2), so a missing
 * row is a normal state, not an error: fall back to shipped defaults.
 */
export async function loadAgentConfig(db: Db, userId: string): Promise<NormalizedSettings> {
  const row = await db.one<{ ai_config: unknown; prefs: unknown }>(
    'SELECT ai_config, prefs FROM users WHERE id = $1',
    [userId],
  );
  if (row === null) return normalizeSettings({});
  return normalizeSettings({ ai_config: row.ai_config, prefs: row.prefs });
}

export interface Recipients {
  /** Outward-facing destinations: email To/Cc/Bcc, external attendees. */
  recipientEmails: string[];
  /** Addresses with prior thread history or a `contacts` row. */
  knownContacts: string[];
}

export interface GuardDecision {
  blocked: boolean;
  reason?: string;
}

/**
 * `new_contact_policy` guardrail (docs/AI-SKILLS.md §6.2). Structural, not
 * interactive: 'ask' means the agent must escalate, which it reports as
 * blocked:true — it does not mean "wait for a human to click approve".
 *
 * Allowlist entries are either an exact address or a `@domain.com` suffix
 * matching the whole domain.
 */
export function isOutwardActionBlocked(
  prefs: NormalizedPrefs | null | undefined,
  { recipientEmails, knownContacts }: Recipients,
): GuardDecision {
  const policy: NewContactPolicy = prefs?.new_contact_policy ?? 'ask';
  const allowlist = prefs?.new_contact_allowlist ?? [];

  const recipients = normalizeAddresses(recipientEmails);
  // Nothing outward-facing, so the policy has nothing to gate.
  if (recipients.length === 0) return { blocked: false };

  const known = new Set(normalizeAddresses(knownContacts));
  const unknown = recipients.filter((addr) => !isPermitted(addr, known, allowlist));
  if (unknown.length === 0) return { blocked: false };

  const reason = `unrecognized recipient: ${unknown.join(', ')}`;
  if (policy === 'block') return { blocked: true, reason: `blocked by new_contact_policy=block (${reason})` };
  if (policy === 'ask') return { blocked: true, reason: `escalate per new_contact_policy=ask (${reason})` };
  return { blocked: false };
}

function isPermitted(addr: string, known: Set<string>, allowlist: string[]): boolean {
  if (known.has(addr)) return true;
  const at = addr.lastIndexOf('@');
  const domain = at > 0 ? addr.slice(at) : '';
  return allowlist.some((entry) => {
    if (entry.startsWith('@')) return domain !== '' && entry === domain;
    return entry === addr;
  });
}

/** Lowercased `local@domain`; anything without a dot in the domain is dropped. */
function normalizeAddresses(emails: string[] | null | undefined): string[] {
  if (!Array.isArray(emails)) return [];
  const out: string[] = [];
  for (const email of emails) {
    if (typeof email !== 'string') continue;
    const addr = email.trim().toLowerCase().replace(/^.*<|>$/g, '').trim();
    if (addr === '' || !/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(addr)) continue;
    if (!out.includes(addr)) out.push(addr);
  }
  return out;
}

export interface BudgetUsage {
  tokensUsed: number;
  costUsd: number;
  outboundCount: number;
}

export interface BudgetLimits {
  dailyTokens: number;
  dailyCostUsd: number;
  maxOutbound: number;
}

/**
 * Daily cap check (docs/AI-SKILLS.md §6.1, §10). Reads budget_state
 * defensively — a malformed or absent row reads as zero usage, and the
 * caller's limits decide.
 */
export function checkBudget(budgetState: unknown, usage: BudgetUsage, limits: BudgetLimits): GuardDecision {
  const state = readBudgetState(budgetState, today());

  const tokens = finiteOr(usage.tokensUsed, 0) + state.tokensUsed;
  const cost = finiteOr(usage.costUsd, 0) + state.costUsd;
  const outbound = finiteOr(usage.outboundCount, 0) + state.outboundCount;

  if (tokens > limits.dailyTokens) {
    return { blocked: true, reason: `daily token budget exceeded (${Math.round(tokens)} > ${limits.dailyTokens})` };
  }
  if (cost > limits.dailyCostUsd) {
    return { blocked: true, reason: `daily cost budget exceeded ($${cost.toFixed(2)} > $${limits.dailyCostUsd.toFixed(2)})` };
  }
  if (outbound > limits.maxOutbound) {
    return { blocked: true, reason: `outbound message cap exceeded (${outbound} > ${limits.maxOutbound})` };
  }
  return { blocked: false };
}

interface BudgetState {
  tokensUsed: number;
  costUsd: number;
  outboundCount: number;
  day: string | null;
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * `budget_state` carries a `day`; a row from a previous day is spent, not
 * current. The worker resets it, but a stale row must not block a fresh
 * morning, so an old day reads as zero.
 */
function readBudgetState(raw: unknown, todayDay: string): BudgetState {
  const source = asRecord(raw);
  if (source === null) return { tokensUsed: 0, costUsd: 0, outboundCount: 0, day: null };
  const day = typeof source.day === 'string' ? source.day : null;
  if (day !== null && day !== todayDay) return { tokensUsed: 0, costUsd: 0, outboundCount: 0, day };
  return {
    tokensUsed: finiteOr(source.tokens_used, 0),
    costUsd: finiteOr(source.cost_usd, 0),
    outboundCount: finiteOr(source.outbound_count, 0),
    day: typeof source.day === 'string' ? source.day : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    try {
      return asRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return null;
}

function finiteOr(value: unknown, fallback: number): number {
  const n = typeof value === 'string' ? Number(value) : value;
  return typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : fallback;
}
