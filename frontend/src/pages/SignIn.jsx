import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import MilloMark from '../components/MilloMark.jsx';
import { api } from '../lib/api.js';
import { useSession } from '../lib/useSession.js';

/**
 * Sign in with Google.
 *
 * ── On the copy ─────────────────────────────────────────────────────────────
 *
 * The structure here is the design's: avatar, status chip, one button, a
 * divider, then three trust points. The words inside that structure are not the
 * design's, because the design's made claims this build cannot support —
 * "Silk Vault enclave; absolutely zero LLM training", "SOC2 Type II compliant",
 * "4,200+ partners, founders and executives". Each has been replaced with a
 * statement that is true today and can be checked.
 *
 * ── On the button ───────────────────────────────────────────────────────────
 *
 * This is a full page navigation, not a fetch. The OAuth round trip needs a
 * top-level redirect, and the HttpOnly session cookie has to come back on a real
 * document load. `window.location.assign` rather than an href so the click is
 * explicit and the button can show that something is happening.
 */
export default function SignIn() {
  const { session, loading } = useSession();
  const [configError, setConfigError] = useState(null);
  const [busy, setBusy] = useState(false);

  // The OAuth callback redirects back with a fragment describing what happened.
  // Surfacing it matters: a failed consent that silently lands on a working
  // sign-in page looks like the app ignoring the user.
  useEffect(() => {
    const hash = window.location.hash.replace(/^#/, '');
    if (!hash.startsWith('error=')) return;
    const code = decodeURIComponent(hash.slice('error='.length));
    setConfigError(ERROR_COPY[code] ?? 'Google sign-in did not complete. Please try again.');
    window.history.replaceState(null, '', window.location.pathname);
  }, []);

  if (!loading && session?.authenticated) return <Navigate to="/app" replace />;

  const start = () => {
    setBusy(true);
    setConfigError(null);
    window.location.assign(api.authUrl());
  };

  const disabled = busy || configError === 'not_configured';

  return (
    <div className="si">
      <nav className="si-topnav">
        <Link to="/" className="si-navlink">
          <span className="ms" aria-hidden="true">arrow_back</span>
          Back to Overview
        </Link>
        <Link to="/docs" className="si-navlink">
          <span className="ms" aria-hidden="true">article</span>
          Documentation
        </Link>
        <Link to="/privacy" className="si-navlink">
          <span className="ms" aria-hidden="true">verified_user</span>
          Security
        </Link>
      </nav>

      <div className="si-orb si-orb--a" aria-hidden="true" />
      <div className="si-orb si-orb--b" aria-hidden="true" />

      <div className="si-card">
        <div className="si-avatar">
          <span className="si-avatar__ring" aria-hidden="true" />
          <MilloMark size={72} />
          <span className="si-avatar__dot" aria-hidden="true" />
        </div>

        <p className="si-chip">
          <span className="ms" aria-hidden="true">auto_awesome</span>
          Autonomous Copilot Ready
        </p>

        <h1 className="si-title">Get Started with</h1>
        <p className="si-body">
          Autonomous email triage, contract extraction, and executive responses.
          Millo works in your own account and only acts on the tools you allow.
        </p>

        {configError ? (
          <p className="si-error" role="alert">
            <span className="ms" aria-hidden="true">error_outline</span>
            {configError}
          </p>
        ) : null}

        <button
          type="button"
          className="btn btn-google"
          onClick={start}
          disabled={disabled}
        >
          <GoogleGlyph />
          <span>{busy ? 'Redirecting…' : 'Continue with Google'}</span>
        </button>

        <p className="si-scope">
          ThreadMyMail asks Google for <strong>read-only</strong> access to mail
          and calendar. It cannot send or delete anything.
        </p>

        <div className="si-divider"><span>Why this is safe</span></div>

        <ul className="si-trust">
          <li>
            <span className="ms si-trust__icon" aria-hidden="true">lock</span>
            <strong>Your keys, your account</strong>
            <p>
              Model API keys are stored encrypted against your user row and are
              never sent to the browser — you can only see whether one is set.
            </p>
          </li>
          <li>
            <span className="ms si-trust__icon" aria-hidden="true">person</span>
            <strong>Signed in as one person</strong>
            <p>
              Every request is scoped to your account. There is no shared
              workspace and no URL that grants access on its own.
            </p>
          </li>
          <li>
            <span className="ms si-trust__icon" aria-hidden="true">front_hand</span>
            <strong>Nothing happens without a tool call</strong>
            <p>
              Millo can only act through tools you can see and switch off, and
              the kill switch stops a running job immediately.
            </p>
          </li>
        </ul>

        {session?.dev_mode ? (
          <p className="si-note">
            This deployment is running without authentication, so signing in is
            not required. <Link to="/app">Open the app anyway</Link>.
          </p>
        ) : null}
      </div>

      <footer className="si-foot">
        <Link to="/terms">Terms of Service</Link>
        <Link to="/privacy">Privacy Policy</Link>
        <Link to="/docs">Documentation</Link>
        <span className="si-foot__sep" aria-hidden="true">
          <span className="ms">shield_lock</span>
        </span>
        <span>© {new Date().getFullYear()} ThreadMyMail</span>
      </footer>
    </div>
  );
}

/** Google's mark, inline so there is no extra request and no icon font dependency. */
function GoogleGlyph() {
  return (
    <svg className="si-google-glyph" viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.81.54-1.85.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.34A9 9 0 0 0 9 18z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.94H.96a9 9 0 0 0 0 8.12l3.01-2.34z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.9 11.43 0 9 0A9 9 0 0 0 .96 4.94l3.01 2.34C4.68 5.16 6.66 3.58 9 3.58z" />
    </svg>
  );
}

/** Callback failures, in the words of someone who has to fix it. */
const ERROR_COPY = {
  not_configured:
    'Google sign-in is not configured on this deployment. The owner needs to set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
  state_mismatch:
    'That sign-in attempt could not be verified, usually because it was started in a different tab or expired. Please try again.',
  no_code: 'Google did not return an authorization code. Please try again.',
  access_denied: 'You declined the permissions request, so nothing was connected.',
  token_exchange_failed:
    'Google issued a code that could not be exchanged. This is usually a redirect-URI mismatch in the Google Cloud console.',
  profile_failed: 'Signed in with Google, but the account details could not be read.',
};
