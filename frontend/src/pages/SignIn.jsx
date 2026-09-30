import { Link } from 'react-router-dom';
import MilloMark from '../components/MilloMark.jsx';

/**
 * Sign in.
 *
 * There is no account yet, so this page must not look like a sign-in form. The
 * design included a "Continue with Google" button; wiring it to `/auth/google`
 * would produce a 404 with a spinner, which is worse than saying nothing.
 *
 * So the button is gone and the page says the true thing. When OAuth is built
 * this becomes: one button, one redirect, and the copy below shrinks to a
 * footnote.
 */
export default function SignIn() {
  return (
    <div className="si">
      <div className="si-card card-float">
        <Link to="/" className="si-back">
          <span className="ms" aria-hidden="true">arrow_back</span>
          Back
        </Link>

        <div className="si-brand">
          <MilloMark size={30} />
          <span>ThreadMyMail</span>
        </div>

        <h1 className="si-title">No accounts yet</h1>
        <p className="si-body">
          Sign-in isn&rsquo;t built, so there is nothing here to sign in to. The
          published app currently runs as a single built-in account — which means
          anyone who has the link can use it as you.
        </p>

        <div className="si-actions">
          <Link to="/app" className="btn btn-primary">
            <span className="ms" aria-hidden="true">arrow_forward</span>
            Open the app anyway
          </Link>
        </div>

        <p className="si-note">
          Google account linking is the next piece of work. Until it lands, treat
          the app link as a shared password.
        </p>
      </div>
    </div>
  );
}
