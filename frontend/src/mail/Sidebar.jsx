/**
 * Sidebar — the rail.
 *
 * Two states from one markup: 240px expanded, 64px collapsed. Collapsing is
 * not a display:none on the labels; the labels carry the meaning, so the icon
 * alone needs an accessible name and a tooltip to stay usable.
 */
import { useEffect, useState } from 'react';
import { VIEWS } from './MailShell.jsx';
import { useCounts } from './useCounts.js';
import { useSession } from '../lib/useSession.js';

export default function Sidebar({ view, onSelectView, collapsed, onOpenSettings }) {
  const counts = useCounts(view);
  const { session, signOut } = useSession();

  return (
    <nav className="rail t-plane" aria-label="Workspace">
      <ul className="rail-list">
        {VIEWS.map((v) => (
          <li key={v.id}>
            <RailButton
              item={v}
              active={view === v.id}
              collapsed={collapsed}
              count={counts[v.id]}
              onSelect={onSelectView}
            />
          </li>
        ))}
      </ul>

      <div className="rail-footer">
        <AccountBadge
          collapsed={collapsed}
          name={session?.user?.name || session?.user?.email || null}
          onSignOut={signOut}
          devMode={session?.dev_mode === true}
        />
        <RailFooterButton
          icon="settings"
          label="Settings"
          collapsed={collapsed}
          onClick={onOpenSettings}
        />
        <AutonomyBadge collapsed={collapsed} />
      </div>
    </nav>
  );
}

/**
 * Who is signed in, and the way out.
 *
 * The account is at the foot of the rail rather than in a settings page because
 * signing out is something a shared or borrowed machine needs to be obvious
 * about. The email is truncated rather than wrapped: a long address in a 240px
 * rail would push the nav around, and the full value stays in the title.
 */
function AccountBadge({ collapsed, name, onSignOut, devMode }) {
  const initial = (name ?? '?').trim().charAt(0).toUpperCase() || '?';
  const label = devMode ? 'No sign-in (dev)' : name ?? 'Signed in';

  return (
    <div className="rail-account" data-collapsed={collapsed}>
      <span className="rail-account__avatar" aria-hidden="true">
        {devMode ? <span className="ms">science</span> : initial}
      </span>
      {!collapsed && (
        <span className="rail-account__text">
          <span className="rail-account__name" title={name ?? undefined}>
            {label}
          </span>
          <span className="rail-account__sub">
            {devMode ? 'authentication off' : 'signed in'}
          </span>
        </span>
      )}
      <button
        type="button"
        className="rail-account__out"
        onClick={onSignOut}
        title="Sign out"
        aria-label="Sign out"
      >
        <span className="ms" aria-hidden="true">logout</span>
      </button>
    </div>
  );
}

function RailButton({ item, active, collapsed, count, onSelect }) {
  return (
    <button
      className="rail-item"
      data-active={active}
      data-collapsed={collapsed}
      onClick={() => onSelect(item.id)}
      aria-current={active ? 'page' : undefined}
      title={collapsed ? item.label : undefined}
    >
      <span className="ms rail-icon" aria-hidden="true">{item.icon}</span>
      {!collapsed && <span className="rail-label">{item.label}</span>}
      {!collapsed && count > 0 && (
        <span className="rail-count" aria-label={`${count} unread`}>
          {count > 99 ? '99+' : count}
        </span>
      )}
      {collapsed && count > 0 && <span className="rail-dot" aria-hidden="true" />}
      {collapsed && <span className="sr-only">{item.label}</span>}
    </button>
  );
}

function RailFooterButton({ icon, label, collapsed, onClick }) {
  return (
    <button
      className="rail-item"
      data-collapsed={collapsed}
      onClick={onClick}
      title={collapsed ? label : undefined}
    >
      <span className="ms rail-icon" aria-hidden="true">{icon}</span>
      {!collapsed && <span className="rail-label">{label}</span>}
      {collapsed && <span className="sr-only">{label}</span>}
    </button>
  );
}

/**
 * Live autonomy state, sourced from the kill switch rather than hardcoded.
 * "Autonomous" is the most load-bearing word in the product — it is the whole
 * promise that it acts without being asked — so it must reflect the real
 * switch, not a decorative badge.
 */
function AutonomyBadge({ collapsed }) {
  const [state, setState] = useState({ on: true, loaded: false });

  useEffect(() => {
    let alive = true;
    // Imported here rather than at the top so the rail does not pull the API
    // module — and therefore not fail to render — when the Worker is absent.
    import('../lib/api.js')
      .then(({ api }) => api.killSwitch())
      .then((s) => {
        if (!alive) return;
        setState({ on: !(s && s.engaged), loaded: true });
      })
      .catch(() => alive && setState((p) => ({ ...p, loaded: true })));
    return () => {
      alive = false;
    };
  }, []);

  const { on, loaded } = state;

  if (collapsed) {
    return (
      <div className="autonomy-dot" data-on={on} title={`Autonomy ${on ? 'on' : 'off'}`}>
        <span className="pulse-dot" />
        <span className="sr-only">Autonomy {on ? 'on' : 'off'}</span>
      </div>
    );
  }

  return (
    <div className="autonomy" data-on={on}>
      <span className="pulse-dot" />
      <div className="autonomy-text">
        <div className="autonomy-title">
          {loaded ? (on ? 'Autonomous' : 'Paused') : 'Checking…'}
        </div>
        <div className="autonomy-sub">Millo</div>
      </div>
    </div>
  );
}
