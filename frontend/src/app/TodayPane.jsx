/**
 * Today — todos, upcoming meetings, and what's waiting on you.
 *
 * The checkbox here is a real binding: it goes through the same allowlisted verb
 * as an agent-authored artifact, so the agent finds out either way.
 */
import { useCallback, useState } from 'react';
import { api, dispatchBinding } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { IconToday, IconClock, IconMail } from './Icons.jsx';

export default function TodayPane() {
  const [flash, setFlash] = useState(null);

  const todos = useAsync(() => api.todos({ status: 'open' }), []);
  const events = useAsync(() => {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * 864e5).toISOString();
    return api.events(from, to);
  }, []);

  const toggle = useCallback(
    async (todo) => {
      // Optimistic; corrected by the server response.
      const optimistic = todos.data?.map((t) =>
        t.id === todo.id ? { ...t, status: t.status === 'done' ? 'open' : 'done' } : t,
      );
      todos.setData(optimistic);
      try {
        await dispatchBinding('todo.toggle', todo.id, { done: todo.status !== 'done' });
        setFlash(null);
        await todos.reload({ silent: true });
      } catch {
        setFlash(todo.id);
        await todos.reload({ silent: true });
      }
    },
    [todos],
  );

  return (
    <section className="pane" aria-label="Today">
      <header className="pane-head">
        <h2>
          <IconToday size={18} /> Today
        </h2>
        <button className="btn btn-ghost btn-sm" onClick={() => todos.reload()}>
          Refresh
        </button>
      </header>

      <div className="pane-body">
        <Block
          title="Open tasks"
          icon={<IconToday size={15} />}
          loader={todos}
          empty="Nothing open. Suspicious — check the agent."
        >
          <ul className="todo-list">
            {(todos.data || []).map((t) => (
              <li key={t.id} className={t.status === 'done' ? 'is-done' : ''}>
                <button
                  className="todo-check"
                  data-action="todo.toggle"
                  data-id={t.id}
                  onClick={() => toggle(t)}
                  aria-label={t.status === 'done' ? 'Reopen task' : 'Complete task'}
                >
                  {t.status === 'done' ? '☑' : '☐'}
                </button>
                <div className="todo-main">
                  <span className="todo-title">{t.title}</span>
                  {t.notes && <span className="todo-notes">{t.notes}</span>}
                  <span className="todo-meta">
                    {t.source && <em>{t.source}</em>}
                    {t.priority > 0 && <em>priority {t.priority}</em>}
                  </span>
                </div>
                {t.due_at && (
                  <span className={`todo-due ${isOverdue(t) ? 'is-overdue' : ''}`}>
                    {formatDue(t.due_at)}
                  </span>
                )}
                {flash === t.id && <span className="todo-flash">retry</span>}
              </li>
            ))}
          </ul>
        </Block>

        <Block
          title="Next 7 days"
          icon={<IconClock size={15} />}
          loader={events}
          empty="No meetings on the calendar."
        >
          <ul className="event-list">
            {(events.data || []).map((e) => (
              <li key={e.id}>
                <span className="event-when">{formatWhen(e.start)}</span>
                <span className="event-title">{e.summary || '(no title)'}</span>
                {e.organizer?.self && <span className="tag">booked by agent</span>}
              </li>
            ))}
          </ul>
        </Block>

        <div className="hint">
          <IconMail size={15} />
          <p>
            Nothing here is edited by hand unless you do it. Everything else is the
            agent&apos;s view.
          </p>
        </div>
      </div>
    </section>
  );
}

function Block({ title, icon, loader, empty, children }) {
  return (
    <div className="block">
      <h3 className="block-title">
        {icon} {title}
      </h3>
      {loader.loading && <p className="muted">loading…</p>}
      {loader.error && (
        <p className="muted small">
          {loader.error.notConnected ? 'Backend not connected yet.' : loader.error.message}
        </p>
      )}
      {!loader.loading && !loader.error && children}
      {!loader.loading && !loader.error && isEmpty(loader.data) && (
        <p className="muted small">{empty}</p>
      )}
    </div>
  );
}

function isEmpty(data) {
  if (!data) return true;
  if (Array.isArray(data)) return data.length === 0;
  return Object.keys(data).length === 0;
}

function isOverdue(t) {
  return t.due_at && new Date(t.due_at) < new Date() && t.status !== 'done';
}

function formatDue(iso) {
  const d = new Date(iso);
  const days = Math.round((d - Date.now()) / 864e5);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days < 0) return `${-days}d late`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatWhen(iso) {
  const d = new Date(iso);
  const sameDay = d.toDateString() === new Date().toDateString();
  return sameDay
    ? d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' });
}
