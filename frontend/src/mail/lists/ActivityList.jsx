import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { FeedHeader, EmptyFeed, shortWhen } from '../ThreadFeed.jsx';

/**
 * The audit trail: one row per thing Millo actually did, and — where it is
 * safe — a way to undo it.
 *
 * `undo_ref` and `undone_at` already exist on the activity table but nothing
 * writes an undo yet, so the affordance is hidden rather than offered and then
 * rejected. A button that always 404s is worse than no button.
 */
export default function ActivityList({ selectedId, onOpen }) {
  const [rows, setRows] = useState([]);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await api.activity({ limit: 60 });
      setRows(Array.isArray(res) ? res : res?.items || []);
      setState('ready');
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <FeedHeader title="Activity" meta={rows.length ? String(rows.length) : undefined} />
      <div className="scroll-silk feed-scroll">
        {state === 'loading' && <p className="feed-note">Loading…</p>}
        {state === 'error' && (
          <EmptyFeed icon="cloud_off" title="Can't load activity" body="The Worker did not respond." />
        )}
        {state === 'ready' && rows.length === 0 && (
          <EmptyFeed
            icon="bolt"
            title="Nothing has happened yet"
            body="Every action Millo takes is logged here, so you can see exactly what it did on your behalf."
          />
        )}
        {rows.map((a) => (
          <button
            key={a.id}
            className="stream-row t-lift"
            data-active={a.id === selectedId}
            onClick={() => onOpen(a.id)}
          >
            <div className="thread-top">
              <span className="badge badge-mute">{a.kind}</span>
              <span className="thread-when">{shortWhen(a.created_at)}</span>
            </div>
            <div className="thread-subject truncate">{a.summary}</div>
            {a.reversible ? (
              <span className="badge badge-success">undo available</span>
            ) : null}
          </button>
        ))}
      </div>
    </>
  );
}
