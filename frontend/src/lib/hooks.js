import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api.js';

/**
 * Run an async loader, tracking loading/error, and re-running when `deps` change.
 * `silent` keeps the previous data on screen while refreshing (avoids flicker).
 */
export function useAsync(fn, deps = [], { immediate = true } = {}) {
  const [state, setState] = useState({ data: null, loading: immediate, error: null });
  const mounted = useRef(true);
  const token = useRef(0);
  const stateRef = useRef(state);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async ({ silent = false } = {}) => {
      const mine = ++token.current;
      if (!silent) setState((s) => ({ ...s, loading: true, error: null }));
      try {
        const data = await fn();
        if (mounted.current && mine === token.current) {
          setState({ data, loading: false, error: null });
        }
        return data;
      } catch (err) {
        if (mounted.current && mine === token.current) {
          setState({
            // On a silent refresh, keep showing stale data rather than blanking
            // the pane; the error is surfaced alongside it.
            data: silent ? stateRef.current.data : null,
            loading: false,
            error: err instanceof ApiError ? err : new Error(String(err)),
          });
        }
        return null;
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    deps,
  );

  useEffect(() => {
    if (immediate) run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  return { ...state, reload: run, setData: (d) => setState((s) => ({ ...s, data: d })) };
}

/** Read the design tokens off :root / html.dark so child surfaces can inherit them. */
export function useThemeTokens(isDark) {
  return {
    surface: isDark ? 'rgba(255,255,255,0.06)' : 'rgba(255,255,255,0.72)',
    text: isDark ? '#F1F5F9' : '#1E293B',
    muted: isDark ? '#94A3B8' : '#475569',
    accent: isDark ? '#60A5FA' : '#2563EB',
    border: isDark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.35)',
    font: "'Open Sans', ui-sans-serif, system-ui, sans-serif",
  };
}

export function useDarkMode() {
  const [dark, setDark] = useState(() => {
    try {
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);
  return [dark, setDark];
}

/** Cmd/Ctrl+K style global shortcut. */
export function useHotkey(combo, handler) {
  useEffect(() => {
    function onKey(event) {
      const parts = combo.toLowerCase().split('+');
      const key = parts[parts.length - 1];
      const needMod = parts.includes('mod');
      const mod = event.metaKey || event.ctrlKey;
      if (needMod && !mod) return;
      if (!needMod && mod) return;
      if (event.key.toLowerCase() !== key) return;
      event.preventDefault();
      handler(event);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [combo, handler]);
}
