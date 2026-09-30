import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../lib/api.js';
import Copilot from './Copilot.jsx';
import { FeedSkeleton } from './lists/InboxList.jsx';

/**
 * Reader — a single thread.
 *
 * Two states, not three. Either a message is open, or it is not. When nothing
 * is selected the pane shows the "ask Millo" surface rather than a placeholder,
 * because an empty 60%-of-the-screen next to a list is the most wasted real
 * estate in any mail client.
 */
export default function Reader({ id, onBack, showBack }) {
  const [thread, setThread] = useState(null);
  const [state, setState] = useState('idle');
  const [error, setError] = useState(null);

  const load = useCallback(async (mailId) => {
    setState('loading');
    setError(null);
    try {
      const res = await api.emailThread(mailId);
      setThread(normalise(res, mailId));
      setState('ready');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'NEEDS_CONNECTION') {
        setState('disconnected');
        return;
      }
      setError(e);
      setState('error');
    }
  }, []);

  useEffect(() => {
    if (id) load(id);
    else setThread(null);
  }, [id, load]);

  if (!id) return <Copilot docked />;

  if (state === 'loading') {
    return (
      <div className="reader">
        <FeedSkeleton rows={4} />
      </div>
    );
  }

  if (state === 'disconnected') {
    return (
      <div className="reader-empty">
        <h3 className="reader-empty-title">Mail isn&rsquo;t connected</h3>
        <p className="reader-empty-body">
          This message can&rsquo;t be loaded until a Google account is linked.
        </p>
      </div>
    );
  }

  if (state === 'error' || !thread) {
    return (
      <div className="reader-empty">
        <h3 className="reader-empty-title">Couldn&rsquo;t open that</h3>
        <p className="reader-empty-body">
          {error?.message || 'The message could not be loaded.'}
        </p>
        <button className="btn btn-secondary" onClick={() => load(id)}>
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className="reader">
      {showBack && (
        <button className="btn-ghost reader-back" onClick={onBack} aria-label="Back to list">
          <span className="ms" aria-hidden="true">arrow_back</span>
        </button>
      )}

      <header className="reader-head">
        <h2 className="reader-subject">{thread.subject}</h2>
        <div className="reader-meta">
          <span className="reader-from">{thread.from}</span>
          <span className="dot-sep" aria-hidden="true">·</span>
          <span>{thread.when}</span>
        </div>
        <div className="reader-actions">
          <button
            className="btn btn-secondary"
            onClick={() => act(id, 'archive')}
            title="Archive"
          >
            <span className="ms" aria-hidden="true">archive</span>
            Archive
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => act(id, 'read')}
            title={thread.is_read ? 'Mark unread' : 'Mark read'}
          >
            <span className="ms" aria-hidden="true">
              {thread.is_read ? 'mark_as_unread' : 'mark_email_read'}
            </span>
            {thread.is_read ? 'Unread' : 'Read'}
          </button>
        </div>
      </header>

      {/*
        The AI summary card. Only rendered when the server actually sent one —
        an invented summary on an email client is a lie with a very confident
        font, so there is no placeholder copy here at all.
      */}
      {thread.summary ? (
        <section className="card-ai reader-ai">
          <div className="row">
            <span className="ms ai-mark" aria-hidden="true">auto_awesome</span>
            <span className="eyebrow">M&rsquo;s read</span>
          </div>
          <p className="reader-ai-text">{thread.summary}</p>
          {thread.actions?.length ? (
            <div className="chip-row">
              {thread.actions.map((a) => (
                <span className="chip" key={a}>{a}</span>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      <div className="reader-body scroll-silk">
        {thread.messages.map((m, i) => (
          <article className="bubble" key={m.id || i} data-mine={m.mine || false}>
            {thread.messages.length > 1 && (
              <div className="bubble-head">
                <span className="bubble-from">{m.from}</span>
                <span className="thread-when">{m.when}</span>
              </div>
            )}
            <div className="bubble-text">{m.text}</div>
          </article>
        ))}
      </div>

      <Copilot docked threadId={id} />
    </div>
  );
}

async function act(id, what) {
  try {
    if (what === 'archive') await api.archiveEmail(id);
    else await api.markRead(id);
  } catch {
    // Deliberately silent. The row does not optimistically move, so a failure
    // leaves the UI truthful; an error banner over a mail body is noise.
  }
}

/**
 * `/emails/:id/thread` has no fixed contract yet, so this accepts either a
 * thread envelope or a bare message and produces one shape. Guessing wrong
 * here would throw on every message; guessing defensively costs four lines.
 */
function normalise(res, mailId) {
  if (Array.isArray(res)) {
    const first = res[0] || {};
    return {
      id: first.id || mailId,
      subject: first.subject || '(no subject)',
      from: first.from_name || first.from || 'Unknown sender',
      when: fmt(first.received_at || first.date || first.created_at),
      is_read: first.is_read !== false,
      summary: first.ai_summary || first.summary || '',
      actions: first.suggested_actions || [],
      messages: res.map((m) => ({
        id: m.id,
        from: m.from_name || m.from || 'Unknown sender',
        when: fmt(m.received_at || m.date || m.created_at),
        text: m.body_text || m.snippet || m.body || '',
        mine: Boolean(m.mine),
      })),
    };
  }

  const m = res || {};
  return {
    id: m.id || mailId,
    subject: m.subject || '(no subject)',
    from: m.from_name || m.from || 'Unknown sender',
    when: fmt(m.received_at || m.date || m.created_at),
    is_read: m.is_read !== false,
    summary: m.ai_summary || m.summary || '',
    actions: m.suggested_actions || [],
    messages: [
      {
        id: m.id || mailId,
        from: m.from_name || m.from || 'Unknown sender',
        when: fmt(m.received_at || m.date || m.created_at),
        text: m.body_text || m.snippet || m.body || '',
        mine: false,
      },
    ],
  };
}

function fmt(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
