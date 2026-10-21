/**
 * ThemeProvider — Dark / Light / Follow system.
 *
 * The provider owns the user's preference, resolves it against the OS scheme,
 * and swaps the active palette used by the live `colors` proxy before children
 * render. Preference is small and not secret; like onboarding, it lives in
 * SecureStore to avoid adding AsyncStorage as another native dependency.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Appearance, useColorScheme } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import * as SystemUI from 'expo-system-ui';
import {
  darkPalette,
  lightPalette,
  setActivePalette,
  type ColorPalette,
} from './theme';

const THEME_KEY = 'threadmymail.theme.v1';

export type ThemeMode = 'dark' | 'light' | 'system';
export type ResolvedTheme = 'dark' | 'light';

type ThemeContextValue = {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  colors: ColorPalette;
  setMode: (mode: ThemeMode) => void;
};

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'system',
  resolved: 'dark',
  colors: darkPalette,
  setMode: () => {},
});

function normalizeMode(raw: string | null): ThemeMode {
  return raw === 'light' || raw === 'dark' || raw === 'system' ? raw : 'system';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>('system');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const stored = await SecureStore.getItemAsync(THEME_KEY);
        if (!cancelled) setModeState(normalizeMode(stored));
      } catch {
        // Keep follow-system when storage is unavailable.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const resolved: ResolvedTheme =
    mode === 'system' ? (system === 'light' ? 'light' : 'dark') : mode;
  const palette = resolved === 'light' ? lightPalette : darkPalette;

  // Must happen before children render so their token reads see this palette.
  setActivePalette(palette);

  useEffect(() => {
    // Match native chrome (keyboard, dialogs) to the in-app choice. `null`
    // returns control to the OS so follow-system keeps updating live.
    Appearance.setColorScheme(mode === 'system' ? 'unspecified' : mode);
  }, [mode]);

  const setMode = useCallback((next: ThemeMode) => {
    setModeState(next);
    void SecureStore.setItemAsync(THEME_KEY, next).catch(() => {
      // Non-fatal: the choice still applies for this session.
    });
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ mode, resolved, colors: palette, setMode }),
    [mode, resolved, palette, setMode],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  return useContext(ThemeContext);
}
