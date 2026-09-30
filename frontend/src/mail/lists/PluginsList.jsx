import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { FeedHeader, EmptyFeed } from '../ThreadFeed.jsx';

/** Plugins: capabilities Millo can be given beyond the built-in tools. */
export default function PluginsList({ selectedId, onOpen }) {
  const [items, setItems] = useState([]);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const res = await api.plugins();
      setItems(Array.isArray(res) ? res : res?.items || []);
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
      <FeedHeader title="Plugins" meta={items.length ? String(items.length) : undefined} />
      <div className="scroll-silk feed-scroll">
        {state === 'loading' && <p className="feed-note">Loading…</p>}
        {state === 'error' && (
          <EmptyFeed icon="cloud_off" title="Can't load plugins" body="The Worker did not respond." />
        )}
        {state === 'ready' && items.length === 0 && (
          <EmptyFeed
            icon="extension"
            title="No plugins installed"
            body="Plugins extend what Millo can reach. Each one asks for specific permissions, and you can revoke them at any time."
          />
        )}
        {items.map((p) => (
          <button
            key={p.id}
            className="stream-row t-lift"
            data-active={p.id === selectedId}
            onClick={() => onOpen(p.id)}
          >
            <div className="thread-top">
              <span className="ms skill-trigger" aria-hidden="true">extension</span>
              <span className="thread-from truncate">{p.name || p.plugin_id}</span>
              {p.enabled === false ? <span className="badge badge-mute">off</span> : null}
            </div>
            {p.description ? <div className="thread-snippet truncate">{p.description}</div> : null}
          </button>
        ))}
      </div>
    </>
  );
}
