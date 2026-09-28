/**
 * ArtifactFrame — renders agent-authored HTML in a sandboxed iframe and routes
 * its interactions back through the fixed binding allowlist.
 *
 * The security model (docs/AI-SKILLS.md §7.1, ARCHITECTURE.md invariant 7):
 *
 *   - `sandbox="allow-scripts"` ONLY. No allow-same-origin, no allow-top-navigation,
 *     no allow-popups, no forms. The frame gets an opaque ("null") origin and can
 *     reach neither the parent DOM nor the network by default.
 *   - The agent authors PRESENTATION. It never authors a mutation. Every click
 *     becomes a `bind_event` postMessage, and this component dispatches only
 *     verbs on the allowlist.
 *   - Postgres is the source of truth. The frame is a projection. Local state is
 *     optimistic only, and is corrected by the server response.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BINDING_VERBS, dispatchBinding, ApiError } from '../lib/api.js';

const TOKENS = `
  :root {
    --bg: transparent;
    --surface: var(--tmm-surface, rgba(255,255,255,0.06));
    --text: var(--tmm-text, #1E293B);
    --muted: var(--tmm-muted, #64748B);
    --accent: var(--tmm-accent, #2563EB);
    --border: var(--tmm-border, rgba(127,127,127,0.18));
    --font: var(--tmm-font, ui-sans-serif, system-ui, sans-serif);
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 0.5rem; background: transparent; color: var(--text);
    font-family: var(--font); font-size: 0.92rem; line-height: 1.5;
  }
  ul, ol { list-style: none; margin: 0; padding: 0; }
  li { display: flex; align-items: flex-start; gap: 0.6rem; padding: 0.5rem 0.15rem;
       border-bottom: 1px solid var(--border); }
  li:last-child { border-bottom: none; }
  li[data-done="true"] .label { text-decoration: line-through; color: var(--muted); }
  .label { flex: 1; }
  .meta { color: var(--muted); font-size: 0.78rem; }
  .due { font-weight: 600; }
  .overdue { color: #DC2626; }
  button[data-action] {
    appearance: none; border: 1px solid var(--border); background: transparent;
    color: inherit; cursor: pointer; border-radius: 6px; padding: 0.1rem 0.45rem;
    font: inherit; line-height: 1.2; min-width: 1.6rem; min-height: 1.6rem;
  }
  button[data-action]:hover { background: var(--border); }
  button[data-action]:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }
  h3 { margin: 0 0 0.4rem; font-size: 0.98rem; }
  table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
  th, td { text-align: left; padding: 0.35rem 0.4rem; border-bottom: 1px solid var(--border); }
  th { color: var(--muted); font-weight: 600; }
  .empty { color: var(--muted); font-style: italic; padding: 0.75rem 0; }
  a { color: var(--accent); }
`;

/** Injected into the frame. Any edit here is a security decision, not a style tweak. */
const BRIDGE = `
  (function () {
    function closestAction(node) {
      let el = node;
      while (el && el !== document.body) {
        if (el.dataset && el.dataset.action) return el;
        el = el.parentElement;
      }
      return null;
    }

    document.addEventListener('click', function (event) {
      var trigger = closestAction(event.target);
      if (!trigger) return;
      event.preventDefault();
      var verb = trigger.dataset.action;
      var id = trigger.dataset.id || null;
      var payload = {};
      try { payload = JSON.parse(trigger.dataset.payload || '{}'); } catch (e) {}

      // Optimistic local projection; the server response is authoritative.
      if (verb === 'todo.toggle') {
        var li = trigger.closest('li');
        if (li) li.dataset.done = String(!payload.done);
        var pressed = trigger.getAttribute('aria-pressed') === 'true';
        trigger.setAttribute('aria-pressed', String(!pressed));
        var lbl = li && li.querySelector('.label');
        if (lbl) lbl.style.textDecoration = pressed ? 'none' : 'line-through';
        trigger.textContent = pressed ? '☐' : '☑';
        payload.done = !pressed;
      }

      parent.postMessage(
        { type: 'bind_event', verb: verb, id: id, payload: payload },
        '*'
      );
    }, true);

    parent.postMessage({ type: 'bind_ready' }, '*');
  })();
`;

function buildDoc(html) {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'">
<style>${TOKENS}</style></head>
<body>
${html || '<p class="empty">Nothing to show.</p>'}
<script>${BRIDGE}</script>
</body></html>`;
}

export default function ArtifactFrame({ artifact, theme, onMutated, height = 320 }) {
  const frameRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  const srcdoc = useMemo(() => buildDoc(artifact?.html), [artifact?.html]);

  useEffect(() => {
    function onMessage(event) {
      // The frame is sandboxed without allow-same-origin, so its origin is
      // "null" and cannot be checked. Identity is established by source.
      if (!frameRef.current || event.source !== frameRef.current.contentWindow) return;

      const data = event.data;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'bind_ready') {
        setReady(true);
        return;
      }

      if (data.type !== 'bind_event') return;

      const { verb, id, payload } = data;
      if (!BINDING_VERBS.includes(verb)) {
        setError(`Blocked unauthorized binding: ${verb}`);
        return;
      }

      setError(null);
      dispatchBinding(verb, id, payload)
        .then((result) => onMutated?.({ verb, id, payload, result }))
        .catch((err) => {
          if (err instanceof ApiError && err.notConnected) {
            setError('Backend not connected — the agent will apply this once it is.');
          } else {
            setError(err.message);
          }
        });
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [onMutated]);

  // Re-inject theme tokens so the frame matches the shell.
  const styleVars = {
    '--tmm-surface': theme?.surface,
    '--tmm-text': theme?.text,
    '--tmm-muted': theme?.muted,
    '--tmm-accent': theme?.accent,
    '--tmm-border': theme?.border,
    '--tmm-font': theme?.font,
  };

  return (
    <div className="artifact" style={styleVars}>
      <div className="artifact-head">
        <span className="artifact-kind">{artifact?.kind || 'artifact'}</span>
        {!ready && <span className="artifact-status">loading…</span>}
      </div>

      <iframe
        ref={frameRef}
        className="artifact-frame"
        title={artifact?.kind || 'Agent artifact'}
        sandbox="allow-scripts"
        srcDoc={srcdoc}
        style={{ height }}
        loading="lazy"
      />

      {error && <p className="artifact-error">{error}</p>}
    </div>
  );
}
