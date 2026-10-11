/**
 * Prefs — small non-secret app flags.
 *
 * The one flag that matters today is "has the user finished onboarding". Without
 * it the app shows the welcome wizard on every single launch and throws away
 * whatever the user typed.
 *
 * Storage note: these flags are not secret, but they are stored in
 * expo-secure-store rather than AsyncStorage. AsyncStorage is not a dependency
 * of this app, and adding it means another native module and another full
 * rebuild for the sake of one boolean. SecureStore is already linked, already
 * wrapped by AccountStore/ProviderStore, and a boolean is far under its value
 * size limit — so the cheaper option is also the safer one.
 */
import * as SecureStore from 'expo-secure-store';

const ONBOARDED_KEY = 'threadmymail.onboarded.v1';

/** True once the user has reached the end of onboarding (or tapped Skip). */
export async function isOnboarded(): Promise<boolean> {
  try {
    const raw = await SecureStore.getItemAsync(ONBOARDED_KEY);
    return raw === '1';
  } catch {
    // Treat an unreadable flag as "not onboarded" — re-showing onboarding is
    // recoverable, skipping past it forever is not.
    return false;
  }
}

/** Record that onboarding is done, so it is not shown again. */
export async function setOnboarded(value = true): Promise<void> {
  try {
    if (value) {
      await SecureStore.setItemAsync(ONBOARDED_KEY, '1');
    } else {
      await SecureStore.deleteItemAsync(ONBOARDED_KEY);
    }
  } catch {
    // Non-fatal: worst case onboarding shows again.
  }
}
