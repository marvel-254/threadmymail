/**
 * InstallBanner — the custom install prompt.
 *
 * A custom banner rather than the browser's own mini-infobar, for two reasons:
 * the native one is a grey slab that does not belong on this surface, and it is
 * shown or hidden by the browser with no say over when. Suppressing it with
 * preventDefault() and showing our own is the only way to time it.
 *
 * Where it appears: never on the sign-in page, because installing an app you
 * cannot get into is a strange thing to ask of someone. Anywhere else is fine.
 *
 * On iOS there is nothing to prompt — Safari has no install API — so the banner
 * becomes the Share → Add to Home Screen instruction instead of pretending a
 * button will do something.
 */
import { useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router-dom';
import {
  current,
  dismissForever,
  dismissedForever,
  promptInstall,
  subscribe,
} from './install.js';

export default function InstallBanner() {
  // Reads during render rather than in an effect, so the banner is correct on
  // the first paint and correct in a server render.
  const snap = useSyncExternalStore(subscribe, current, current);
  const [busy, setBusy] = useState(false);
  const { pathname } = useLocation();

  if (dismissedForever()) return null;
  if (snap.state !== 'ready' && snap.state !== 'manual') return null;
  // Sign-in is a dead end until the Google credentials are provisioned; an
  // install prompt there would be offering a shell around a locked door.
  if (pathname.startsWith('/signin')) return null;

  const ios = snap.state === 'manual';

  async function onInstall() {
    setBusy(true);
    await promptInstall();
    setBusy(false);
  }

  return (
    <aside className="install" role="region" aria-label="Install ThreadMyMail">
      <div className="install__body">
        <span className="install__mark" aria-hidden="true">
          <span className="ms">download</span>
        </span>
        <div className="install__text">
          <strong className="install__title">
            {ios ? 'Add ThreadMyMail to your Home Screen' : 'Install ThreadMyMail'}
          </strong>
          <p className="install__sub">
            {ios
              ? 'Tap Share, then Add to Home Screen. It opens like an app, with no browser bar.'
              : 'Runs full screen and opens straight to your inbox.'}
          </p>
        </div>
      </div>

      <div className="install__actions">
        {ios ? (
          <button
            className="btn btn-ghost btn-sm"
            onClick={dismissForever}
          >
            Got it
          </button>
        ) : (
          <>
            <button
              className="btn btn-primary btn-sm"
              onClick={onInstall}
              disabled={busy}
            >
              {busy ? 'Installing…' : 'Install'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              onClick={dismissForever}
            >
              Not now
            </button>
          </>
        )}
        <button
          className="install__x"
          onClick={dismissForever}
          aria-label="Dismiss the install prompt"
        >
          <span className="ms" aria-hidden="true">
            close
          </span>
        </button>
      </div>
    </aside>
  );
}
