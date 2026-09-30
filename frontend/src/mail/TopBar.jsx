/**
 * TopBar — identity, search, and the kill switch.
 *
 * The kill switch is here rather than in Settings on purpose. It is the one
 * control that stops the agent acting, and it must be reachable in one click
 * from any pane without opening a settings sheet. Burying it in a submenu is
 * how an autonomous system ends up doing something unwelcome.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

export default function TopBar({ view, railOpen, onToggleRail, onOpenSettings, onSearchFocus }) {
  const [engaged, setEngaged] = useState(false);
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    api.killSwitch()
      .then((s) => alive && setEngaged(Boolean(s && s.engaged)))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function toggle() {
    if (busy) return;
    setBusy(true);
    const next = !engaged;
    // Optimistic: the switch must feel instant, because it is the control you
    // reach for when something is going wrong.
    setEngaged(next);
    try {
      await api.setKillSwitch({ engaged: next });
    } catch {
      setEngaged(!next); // roll back rather than leave a lie on screen
    } finally {
      setBusy(false);
    }
  }

  return (
    <header className="topbar t-plane">
      <button
        className="btn btn-ghost btn-icon"
        onClick={onToggleRail}
        aria-label={railOpen ? 'Collapse sidebar' : 'Expand sidebar'}
        aria-pressed={railOpen}
      >
        <span className="ms" aria-hidden="true">
          {railOpen ? 'left_panel_close' : 'left_panel_open'}
        </span>
      </button>

      <div className="brand">
        <span className="brand-name">ThreadMyMail</span>
      </div>

      <div className="topbar-search">
        <span className="ms search-icon" aria-hidden="true">search</span>
        <input
          className="input topbar-input"
          type="search"
          placeholder="Search mail, or ask Millo…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={onSearchFocus}
          aria-label="Search"
        />
        <kbd className="kbd">⌘K</kbd>
      </div>

      <div className="spacer" />

      <span className="topbar-view">{view}</span>

      <KillSwitch engaged={engaged} onToggle={toggle} busy={busy} />
    </header>
  );
}

function KillSwitch({ engaged, onToggle, busy }) {
  const ref = useRef(null);
  const label = engaged ? 'Autonomy off' : 'Autonomy on';

  return (
    <div className="kill">
      <span className="kill-label" data-on={!engaged}>
        {engaged ? 'Halted' : 'Autonomous'}
      </span>
      <button
        ref={ref}
        className="switch"
        data-on={!engaged}
        onClick={onToggle}
        disabled={busy}
        role="switch"
        aria-checked={!engaged}
        aria-label={label}
        title={label}
      />
    </div>
  );
}
