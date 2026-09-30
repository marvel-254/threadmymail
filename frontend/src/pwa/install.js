/**
 * PWA install plumbing.
 *
 * The critical constraint is that `beforeinstallprompt` fires once per browser
 * engagement, and calling `preventDefault()` on it is what makes the event
 * cancelable. If nothing is listening by the time it fires, that opportunity is
 * gone for the whole visit — the native mini-infobar either shows or it does
 * not, and we get no say.
 *
 * So the listener is registered at module scope, not in an effect. This file is
 * imported for its side effect from main.jsx before React mounts, which is the
 * only way to be sure the capture is in place first.
 *
 * `appinstalled` is the counterpart: it fires only after a real install, and it
 * is the only trustworthy signal that one happened.
 *
 * Exposed as an external store for `useSyncExternalStore` rather than a
 * subscribe-and-setState effect. Two reasons, and the second is the one that
 * bit: `useEffect` does not run during a server render, so an effect-driven
 * snapshot is stuck at its initial value in any SSR check, and in the browser
 * it costs an extra render with the banner absent before it appears.
 */

const KEY_DISMISSED = 'tmm.install.dismissed.v1';
const KEY_INSTALLED = 'tmm.install.done.v1';

/** @type {Event | null} */
let deferred = null;
/** @type {string | null} test override, read before any real detection */
let forced = null;

const subscribers = new Set();

const hasWindow = typeof window !== 'undefined';

/**
 * Cached because `useSyncExternalStore` calls getSnapshot on every render and
 * compares with Object.is. Returning a fresh object each time is an infinite
 * render loop, not a refresh.
 */
let cached = null;

function isIos() {
  if (!hasWindow) return false;
  const ua = navigator.userAgent;
  // iPadOS 13+ reports itself as a desktop Mac, so a Mac with touch points is
  // an iPad. Without this an iPad gets no install affordance at all.
  const ipadOsMac = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || ipadOsMac;
}

function isStandalone() {
  if (!hasWindow) return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    window.matchMedia?.('(display-mode: fullscreen)').matches === true ||
    // iOS Safari exposes this and nothing else.
    navigator.standalone === true
  );
}

function readFlag(key) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    // Private mode, or storage disabled. Treat as not-yet-set rather than
    // throwing: losing a dismissal is survivable, breaking the app is not.
    return false;
  }
}

function writeFlag(key, value) {
  try {
    if (value) localStorage.setItem(key, '1');
    else localStorage.removeItem(key);
  } catch {
    /* non-fatal */
  }
}

function compute() {
  // The test override is consulted first, including before the `hasWindow`
  // guard: a server render has no window, and the override is the only thing
  // that can describe browser state from there.
  if (forced) {
    return { state: forced, canPrompt: forced === 'ready', isIos: forced === 'manual' };
  }
  if (!hasWindow) return { state: 'unsupported', canPrompt: false, isIos: false };
  if (isStandalone() || readFlag(KEY_INSTALLED)) {
    return { state: 'installed', canPrompt: false, isIos: isIos() };
  }
  if (deferred) return { state: 'ready', canPrompt: true, isIos: false };
  if (isIos()) {
    // iOS has no programmatic install path at all. There is no event to
    // capture, so the only honest thing is to teach the gesture.
    return { state: 'manual', canPrompt: false, isIos: true };
  }
  return { state: 'unavailable', canPrompt: false, isIos: false };
}

export function current() {
  if (cached === null) cached = compute();
  return cached;
}

function emit() {
  cached = null;
  const snap = current();
  for (const fn of subscribers) fn();
}

if (hasWindow) {
  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferred = event;
    emit();
  });

  window.addEventListener('appinstalled', () => {
    deferred = null;
    writeFlag(KEY_INSTALLED, true);
    emit();
  });

  // A user who installed then uninstalled, or who dismissed in another tab,
  // should not be shown a stale banner.
  window.addEventListener('storage', (e) => {
    if (e.key === KEY_INSTALLED || e.key === KEY_DISMISSED) emit();
  });

  // Launching from the home screen changes display-mode at runtime. Without
  // this the banner keeps offering to install the app you are already in.
  for (const q of ['(display-mode: standalone)', '(display-mode: fullscreen)']) {
    window.matchMedia?.(q)?.addEventListener?.('change', emit);
  }
}

/** useSyncExternalStore subscribe. Deliberately does not emit on subscribe. */
export function subscribe(fn) {
  subscribers.add(fn);
  return () => {
    subscribers.delete(fn);
  };
}

/**
 * @returns {Promise<'accepted' | 'dismissed' | 'unavailable'>}
 */
export async function promptInstall() {
  if (!deferred) return 'unavailable';
  const event = deferred;
  // Cleared before awaiting: `userChoice` resolves late, and Chrome will not
  // fire a second `beforeinstallprompt` for a re-prompt anyway.
  deferred = null;
  try {
    await event.prompt();
    const choice = await event.userChoice;
    if (choice?.outcome === 'accepted') writeFlag(KEY_INSTALLED, true);
    emit();
    return choice?.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    emit();
    return 'unavailable';
  }
}

export function dismissForever() {
  writeFlag(KEY_DISMISSED, true);
  emit();
}

export function dismissedForever() {
  return readFlag(KEY_DISMISSED);
}

/**
 * Test seam.
 *
 * The interesting behaviour of the banner — ready vs the iOS instruction, and
 * the three ways it stays hidden — depends on browser state that does not exist
 * in a server render: a captured beforeinstallprompt, a user agent, a
 * localStorage flag. Without a seam the only way to test any of it is a real
 * browser, which is why it usually does not get tested.
 *
 * `forced` is consulted before any real detection, so a test never has to
 * emulate a browser to reach the branch.
 */
export function __forceState(state) {
  forced = state;
  emit();
}

export function __resetForTest() {
  forced = null;
  deferred = null;
  cached = null;
}
