import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.js';

/**
 * Copilot — Millo, docked.
 *
 * Speaks over REST (`POST /v1/agent/runs`), not the WebSocket. The Stream view
 * already owns the socket, and two live sockets to the same Durable Object
 * would mean duplicated event delivery and a stream that shows every reply
 * twice. Both paths terminate in the same `executeTurn()` server-side, so this
 * is the same agent on a different transport, not a different agent.
 *
 * Docking rule: the composer is contextually aware but not contextually
 * presumptuous. A thread id is passed along so the run is attributable, but
 * the message body is *not* injected into the prompt automatically. Quietly
 * reading someone's mail on their behalf, because they clicked on it, is not a
 * thing an assistant should do unasked.
 */
export default function Copilot({ docked = false, threadId = null }) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState(null);
  const [error, setError] = useState(null);
  const inputRef = useRef(null);

  // A new thread means the last answer is about something else.
  useEffect(() => {
    setReply(null);
    setError(null);
  }, [threadId]);

  const send = useCallback(async () => {
    const content = value.trim();
    if (!content || busy) return;
    setBusy(true);
    setError(null);
    setValue('');
    try {
      const res = await api.run(content, threadId ? { thread_id: threadId } : undefined);
      setReply(res);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }, [value, busy, threadId]);

  if (!docked) {
    return (
      <div className="copilot-inline">
        <Composer
          value={value}
          setValue={setValue}
          onSend={send}
          busy={busy}
          inputRef={inputRef}
          placeholder="Ask Millo anything…"
        />
        {error ? <p className="copilot-error">{error.message}</p> : null}
        {reply ? <ReplyCard reply={reply} /> : null}
      </div>
    );
  }

  return (
    <div className="copilot-dock card-float">
      <div className="row copilot-head">
        <span className="ms copilot-mark" aria-hidden="true">auto_awesome</span>
        <span className="copilot-name">Millo</span>
        <div className="spacer" />
        {threadId ? <span className="badge badge-mute">this thread</span> : null}
      </div>

      {reply || error ? (
        <div className="copilot-reply scroll-silk">
          {error ? <p className="copilot-error">{error.message}</p> : <ReplyCard reply={reply} />}
        </div>
      ) : (
        <p className="copilot-hint">
          {threadId
            ? 'Ask about this message, or tell Millo what to do with it.'
            : 'Select a message, or just tell Millo what you need.'}
        </p>
      )}

      <Composer
        value={value}
        setValue={setValue}
        onSend={send}
        busy={busy}
        inputRef={inputRef}
        placeholder={threadId ? 'Ask about this thread…' : 'Ask Millo anything…'}
      />
    </div>
  );
}

function Composer({ value, setValue, onSend, busy, inputRef, placeholder }) {
  return (
    <div className="copilot-input">
      <textarea
        ref={inputRef}
        className="input"
        rows={1}
        value={value}
        placeholder={placeholder}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          // Enter sends, Shift+Enter breaks the line. The reverse is the more
          // common default and it makes multi-line prompts impossible.
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onSend();
          }
        }}
        aria-label="Message Millo"
      />
      <button
        className="btn btn-primary btn-icon"
        onClick={onSend}
        disabled={busy || !value.trim()}
        aria-label="Send"
        title={busy ? 'Working…' : 'Send'}
      >
        <span className="ms" aria-hidden="true">
          {busy ? 'hourglass_top' : 'arrow_upward'}
        </span>
      </button>
    </div>
  );
}

function ReplyCard({ reply }) {
  if (!reply) return null;
  const text =
    reply.output?.text ||
    reply.output?.summary ||
    reply.text ||
    (typeof reply.output === 'string' ? reply.output : '');

  return (
    <div className="copilot-answer">
      {text ? <p className="copilot-answer-text">{text}</p> : null}
      {reply.error ? <p className="copilot-error">{reply.error}</p> : null}
      {reply.stop_reason ? (
        <div className="row copilot-foot">
          <span className="badge badge-mute">{reply.stop_reason}</span>
          {reply.model ? <span className="thread-when">{reply.model}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
