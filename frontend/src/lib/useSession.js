/**
 * Who is signed in?
 *
 * The session cookie is HttpOnly, so this is the only way the frontend can
 * find out. It backs three things: the gate in front of /app, the account line
 * in the sidebar, and sign-out.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * @typedef {object} Session
 * @property {boolean} authenticated
 * @property {{id: string, email: string, name: string|null}|null} user
 * @property {boolean} dev_mode  True when the API is running without auth.
 */

const SIGNED_OUT = { authenticated: false, user: null, dev_mode: false };

/**
 * @param {{ enabled?: boolean }} options
 *   `enabled: false` skips the request entirely, for pages that render for
 *   anonymous visitors anyway (the landing page). Firing it there would be a
 *   wasted round trip on the first paint of the most-visited route.
 */
export function useSession({ enabled = true } = {}) {
  const [session, setSession] = useState(/** @type {Session|null} */ (null));
  const [loading, setLoading] = useState(enabled);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const res = await api.me();
      const next = res?.data ?? SIGNED_OUT;
      if (mounted.current) setSession(next);
      return next;
    } catch {
      // A network failure is indistinguishable from being signed out from the
      // browser's side, and treating it as signed-out is the safe reading: the
      // gate sends the user to sign in, and signing in again is harmless.
      if (mounted.current) setSession(SIGNED_OUT);
      return SIGNED_OUT;
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    void refresh();
  }, [enabled, refresh]);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      // Even if the call fails the local cookie is the browser's to drop; the
      // next full load re-checks against the server either way.
    }
    setSession(SIGNED_OUT);
    window.location.assign('/signin');
  }, []);

  return { session, loading, refresh, signOut };
}
