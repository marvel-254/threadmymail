/**
 * CommandBar — ⌘K. Navigation, quick actions, and a direct line to the agent.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  IconStream,
  IconToday,
  IconActivity,
  IconSkills,
  IconPlugins,
  IconSettings,
  IconSearch,
} from './Icons.jsx';

const COMMANDS = [
  { id: 'stream', label: 'Go to Agent stream', icon: <IconStream size={16} />, action: 'view:stream' },
  { id: 'today', label: 'Go to Today', icon: <IconToday size={16} />, action: 'view:today' },
  { id: 'activity', label: 'Go to Activity', icon: <IconActivity size={16} />, action: 'view:activity' },
  { id: 'skills', label: 'Manage skills', icon: <IconSkills size={16} />, action: 'view:skills' },
  { id: 'plugins', label: 'Manage plugins', icon: <IconPlugins size={16} />, action: 'view:plugins' },
  { id: 'settings', label: 'Autonomy settings', icon: <IconSettings size={16} />, action: 'open:settings' },
  { id: 'sync', label: 'Sync mail now', icon: <IconSearch size={16} />, action: 'agent:sync' },
  { id: 'briefing', label: 'Morning briefing', icon: <IconStream size={16} />, action: 'agent:briefing' },
];

export default function CommandBar({ open, onClose, onCommand }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const inputRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter((c) => c.label.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setIndex(0);
      // Focus after paint so the dialog is mounted.
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;

  function onKeyDown(event) {
    if (event.key === 'Escape') return onClose();
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setIndex((i) => Math.min(i + 1, results.length - 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setIndex((i) => Math.max(i - 1, 0));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      const choice = results[index];
      if (choice) {
        onCommand(choice.action);
        onClose();
      }
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="command glass-strong"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Command bar"
        onKeyDown={onKeyDown}
      >
        <div className="command-input">
          <IconSearch size={17} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Type a command or ask the agent…"
            aria-label="Command"
          />
          <kbd>esc</kbd>
        </div>

        <ul className="command-list">
          {results.map((c, i) => (
            <li key={c.id}>
              <button
                className={`command-item ${i === index ? 'is-on' : ''}`}
                onMouseEnter={() => setIndex(i)}
                onClick={() => {
                  onCommand(c.action);
                  onClose();
                }}
              >
                {c.icon}
                <span>{c.label}</span>
              </button>
            </li>
          ))}
          {results.length === 0 && <li className="muted small">No matches.</li>}
        </ul>
      </div>
    </div>
  );
}
