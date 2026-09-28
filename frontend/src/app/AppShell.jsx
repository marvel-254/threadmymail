/**
 * AppShell — the agent-first layout.
 *
 * The earlier 3-pane Gmail layout is retired: it put the AI in a drawer beside
 * the app. The agent is the app, so the stream is the primary surface and
 * everything else is a view of what it has done.
 */
import { useCallback, useState } from 'react';
import AgentStream from './AgentStream.jsx';
import TodayPane from './TodayPane.jsx';
import ActivityPane from './ActivityPane.jsx';
import SkillsPane from './SkillsPane.jsx';
import PluginsPane from './PluginsPane.jsx';
import SettingsPanel from './SettingsPanel.jsx';
import CommandBar from './CommandBar.jsx';
import {
  IconStream,
  IconToday,
  IconActivity,
  IconSkills,
  IconPlugins,
  IconSettings,
  IconKill,
  IconSun,
  IconMoon,
  IconSearch,
} from './Icons.jsx';
import { api } from '../lib/api.js';
import { useAsync, useDarkMode, useHotkey, useThemeTokens } from '../lib/hooks.js';

const VIEWS = [
  { id: 'stream', label: 'Stream', icon: <IconStream size={18} /> },
  { id: 'today', label: 'Today', icon: <IconToday size={18} /> },
  { id: 'activity', label: 'Activity', icon: <IconActivity size={18} /> },
  { id: 'skills', label: 'Skills', icon: <IconSkills size={18} /> },
  { id: 'plugins', label: 'Plugins', icon: <IconPlugins size={18} /> },
];

export default function AppShell() {
  const [view, setView] = useState('stream');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [dark, setDark] = useDarkMode();
  const theme = useThemeTokens(dark);

  const tools = useAsync(() => api.tools(), []);
  const kill = useAsync(() => api.killSwitch(), []);

  useHotkey('mod+k', useCallback(() => setCommandOpen((o) => !o), []));

  const engaged = kill.data?.global
    ? true
    : kill.data?.skills
      ? Object.values(kill.data.skills).some(Boolean)
      : false;

  async function onCommand(action) {
    if (action.startsWith('view:')) return setView(action.slice(5));
    if (action === 'open:settings') return setSettingsOpen(true);
    if (action === 'agent:sync') {
      try {
        await api.triggerSync();
        setView('activity');
      } catch {
        /* surfaced by panes */
      }
    }
    if (action === 'agent:briefing') setView('stream');
  }

  async function toggleKill() {
    try {
      await api.setKillSwitch({
        global: !engaged,
        skills: kill.data?.skills || {},
      });
      await kill.reload({ silent: true });
    } catch {
      /* surfaced by panes */
    }
  }

  return (
    <div className="shell">
      <nav className="rail" aria-label="Primary">
        <a className="rail-logo" href="/" aria-label="ThreadMyMail home">
          <img src="/logo.svg" alt="" />
        </a>

        <ul className="rail-nav">
          {VIEWS.map((v) => (
            <li key={v.id}>
              <button
                className={`rail-btn ${view === v.id ? 'is-on' : ''}`}
                onClick={() => setView(v.id)}
                aria-current={view === v.id ? 'page' : undefined}
                title={v.label}
              >
                {v.icon}
                <span className="rail-label">{v.label}</span>
              </button>
            </li>
          ))}
        </ul>

        <div className="rail-foot">
          <button
            className="rail-btn"
            onClick={() => setCommandOpen(true)}
            title="Command bar (⌘K)"
          >
            <IconSearch size={18} />
            <span className="rail-label">Search</span>
          </button>
          <button className="rail-btn" onClick={() => setSettingsOpen(true)} title="Autonomy">
            <IconSettings size={18} />
            <span className="rail-label">Autonomy</span>
          </button>
          <button className="rail-btn" onClick={() => setDark(!dark)} title="Toggle theme">
            {dark ? <IconSun size={18} /> : <IconMoon size={18} />}
            <span className="rail-label">Theme</span>
          </button>
          <button
            className={`rail-btn rail-kill ${engaged ? 'is-engaged' : ''}`}
            onClick={toggleKill}
            title={engaged ? 'Release the kill switch' : 'Halt every run'}
          >
            <IconKill size={18} />
            <span className="rail-label">{engaged ? 'Halted' : 'Kill switch'}</span>
          </button>
        </div>
      </nav>

      <main className="main">
        {view === 'stream' && (
          <AgentStream theme={theme} onOpenSettings={() => setSettingsOpen(true)} />
        )}
        {view === 'today' && <TodayPane />}
        {view === 'activity' && <ActivityPane />}
        {view === 'skills' && <SkillsPane tools={tools.data} />}
        {view === 'plugins' && <PluginsPane />}
      </main>

      <CommandBar
        open={commandOpen}
        onClose={() => setCommandOpen(false)}
        onCommand={onCommand}
      />

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
