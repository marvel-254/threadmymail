/**
 * ThreadFeed — the middle pane.
 *
 * For `inbox` this is the mail list. For every other view it is that view's own
 * list, so the three-pane rhythm is constant: whatever you select in the rail
 * gets a list here and a working surface on the right. A shell that changes
 * its whole layout per nav item is disorienting and was the main flaw in the
 * pane-based version this replaces.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import InboxList from './lists/InboxList.jsx';
import StreamList from './lists/StreamList.jsx';
import TodayList from './lists/TodayList.jsx';
import ActivityList from './lists/ActivityList.jsx';
import SkillsList from './lists/SkillsList.jsx';
import PluginsList from './lists/PluginsList.jsx';
import ConnectPrompt from './ConnectPrompt.jsx';

const LISTS = {
  inbox: InboxList,
  stream: StreamList,
  today: TodayList,
  activity: ActivityList,
  skills: SkillsList,
  plugins: PluginsList,
};

export default function ThreadFeed({ view, selectedId, onOpenThread, onBack, showBack }) {
  const List = LISTS[view] || InboxList;
  const [connected, setConnected] = useState(null); // null = not yet known

  const checkConnection = useCallback(() => {
    api.syncStatus()
      .then((s) => setConnected(Boolean(s && s.connected)))
      .catch(() => setConnected(false));
  }, []);

  useEffect(checkConnection, [checkConnection]);

  // Mail is the one view that is impossible without a provider, so the connect
  // state is a first-class screen rather than an empty list.
  const needsConnection = view === 'inbox' && connected === false;

  return (
    <section className="feed t-plane" aria-label={view}>
      {showBack && (
        <button className="btn-ghost feed-back" onClick={onBack} aria-label="Back">
          <span className="ms" aria-hidden="true">arrow_back</span>
        </button>
      )}
      {needsConnection ? (
        <ConnectPrompt onConnected={checkConnection} />
      ) : (
        <List
          selectedId={selectedId}
          onOpen={onOpenThread}
          connected={connected}
          onRecheck={checkConnection}
        />
      )}
    </section>
  );
}

/**
 * Shared mail-shaped chrome for a feed: a title row plus optional filter chips.
 * Extracted because six lists all need it and none of them should be inventing
 * their own padding.
 */
export function FeedHeader({ title, meta, children }) {
  return (
    <header className="feed-header">
      <div className="row">
        <h2 className="feed-title">{title}</h2>
        {meta ? <span className="feed-meta">{meta}</span> : null}
      </div>
      {children}
    </header>
  );
}

/**
 * Recessed well used for every list filter. The inset shadow is what makes it
 * read as a slot the content sits in rather than a box drawn on the canvas.
 */
export function FilterWell({ children }) {
  return <div className="filter-well t-well">{children}</div>;
}

export function EmptyFeed({ icon = 'inbox', title, body, action }) {
  return (
    <div className="feed-empty">
      <div className="feed-empty-icon t-well">
        <span className="ms" aria-hidden="true">{icon}</span>
      </div>
      <h3 className="feed-empty-title">{title}</h3>
      {body ? <p className="feed-empty-body">{body}</p> : null}
      {action}
    </div>
  );
}

/** Stable relative-ish timestamp. Avoids a date library for one function. */
export function shortWhen(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
