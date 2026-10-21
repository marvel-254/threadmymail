/**
 * Guardrails — the single, persisted source of truth for autonomy controls.
 *
 * Before this store existed each screen kept its own local boolean: Today and
 * Mail toggled a `killEngaged` that nothing read, and Settings held a third
 * copy that reset on every visit. Now every screen reads/writes this module, the
 * values survive a restart, and the agent engine has one documented gate to
 * check before it acts.
 *
 * Storage: SecureStore follows the same trade-off as `prefs.ts` — these are not
 * secrets, but SecureStore is already linked and saves adding AsyncStorage.
 *
 * Agent hook point: call `consumeAutonomousAction()` immediately before any
 * autonomous action (triage, drafting, sending, moving mail) and
 * `consumeAiCall()` before spending an autonomous model call. Both return a
 * `GuardrailDecision` explaining why they refused, so the engine can log the
 * skip instead of silently doing nothing. Manual user actions use
 * `checkGuardrails('manual')`, which is never blocked by the kill switch.
 */
import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

const KILL_SWITCH_KEY = 'threadmymail.guardrails.killSwitch.v1';
const SHADOW_MODE_KEY = 'threadmymail.guardrails.shadowMode.v1';
const CONFIG_KEY = 'threadmymail.guardrails.config.v1';

export type GuardrailAction = 'outward' | 'ai_call' | 'notification' | 'scheduled' | 'manual';

export type GuardrailDecision = {
  allowed: boolean;
  /** True when shadow mode would have logged this action but not executed it. */
  shadowed: boolean;
  reason: string | null;
};

export type GuardrailsState = {
  /** Stop all autonomous actions. Manual mail use stays available. */
  killSwitch: boolean;
  /** Log what would happen, but never send or change anything. */
  shadowMode: boolean;
  /** False until the persisted values have been read at least once. */
  loaded: boolean;
  /** Maximum autonomous actions per local day. */
  dailyActionLimit: number;
  /** Maximum autonomous model calls per local day. */
  dailyAiCallLimit: number;
  actionsUsed: number;
  aiCallsUsed: number;
  /** Local YYYY-MM-DD the counters belong to. */
  budgetDay: string;
  quietHoursEnabled: boolean;
  /** Minutes since local midnight. */
  quietStart: number;
  quietEnd: number;
};

type PersistedConfig = Pick<
  GuardrailsState,
  | 'dailyActionLimit'
  | 'dailyAiCallLimit'
  | 'actionsUsed'
  | 'aiCallsUsed'
  | 'budgetDay'
  | 'quietHoursEnabled'
  | 'quietStart'
  | 'quietEnd'
>;

export const DEFAULT_DAILY_ACTION_LIMIT = 50;
export const DEFAULT_DAILY_AI_CALL_LIMIT = 100;
export const DEFAULT_QUIET_START = 22 * 60;
export const DEFAULT_QUIET_END = 7 * 60;

export function localDayKey(now = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/** "HH:MM" for a minutes-since-midnight value. */
export function formatMinutes(minutes: number): string {
  const safe = Math.max(0, Math.min(1439, Math.round(minutes)));
  return `${String(Math.floor(safe / 60)).padStart(2, '0')}:${String(safe % 60).padStart(2, '0')}`;
}

/** Parse "HH:MM" (or "H:MM") into minutes, or null when invalid. */
export function parseTimeLabel(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function formatQuietHours(start: number, end: number): string {
  return `${formatMinutes(start)}–${formatMinutes(end)}`;
}

let state: GuardrailsState = {
  killSwitch: false,
  shadowMode: false,
  loaded: false,
  dailyActionLimit: DEFAULT_DAILY_ACTION_LIMIT,
  dailyAiCallLimit: DEFAULT_DAILY_AI_CALL_LIMIT,
  actionsUsed: 0,
  aiCallsUsed: 0,
  budgetDay: localDayKey(),
  quietHoursEnabled: false,
  quietStart: DEFAULT_QUIET_START,
  quietEnd: DEFAULT_QUIET_END,
};

const listeners = new Set<(next: GuardrailsState) => void>();
let loadPromise: Promise<void> | null = null;

function emit() {
  state = { ...state };
  listeners.forEach((listener) => listener(state));
}

export function getGuardrails(): GuardrailsState {
  return state;
}

export function subscribeGuardrails(listener: (next: GuardrailsState) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

function normalizeConfig(raw: unknown): PersistedConfig {
  const record = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    dailyActionLimit: clampInt(record.dailyActionLimit, 1, 1000, DEFAULT_DAILY_ACTION_LIMIT),
    dailyAiCallLimit: clampInt(record.dailyAiCallLimit, 1, 1000, DEFAULT_DAILY_AI_CALL_LIMIT),
    actionsUsed: clampInt(record.actionsUsed, 0, 1_000_000, 0),
    aiCallsUsed: clampInt(record.aiCallsUsed, 0, 1_000_000, 0),
    budgetDay: typeof record.budgetDay === 'string' ? record.budgetDay : localDayKey(),
    quietHoursEnabled: record.quietHoursEnabled === true,
    quietStart: clampInt(record.quietStart, 0, 1439, DEFAULT_QUIET_START),
    quietEnd: clampInt(record.quietEnd, 0, 1439, DEFAULT_QUIET_END),
  };
}

function configSnapshot(): PersistedConfig {
  return {
    dailyActionLimit: state.dailyActionLimit,
    dailyAiCallLimit: state.dailyAiCallLimit,
    actionsUsed: state.actionsUsed,
    aiCallsUsed: state.aiCallsUsed,
    budgetDay: state.budgetDay,
    quietHoursEnabled: state.quietHoursEnabled,
    quietStart: state.quietStart,
    quietEnd: state.quietEnd,
  };
}

async function persistConfig(): Promise<void> {
  try {
    await SecureStore.setItemAsync(CONFIG_KEY, JSON.stringify(configSnapshot()));
  } catch {
    // Non-fatal: the in-memory state still gates this session.
  }
}

/** Reset counters when the local day rolls over. Returns true if it reset. */
function resetBudgetIfNewDay(now = new Date()): boolean {
  const today = localDayKey(now);
  if (state.budgetDay === today) return false;
  state = { ...state, budgetDay: today, actionsUsed: 0, aiCallsUsed: 0 };
  return true;
}

/** Read the persisted values. Safe to call repeatedly; the read happens once. */
export function loadGuardrails(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const [kill, shadow, configRaw] = await Promise.all([
        SecureStore.getItemAsync(KILL_SWITCH_KEY),
        SecureStore.getItemAsync(SHADOW_MODE_KEY),
        SecureStore.getItemAsync(CONFIG_KEY),
      ]);
      let config: PersistedConfig;
      try {
        config = normalizeConfig(configRaw ? JSON.parse(configRaw) : null);
      } catch {
        config = normalizeConfig(null);
      }
      state = {
        ...state,
        ...config,
        killSwitch: kill === '1',
        shadowMode: shadow === '1',
        loaded: true,
      };
      if (resetBudgetIfNewDay()) void persistConfig();
    } catch {
      // Fail closed: `loaded` stays false so the gates refuse to act, and the
      // promise is cleared so the next mount retries the read.
      loadPromise = null;
      state = { ...state, loaded: false };
    }
    emit();
  })();
  return loadPromise;
}

export async function setKillSwitch(value: boolean): Promise<void> {
  state = { ...state, killSwitch: value };
  emit();
  try {
    if (value) {
      await SecureStore.setItemAsync(KILL_SWITCH_KEY, '1');
    } else {
      await SecureStore.deleteItemAsync(KILL_SWITCH_KEY);
    }
  } catch {
    // Non-fatal: the in-memory state still gates this session.
  }
}

export async function setShadowMode(value: boolean): Promise<void> {
  state = { ...state, shadowMode: value };
  emit();
  try {
    if (value) {
      await SecureStore.setItemAsync(SHADOW_MODE_KEY, '1');
    } else {
      await SecureStore.deleteItemAsync(SHADOW_MODE_KEY);
    }
  } catch {
    // Non-fatal: the in-memory state still gates this session.
  }
}

/** Update budget/quiet-hour settings and persist them. */
export async function setGuardrailConfig(
  patch: Partial<Pick<
    GuardrailsState,
    'dailyActionLimit' | 'dailyAiCallLimit' | 'quietHoursEnabled' | 'quietStart' | 'quietEnd'
  >>,
): Promise<void> {
  state = {
    ...state,
    ...patch,
    dailyActionLimit: clampInt(
      patch.dailyActionLimit ?? state.dailyActionLimit, 1, 1000, state.dailyActionLimit),
    dailyAiCallLimit: clampInt(
      patch.dailyAiCallLimit ?? state.dailyAiCallLimit, 1, 1000, state.dailyAiCallLimit),
    quietStart: clampInt(patch.quietStart ?? state.quietStart, 0, 1439, state.quietStart),
    quietEnd: clampInt(patch.quietEnd ?? state.quietEnd, 0, 1439, state.quietEnd),
  };
  emit();
  await persistConfig();
}

export function isKillSwitchEngaged(): boolean {
  return state.killSwitch;
}

export function isShadowModeEnabled(): boolean {
  return state.shadowMode;
}

/** True when the current local time falls inside the configured quiet window. */
export function isQuietHours(now = new Date()): boolean {
  if (!state.quietHoursEnabled) return false;
  if (state.quietStart === state.quietEnd) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (state.quietStart < state.quietEnd) {
    return minutes >= state.quietStart && minutes < state.quietEnd;
  }
  // Window wraps midnight, e.g. 22:00–07:00.
  return minutes >= state.quietStart || minutes < state.quietEnd;
}

/**
 * The one gate every agent action must pass.
 *
 * - outward: kill switch, shadow mode, and the daily action budget apply.
 * - ai_call: kill switch and the AI-call budget apply; shadow mode does not,
 *   because shadow mode still needs the model to compute what it would do.
 * - notification: kill switch, shadow mode, and quiet hours apply.
 * - scheduled: kill switch, quiet hours, and budget apply; shadow mode does not
 *   block the run itself, only its outward effects.
 * - manual: never blocked by the kill switch or quiet hours; shadow mode still
 *   prevents outward effects and is reported via `shadowed`.
 */
export function checkGuardrails(action: GuardrailAction = 'outward'): GuardrailDecision {
  if (!state.loaded) {
    return { allowed: false, shadowed: false, reason: 'Guardrails have not loaded yet.' };
  }
  if (action === 'manual') {
    return {
      allowed: !state.shadowMode,
      shadowed: state.shadowMode,
      reason: state.shadowMode ? 'Shadow mode — action logged, not executed.' : null,
    };
  }
  if (state.killSwitch) {
    return { allowed: false, shadowed: false, reason: 'Kill switch is on.' };
  }

  const quiet = isQuietHours();
  if (action === 'notification') {
    if (state.shadowMode) {
      return { allowed: false, shadowed: true, reason: 'Shadow mode — notification logged, not sent.' };
    }
    if (quiet) {
      return { allowed: false, shadowed: false, reason: 'Quiet hours are active.' };
    }
    return { allowed: true, shadowed: false, reason: null };
  }

  if (action === 'scheduled') {
    if (quiet) {
      return { allowed: false, shadowed: false, reason: 'Quiet hours are active.' };
    }
    if (state.actionsUsed >= state.dailyActionLimit) {
      return { allowed: false, shadowed: false, reason: 'Daily action budget is exhausted.' };
    }
    return { allowed: true, shadowed: false, reason: null };
  }

  if (action === 'ai_call') {
    if (state.aiCallsUsed >= state.dailyAiCallLimit) {
      return { allowed: false, shadowed: false, reason: 'Daily AI-call budget is exhausted.' };
    }
    return { allowed: true, shadowed: false, reason: null };
  }

  // outward
  if (state.shadowMode) {
    return { allowed: false, shadowed: true, reason: 'Shadow mode — action logged, not executed.' };
  }
  if (state.actionsUsed >= state.dailyActionLimit) {
    return { allowed: false, shadowed: false, reason: 'Daily action budget is exhausted.' };
  }
  return { allowed: true, shadowed: false, reason: null };
}

/** Boolean convenience used by UI and engines that only need yes/no. */
export function mayAct(action: GuardrailAction = 'outward'): boolean {
  return checkGuardrails(action).allowed;
}

/**
 * Reserve one autonomous action for today.
 *
 * Scheduled work obeys quiet hours and the budget; manual triggers skip the
 * kill switch and budget but are still shadowed. Shadow-mode actions are
 * counted because the work was still performed (and logged).
 */
export async function consumeAutonomousAction(
  source: 'scheduled' | 'manual' = 'scheduled',
): Promise<GuardrailDecision> {
  if (resetBudgetIfNewDay()) await persistConfig();

  if (source === 'manual') {
    const decision = checkGuardrails('manual');
    return decision;
  }

  const gate = checkGuardrails('scheduled');
  if (!gate.allowed) return gate;

  const outward = checkGuardrails('outward');
  if (!outward.allowed && !outward.shadowed) return outward;

  state = { ...state, actionsUsed: state.actionsUsed + 1 };
  emit();
  await persistConfig();
  return outward;
}

/** Reserve one autonomous model call for today. Shadow mode still allows this. */
export async function consumeAiCall(): Promise<GuardrailDecision> {
  if (resetBudgetIfNewDay()) await persistConfig();

  const gate = checkGuardrails('ai_call');
  if (!gate.allowed) return gate;

  state = { ...state, aiCallsUsed: state.aiCallsUsed + 1 };
  emit();
  await persistConfig();
  return { allowed: true, shadowed: state.shadowMode, reason: null };
}

/** React binding for the store. Loads it on first mount. */
export function useGuardrails(): GuardrailsState {
  const [snapshot, setSnapshot] = useState<GuardrailsState>(getGuardrails);

  useEffect(() => {
    setSnapshot(getGuardrails());
    const unsubscribe = subscribeGuardrails(setSnapshot);
    void loadGuardrails();
    return unsubscribe;
  }, []);

  return snapshot;
}
