/**
 * ConnectPrompt — the state the inbox is actually in right now.
 *
 * Google is not connected, so there is no mail to show. That is not an empty
 * inbox and must not be rendered as one: an empty list invites the user to
 * conclude the feature is broken, when the real answer is that no account is
 * linked yet.
 *
 * The honest version of this screen has to admit the button does nothing yet.
 * The designs ("Connect Workspace", "Continue with Google") assume OAuth ships
 * with them; it does not — `/v1/auth/google` is a 404 until that is built. So
 * the primary action explains the position instead of navigating into a dead
 * endpoint, which is the same rule that removed "One Google sign-in" from the
 * landing page.
 */
import { useState } from 'react';

export default function ConnectPrompt({ onConnected }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="connect">
      <div className="connect-art t-well" aria-hidden="true">
        <span className="ms">mark_email_unread</span>
      </div>

      <h2 className="connect-title">No account connected</h2>
      <p className="connect-body">
        ThreadMyMail reads your mail through your own Google account. Nothing is
        shared with a server-side inbox — Millo works with the credentials you
        link here, and you can unlink at any time.
      </p>

      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <span className="ms" aria-hidden="true">add_link</span>
        Connect Google
      </button>

      <p className="connect-fine">
        Until an account is linked, the rest of the app works — Millo can still
        run skills, keep todos and answer questions about what it has already
        seen.
      </p>

      {open && (
        <div className="sheet-scrim" onClick={() => setOpen(false)} role="presentation">
          <div
            className="sheet card-float"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="connect-title"
          >
            <h3 id="connect-title" className="sheet-title">
              Account linking isn&rsquo;t built yet
            </h3>
            <p className="sheet-body">
              Linking Google needs OAuth, which is the last piece of the roadmap
              and hasn&rsquo;t been started. The backend has the token handling,
              the encrypted credential store and the sync cursor &mdash; what&rsquo;s
              missing is the consent screen and the callback.
            </p>
            <p className="sheet-body">
              Until then there&rsquo;s no way to see real mail here, and the inbox
              stays empty no matter what this button does. I&rsquo;d rather say
              that than send you to a 404.
            </p>
            <div className="row" style={{ marginTop: 'var(--space-lg)' }}>
              <button className="btn btn-secondary" onClick={() => setOpen(false)}>
                Close
              </button>
              <div className="spacer" />
              <button
                className="btn btn-primary"
                onClick={() => {
                  setOpen(false);
                  onConnected?.();
                }}
              >
                Check again
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
