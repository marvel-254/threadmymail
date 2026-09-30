import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { FeedHeader, EmptyFeed, shortWhen } from '../ThreadFeed.jsx';

/** Everything due today: calendar, then open todos. Real data or none of it. */
export default function TodayList({ selectedId, onOpen }) {
  const [events, setEvents] = useState([]);
  const [todos, setTodos] = useState([]);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    setState('loading');
    const now = new Date();
    const end = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    const [ev, td] = await Promise.allSettled([
      api.events(now.toISOString(), end.toISOString()),
      api.todos({ status: 'open' }),
    ]);
    setEvents(ev.status === 'fulfilled' ? (Array.isArray(ev.value) ? ev.value : ev.value?.items || []) : []);
    setTodos(td.status === 'fulfilled' ? (Array.isArray(td.value) ? td.value : td.value?.items || []) : []);
    setState('ready');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const empty = state === 'ready' && events.length === 0 && todos.length === 0;

  return (
    <>
      <FeedHeader title="Today" />
      <div className="scroll-silk feed-scroll">
        {state === 'loading' && <p className="feed-note">Loading…</p>}
        {empty && (
          <EmptyFeed
            icon="event_available"
            title="A clear day"
            body="No meetings and nothing outstanding. Millo will speak up if that changes."
          />
        )}

        {events.length > 0 && (
          <section className="feed-section">
            <div className="eyebrow">Schedule</div>
            {events.map((e) => (
              <button key={e.id} className="stream-row t-lift" onClick={() => onOpen(e.id, e)}>
                <div className="thread-top">
                  <span className="thread-from truncate">{e.summary || e.title || 'Event'}</span>
                  <span className="thread-when">{shortWhen(e.start)}</span>
                </div>
              </button>
            ))}
          </section>
        )}

        {todos.length > 0 && (
          <section className="feed-section">
            <div className="eyebrow">Outstanding</div>
            {todos.map((t) => (
              <button
                key={t.id}
                className="stream-row t-lift"
                data-active={t.id === selectedId}
                onClick={() => onOpen(t.id, t)}
              >
                <div className="thread-top">
                  <span className="thread-from truncate">{t.title}</span>
                  <span className="thread-when">{shortWhen(t.due_at)}</span>
                </div>
                {t.priority ? <span className="badge badge-mute">{t.priority}</span> : null}
              </button>
            ))}
          </section>
        )}
      </div>
    </>
  );
}
