/**
 * Full-shell states: the moments where there is nothing to show yet.
 *
 * Separate from the feed skeleton because these replace the WHOLE three-pane
 * shell — during sign-in, and while the session is being restored. A feed
 * skeleton in an otherwise-complete shell would imply "loading your mail" when
 * the truth is "deciding whether you are allowed in", which is a different wait
 * and worth naming differently.
 */

import MilloMark from '../components/MilloMark.jsx';

export function MailShellLoading({ label = 'Loading' }) {
  return (
    <div className="shell-boot" role="status" aria-live="polite">
      <div className="shell-boot__mark">
        <MilloMark size={44} />
      </div>
      <p className="shell-boot__label">{label}</p>
    </div>
  );
}

/**
 * A terminal error, as opposed to a slow request.
 *
 * Used when something failed in a way retrying will not fix — the API is down,
 * or the response was not something the UI can render. Offering a reload is
 * honest; offering a retry button for a 500 that will 500 again is not.
 */
export function ShellError({ title, detail, onReload }) {
  return (
    <div className="shell-boot" role="alert">
      <div className="shell-boot__mark">
        <span className="ms shell-boot__icon" aria-hidden="true">
          error_outline
        </span>
      </div>
      <p className="shell-boot__label">{title}</p>
      {detail ? <p className="shell-boot__detail">{detail}</p> : null}
      {onReload ? (
        <button type="button" className="btn btn-secondary" onClick={onReload}>
          <span className="ms" aria-hidden="true">
            refresh
          </span>
          Reload
        </button>
      ) : null}
    </div>
  );
}
