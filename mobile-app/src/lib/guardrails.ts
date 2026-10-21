/**
 * Guardrails — the single, persisted source of truth for the kill switch and
 * shadow mode.
 *
 * Before this store existed each screen kept its own local boolean: Today and
 * Mail toggled a `killEngaged` that nothing read, and Settings held a third
 * copy that reset on every visit. Now all three read/write this module, the
 * values survive a restart, and the agent engine has one documented gate to
 * check before it acts.
 *
 * Storage: SecureStore follows the same trade-off as `prefs.ts` — these are not
 * secrets, but SecureStore is already linked and saves adding AsyncStorage for
 * two booleans.
 *
 * Agent hook point: call `mayAct()` immediately before any autonomous action
 * (triage, drafting, sending, moving mail). It returns false when the kill
 * switch is engaged, while shadow mode keeps actions observation-only, and
 * before the persisted values have loaded.
 */
import { useEffect, useState } from 'react';
import * as SecureStore from 'expo-secure-store';

const KILL_SWITCH_KEY = 'threadmymail.guardrails.killSwitch.v1';
const SHADOW_MODE_KEY = 'threadmymail.guardrails.shadowMode.v1';

export type GuardrailsState = {
  /** Stop all autonomous actions. Manual mail use stays available. */
  killSwitch: boolean;
  /** Log what would happen, but never send or change anything. */
  shadowMode: boolean;
  /** False until the persisted values have been read at least once. */
  loaded: boolean;
};

let state: GuardrailsState = { killSwitch: false, shadowMode: false, loaded: false };
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

/** Read the persisted values. Safe to call repeatedly; the read happens once. */
export function loadGuardrails(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const [kill, shadow] = await Promise.all([
        SecureStore.getItemAsync(KILL_SWITCH_KEY),
        SecureStore.getItemAsync(SHADOW_MODE_KEY),
      ]);
      state = { ...state, killSwitch: kill === '1', shadowMode: shadow === '1', loaded: true };
    } catch {
      // Fail closed: `loaded` stays false so `mayAct()` refuses to act, and the
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

export function isKillSwitchEngaged(): boolean {
  return state.killSwitch;
}

export function isShadowModeEnabled(): boolean {
  return state.shadowMode;
}

/**
 * The gate every autonomous action must pass.
 *
 * Kill switch → never act. Shadow mode → observation only, no outward or
 * mutating action. Before load → fail closed, because acting on a stale default
 * could ignore a kill switch the user engaged in a previous session.
 */
export function mayAct(): boolean {
  return state.loaded && !state.killSwitch && !state.shadowMode;
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
