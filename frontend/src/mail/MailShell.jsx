/**
 * MailShell — the three-pane workspace.
 *
 * Layout, per docs/design/silk_neomorphic_dark.md:
 *
 *   ┌────────┬──────────────┬──────────────────────────────┐
 *   │  rail  │ thread feed  │  workstation pane            │
 *   │ 64–240 │    380–480   │   1fr, min 560               │
 *   └────────┴──────────────┴──────────────────────────────┘
 *
 * Gutters are explicit. Neomorphic shadows need room to fall into; panels
 * flush against each other clip their own umbra and the whole illusion
 * collapses into flat dark mode.
 *
 * ── A reversal worth recording ───────────────────────────────────────────
 * AppShell.jsx retired this layout: *"The earlier 3-pane Gmail layout is
 * retired: it put the AI in a drawer beside the app."* That was a considered
 * call and it was not wrong on its own terms. It has been reversed by choice —
 * the agent gets the whole right pane, and the mail client gets the left two.
 * AgentStream.jsx is mounted in the workstation rather than beside it, so the
 * copilot is not demoted to a drawer; it is the main reading surface.
 *
 * ── Responsive ───────────────────────────────────────────────────────────
 * One component tree, three behaviours:
 *   ≥1280px  three panes
 *   768–1279 rail collapses to a 64px icon rail
 *   <768px   single surface; the feed and the workstation are two states of
 *            one pane rather than two panes, because two 380px columns on a
 *            390px phone is not a layout, it is a mistake.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import Sidebar from './Sidebar.jsx';
import TopBar from './TopBar.jsx';
import ThreadFeed from './ThreadFeed.jsx';
import Workstation from './Workstation.jsx';
import { useBreakpoint } from './useBreakpoint.js';
// Still the existing 650-line panel. It gets restyled onto the Silk tokens in
// a later pass; reusing it now means the whole feature set survives the
// redesign instead of being rebuilt from the mockups and quietly lost.
import SettingsPanel from '../app/SettingsPanel.jsx';

/** The nav. Order is the frequency order, not an arbitrary one. */
export const VIEWS = [
  { id: 'inbox', label: 'Inbox', icon: 'inbox', hint: 'Mail, triaged' },
  { id: 'stream', label: 'Stream', icon: 'stream', hint: 'What Millo is doing' },
  { id: 'today', label: 'Today', icon: 'calendar_today', hint: 'Your day' },
  { id: 'activity', label: 'Activity', icon: 'bolt', hint: 'Everything it did' },
  { id: 'skills', label: 'Skills', icon: 'psychology', hint: 'What it may do' },
  { id: 'plugins', label: 'Plugins', icon: 'extension', hint: 'What it can use' },
];

export default function MailShell() {
  const bp = useBreakpoint();
  const [view, setView] = useState('inbox');
  const [railOpen, setRailOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // On mobile the feed and the workstation are the same pane in two states.
  const [mobileDetail, setMobileDetail] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  // The feed already holds the whole row, so selection carries it along rather
  // than just the id. The detail pane then renders immediately instead of
  // refetching — which matters most for the list endpoints, where
  // /activity and /todos return arrays that have no per-item GET to drill into.
  const [selected, setSelected] = useState(null);

  // The rail is a luxury. On a laptop it costs 176px that the reading pane
  // can use far better, so it starts collapsed between 768 and 1280.
  useEffect(() => {
    if (bp === 'mobile') setRailOpen(false);
  }, [bp]);

  // Leaving mobile with a thread open would otherwise strand the user on a
  // detail view with no list to go back to.
  useEffect(() => {
    if (bp !== 'mobile') setMobileDetail(false);
  }, [bp]);

  const selectView = useCallback(
    (next) => {
      setView(next);
      if (bp === 'mobile') setMobileDetail(false);
    },
    [bp],
  );

  const openThread = useCallback(
    (id, row) => {
      setSelectedId(id);
      setSelected(row || null);
      if (bp === 'mobile') setMobileDetail(true);
    },
    [bp],
  );

  const closeThread = useCallback(() => {
    if (bp === 'mobile') setMobileDetail(false);
  }, [bp]);

  const collapsed = !railOpen;

  const shell = useMemo(
    () => ({
      view,
      setView: selectView,
      openThread,
      selectedId,
      selected,
      closeThread,
    }),
    [view, selectView, openThread, selectedId, selected, closeThread],
  );

  const showFeed = bp !== 'mobile' || !mobileDetail;
  const showWork = bp !== 'mobile' || mobileDetail;

  return (
    <div
      className="mail-shell"
      data-bp={bp}
      data-rail={collapsed ? 'collapsed' : 'open'}
    >
      <TopBar
        view={view}
        railOpen={railOpen}
        onToggleRail={() => setRailOpen((v) => !v)}
        onOpenSettings={() => setSettingsOpen(true)}
        onSearchFocus={() => selectView('inbox')}
      />

      <div className="mail-body">
        {bp !== 'mobile' && (
          <Sidebar
            view={view}
            onSelectView={selectView}
            collapsed={collapsed}
            onOpenSettings={() => setSettingsOpen(true)}
          />
        )}

        {showFeed && (
          <ThreadFeed
            view={view}
            selectedId={selectedId}
            onOpenThread={openThread}
            onBack={closeThread}
            showBack={bp === 'mobile' && mobileDetail}
          />
        )}

        {showWork && (
          <Workstation {...shell} onBack={closeThread} showBack={bp === 'mobile'} />
        )}
      </div>

      {bp === 'mobile' && (
        <MobileTabBar view={view} onSelect={selectView} onSettings={() => setSettingsOpen(true)} />
      )}

      {settingsOpen && (
        <SettingsSheet onClose={() => setSettingsOpen(false)} />
      )}
    </div>
  );
}

/**
 * Below 768px the sidebar becomes a bottom bar. A hamburger drawer costs two
 * taps to reach the second-most-used view; the nav is five items and they all
 * fit.
 */
function MobileTabBar({ view, onSelect, onSettings }) {
  return (
    <nav className="mobile-tabs" aria-label="Primary">
      {VIEWS.slice(0, 5).map((v) => (
        <button
          key={v.id}
          className="mobile-tab"
          data-active={view === v.id}
          onClick={() => onSelect(v.id)}
          aria-current={view === v.id ? 'page' : undefined}
        >
          <span className="ms" aria-hidden="true">{v.icon}</span>
          <span className="mobile-tab-label">{v.label}</span>
        </button>
      ))}
      <button className="mobile-tab" onClick={onSettings} aria-label="Settings">
        <span className="ms" aria-hidden="true">settings</span>
        <span className="mobile-tab-label">Settings</span>
      </button>
    </nav>
  );
}

/** Settings slides over rather than replacing a pane — it is a modal task. */
function SettingsSheet({ onClose }) {
  // Escape closes. Settings is a long scroll and a close button at the top is
  // not reachable from the bottom of it on a laptop.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-scrim" onClick={onClose} role="presentation">
      <div
        className="sheet card-float scroll-silk"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <SettingsPanel onClose={onClose} />
      </div>
    </div>
  );
}
