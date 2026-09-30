import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { FeedHeader, EmptyFeed, shortWhen } from '../ThreadFeed.jsx';

/**
 * The stream is the agent's own running commentary: what it decided, what it
 * called, what it changed. Listed here so a run can be opened on the right.
 */
export default function StreamList({ selectedId, onOpen }) {
  const [runs, setRuns] = useState([]);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await api.runs({ limit: 40 });
      const list = Array.isArray(res) ? res : res?.items || [];
      setRuns(list);
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
      <FeedHeader title="Stream" meta={runs.length ? String(runs.length) : undefined} />
      <div className="scroll-silk feed-scroll">
        {state === 'loading' && <p className="feed-note">Loading…</p>}
        {state === 'error' && (
          <EmptyFeed icon="cloud_off" title="Can't reach the agent" body="The Worker did not respond." />
        )}
        {state === 'ready' && runs.length === 0 && (
          <EmptyFeed
            icon="stream"
            title="Nothing yet"
            body="Runs appear here the moment Millo starts working. Ask it something, or let a scheduled skill fire."
          />
        )}
        {runs.map((r) => (
          <button
            key={r.id}
            className="stream-row t-lift"
            data-active={r.id === selectedId}
            onClick={() => onOpen(r.id)}
          >
            <div className="thread-top">
              <span className={`badge ${statusTone(r.status)}`}>{r.status || 'done'}</span>
              <span className="thread-when">{shortWhen(r.started_at || r.created_at)}</span>
            </div>
            <div className="thread-subject truncate">
              {r.content || r.input?.content || 'Agent run'}
            </div>
            {r.model ? <div className="thread-snippet truncate">{r.model}</div> : null}
          </button>
        ))}
      </div>
    </>
  );
}

export function statusTone(status) {
  if (status === 'error' || status === 'aborted') return 'badge badge-danger';
  if (status === 'running' || status === 'pending') return 'badge badge-accent';
  if (status === 'done' || status === 'completed') return 'badge badge-success';
  return 'badge badge-mute';
}
