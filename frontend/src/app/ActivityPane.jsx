/**
 * Activity — plain-language feed of everything the agent did, with undo.
 *
 * Autonomy without an audit trail is a liability, not a feature. Every reversible
 * action surfaces an undo affordance here.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { IconActivity, IconUndo } from './Icons.jsx';

const KIND_ICON = {
  email_sent: '✉',
  meeting_booked: '📅',
  meeting_changed: '📅',
  todo_created: '☐',
  todo_completed: '☑',
  skill_ran: '⚡',
  note_written: '📝',
  escalation: '❗',
};

export default function ActivityPane() {
  const [pending, setPending] = useState(null);
  const feed = useAsync(() => api.activity({ limit: 100 }), []);

  async function undo(item) {
    setPending(item.id);
    try {
      await api.undoActivity(item.id);
      await feed.reload({ silent: true });
    } finally {
      setPending(null);
    }
  }

  return (
    <section className="pane" aria-label="Activity">
      <header className="pane-head">
        <h2>
          <IconActivity size={18} /> Activity
        </h2>
        <button className="btn btn-ghost btn-sm" onClick={() => feed.reload()}>
          Refresh
        </button>
      </header>

      <div className="pane-body">
        {feed.loading && <p className="muted">loading…</p>}
        {feed.error && (
          <p className="muted small">
            {feed.error.notConnected
              ? 'Backend not connected yet.'
              : feed.error.message}
          </p>
        )}

        {!feed.loading && (feed.data || []).length === 0 && (
          <p className="muted small">Nothing yet. The agent has not acted.</p>
        )}

        <ul className="feed">
          {(feed.data || []).map((item) => (
            <li key={item.id} className="feed-item">
              <span className="feed-icon" aria-hidden="true">
                {KIND_ICON[item.kind] || '•'}
              </span>
              <div className="feed-body">
                <p className="feed-summary">{item.summary}</p>
                <time className="feed-time">{formatTime(item.created_at)}</time>
              </div>
              {item.reversible && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => undo(item)}
                  disabled={pending === item.id}
                >
                  <IconUndo size={14} /> Undo
                </button>
              )}
            </li>
          ))}
        </ul>

        <div className="hint">
          <p>
            Anything reversible here can be undone. The kill switch in the header stops
            every run immediately.
          </p>
        </div>
      </div>
    </section>
  );
}

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const mins = Math.round((Date.now() - d.getTime()) / 6e4);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
