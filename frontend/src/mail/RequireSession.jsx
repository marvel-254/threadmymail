/**
 * The sign-in gate for /app.
 *
 * Until this existed, the deployed app was a public URL where every visitor was
 * the same hardcoded user — the account's todos, skills and credential store
 * were all one click away. This is the component that makes that untrue.
 *
 * ── What it deliberately does NOT do ────────────────────────────────────────
 *
 * It is not a security boundary. Hiding the UI while the session loads would be
 * theatre: the API enforces this independently, and every route 401s without a
 * valid session. This is here so an anonymous visitor gets sent to sign in
 * instead of a shell full of failed requests, and so a signed-in user is not
 * flashed the sign-in page on every refresh.
 *
 * The one case worth being careful about: a session that expires while the tab
 * is open. The API starts returning 401s, the UI shows an error, and the user is
 * stranded until they reload. `onExpired` exists so that path can be handled
 * rather than left to rot.
 */

import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSession } from '../lib/useSession.js';
import { MailShellLoading } from './ShellStates.jsx';

/**
 * @param {{ children: React.ReactNode, onExpired?: () => void }} props
 */
export default function RequireSession({ children, onExpired }) {
  const { session, loading } = useSession();
  const navigate = useNavigate();

  const authenticated = session?.authenticated === true;
  const devMode = session?.dev_mode === true;

  useEffect(() => {
    // dev_mode means the API is running without auth entirely (a local Worker).
    // Bouncing there would lock a developer out of their own machine.
    if (!loading && !authenticated && !devMode) {
      navigate('/signin', { replace: true, state: { from: window.location.pathname } });
    }
  }, [loading, authenticated, devMode, navigate]);

  useEffect(() => {
    if (authenticated && typeof onExpired === 'function') onExpired();
  }, [authenticated, onExpired]);

  if (loading) return <MailShellLoading label="Restoring your session" />;
  if (!authenticated && !devMode) return <MailShellLoading label="Redirecting to sign in" />;
  return children;
}
