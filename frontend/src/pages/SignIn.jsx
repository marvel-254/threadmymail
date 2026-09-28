/**
 * SignIn — one Google consent grants identity + Gmail + Calendar.
 * See docs/GOOGLE_OAUTH.md. The red "unverified app" interstitial is expected.
 */
import { api } from '../lib/api.js';

export default function SignIn() {
  function go() {
    window.location.href = api.authUrl();
  }

  return (
    <div className="auth">
      <div className="auth-card glass-strong">
        <img src="/logo.svg" alt="" className="auth-logo" />
        <h1>ThreadMyMail</h1>
        <p className="muted">
          One sign-in. The agent reads your mail, manages your calendar, and acts on
          your behalf.
        </p>
        <button className="btn btn-primary" onClick={go}>
          Continue with Google
        </button>
        <p className="muted small">
          Google will show an &ldquo;unverified app&rdquo; warning — expected, because the
          app is not published for verification. Choose <em>Advanced → Go to
          ThreadMyMail</em>.
        </p>
        <a className="muted small" href="/">
          Back to home
        </a>
      </div>
    </div>
  );
}
