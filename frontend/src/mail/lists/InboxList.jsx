import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../lib/api.js';
import { FeedHeader, FilterWell, EmptyFeed, shortWhen } from '../ThreadFeed.jsx';

/**
 * The mail list.
 *
 * Row treatment follows the spec exactly, because the read/unread difference is
 * doing real work here:
 *   unread → extruded, with a glowing micro-bar on the left edge
 *   read   → flattened to canvas grade so it stops competing for attention
 *
 * Flattening read rows rather than dimming them is deliberate. Opacity on dark
 * surfaces drops contrast below the readable floor, and a mail client where you
 * cannot comfortably read half the list is worse than one with a louder list.
 */

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'primary', label: 'Primary' },
  { id: 'unread', label: 'Unread' },
  { id: 'starred', label: 'Starred' },
];

export default function InboxList({ selectedId, onOpen, connected }) {
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState(connected === false ? 'idle' : 'loading');
  const [error, setError] = useState(null);
  const [cat, setCat] = useState('all');
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    setState((s) => (s === 'ready' ? 'refreshing' : 'loading'));
    try {
      const res = await api.emails({
        limit: 50,
        ...(cat === 'unread' ? { unread: true } : {}),
        ...(q ? { q } : {}),
      });
      const list = Array.isArray(res) ? res : res?.items || [];
      setItems(list);
      setTotal(res?.total ?? list.length);
      setError(null);
      setState('ready');
    } catch (e) {
      // NEEDS_CONNECTION is the pre-OAuth steady state, not a failure. It gets
      // a quiet empty state instead of an error banner.
      if (e instanceof ApiError && (e.code === 'NEEDS_CONNECTION' || e.code === 'NEEDS_REAUTH')) {
        setItems([]);
        setError(null);
        setState('idle');
        return;
      }
      setError(e);
      setState('error');
    }
  }, [cat, q]);

  useEffect(() => {
    load();
  }, [load]);

  const selected = useMemo(
    () => items.find((i) => i.id === selectedId) || null,
    [items, selectedId],
  );

  if (state === 'error') {
    return (
      <>
        <FeedHeader title="Inbox" />
        <EmptyFeed
          icon="cloud_off"
          title="Can't reach the mail service"
          body={error?.message || 'The request failed. The assistant may still work.'}
          action={
            <button className="btn btn-secondary" onClick={load}>
              Try again
            </button>
          }
        />
      </>
    );
  }

  return (
    <>
      <FeedHeader title="Inbox" meta={total ? String(total) : undefined} />

      <FilterWell>
        <div className="row filter-row">
          <span className="ms filter-icon" aria-hidden="true">search</span>
          <input
            className="feed-search"
            type="search"
            placeholder="Search mail"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Search mail"
          />
        </div>
      </FilterWell>

      <div className="chip-row" role="tablist" aria-label="Filter">
        {CATEGORIES.map((c) => (
          <button
            key={c.id}
            className="chip"
            data-active={cat === c.id}
            onClick={() => setCat(c.id)}
            role="tab"
            aria-selected={cat === c.id}
          >
            {c.label}
          </button>
        ))}
      </div>

      <div className="scroll-silk feed-scroll">
        {state === 'loading' && <FeedSkeleton />}

        {state !== 'loading' && items.length === 0 && (
          <EmptyFeed
            icon="inbox"
            title="Nothing here"
            body={
              cat === 'all' && !q
                ? 'No mail has been synced. Connect an account and Millo will start triaging.'
                : 'No messages match this filter.'
            }
          />
        )}

        {items.map((m) => (
          <ThreadRow
            key={m.id}
            mail={m}
            active={m.id === selectedId}
            onOpen={onOpen}
          />
        ))}
      </div>
    </>
  );
}

function ThreadRow({ mail, active, onOpen }) {
  const unread = mail.is_read === false || mail.unread === true;
  const from = mail.from_name || mail.from || mail.sender || 'Unknown sender';
  const subject = mail.subject || mail.snippet || '(no subject)';

  return (
    <button
      className="thread-row t-lift"
      data-unread={unread}
      data-active={active}
      onClick={() => onOpen(mail.id)}
      aria-current={active ? 'true' : undefined}
    >
      <div className="thread-top">
        <span className="thread-from truncate">{from}</span>
        <span className="thread-when">{shortWhen(mail.received_at || mail.date || mail.created_at)}</span>
      </div>
      <div className="thread-subject truncate">{subject}</div>
      {mail.snippet ? <div className="thread-snippet truncate">{mail.snippet}</div> : null}
      {mail.labels?.length ? (
        <div className="thread-labels">
          {mail.labels.slice(0, 3).map((l) => (
            <span key={l} className="badge badge-mute">
              {l}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
}

/**
 * Skeleton rows. Shaped like real rows on purpose — a generic spinner reads as
 * "slow", whereas rows that fill in place read as "loading your mail", which
 * is what is actually happening.
 */
export function FeedSkeleton({ rows = 6 }) {
  return (
    <div className="skeleton-stack" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div className="thread-row skeleton" key={i} style={{ opacity: 1 - i * 0.13 }}>
          <div className="skeleton-line w-40" />
          <div className="skeleton-line w-80" />
          <div className="skeleton-line w-60" />
        </div>
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}
