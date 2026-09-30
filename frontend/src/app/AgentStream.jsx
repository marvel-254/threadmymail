/**
 * AgentStream — the conversation surface.
 *
 * The agent is the app: this is the primary pane. Tool calls are shown inline
 * (not hidden) because "what did it just do?" is the single most important
 * question an autonomous system has to answer honestly.
 *
 * The layout follows the agent dashboard design: a status header, a row of
 * counters, the transcript, and a composer. Three things about it are not
 * literal, and deliberately so:
 *
 *  - The counters count real events in this session. The design's chips read
 *    "Processed / Urgent / Drafts Ready"; there is no notion of an urgent
 *    message or a ready draft anywhere in the system, so claiming either would
 *    be a number with nothing behind it. Runs, tool calls and tokens are
 *    counted from what actually arrived over the socket.
 *  - The approval card is the escalation, not a send-approval. The design's
 *    version reads "Approve & Send / Edit Draft / Schedule", which presumes an
 *    outbox this build has no scope to touch — the OAuth grant is read-only.
 *    What the agent genuinely needs a decision on is its own escalation, so
 *    that is what the card is for.
 *  - Clicking a choice sends it as a message. There is no answer channel on the
 *    socket; the agent reads the user's next message as the reply, so a choice
 *    is a prefill that actually sends.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AgentStream as AgentStreamClient, cryptoId } from '../lib/ws.js';
import { api } from '../lib/api.js';
import ArtifactFrame from './ArtifactFrame.jsx';
import { IconSend, IconKill, IconStream } from './Icons.jsx';

const STATUS_LABEL = {
  idle: 'not connected',
  connecting: 'connecting…',
  open: 'live',
  offline: 'offline — retrying',
};

const QUICK_INTENTS = [
  "What's waiting on me?",
  "Summarize today's mail",
  'Find 30 minutes with Dana next week',
  'What did I promise this week?',
];

export default function AgentStream({ theme, onOpenSettings }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [status, setStatus] = useState('idle');
  const [activeRun, setActiveRun] = useState(null);
  const [artifacts, setArtifacts] = useState([]);
  const [error, setError] = useState(null);
  const clientRef = useRef(null);
  const scrollRef = useRef(null);
  const [backendMissing, setBackendMissing] = useState(false);
  const [sent, setSent] = useState(0);

  // Derived from the transcript, never from a separate poll: the socket is the
  // only place run results exist, so counting the events we already received is
  // both cheaper and more accurate than asking the API how many there were.
  const tally = useMemo(() => {
    let runs = 0;
    let calls = 0;
    let tokens = 0;
    for (const m of messages) {
      if (m.kind === 'done') {
        runs += 1;
        tokens += Number(m.tokens) || 0;
      } else if (m.kind === 'tool_call') {
        calls += 1;
      }
    }
    return { runs, calls, tokens };
  }, [messages]);

  useEffect(() => {
    const client = new AgentStreamClient();
    clientRef.current = client;

    const on = (type, handler) => client.addEventListener(type, handler);

    on('status', (e) => setStatus(e.detail));
    on('open', () => setError(null));

    on('token', (e) => {
      const { run_id: runId, text } = e.detail;
      setActiveRun(runId);
      setMessages((prev) => appendToken(prev, runId, text));
    });

    on('tool_call', (e) => {
      setMessages((prev) => appendEvent(prev, e.detail, 'tool_call'));
    });

    on('tool_result', (e) => {
      setMessages((prev) => appendEvent(prev, e.detail, 'tool_result'));
    });

    on('escalation', (e) => {
      setMessages((prev) => appendEvent(prev, e.detail, 'escalation'));
    });

    // Artifacts render inline in the stream. The frame carries only an id; the
    // HTML itself is fetched so a hostile payload never arrives over the socket.
    on('artifact', (e) => {
      const { artifact_id: id, run_id: runId } = e.detail;
      if (!id) return;
      api.artifact(id)
        .then((artifact) => {
          if (!artifact) return;
          setArtifacts((prev) => [
            ...prev.filter((a) => a.id !== id),
            { ...artifact, id, runId },
          ]);
        })
        .catch(() => {
          setError(`Could not load artifact ${id}.`);
        });
    });

    on('error', (e) => {
      const { code, message } = e.detail;
      setError(message || code);
      if (code === 'INTERNAL') setBackendMissing(true);
      setActiveRun(null);
    });

    on('done', (e) => {
      setActiveRun(null);
      setMessages((prev) => appendEvent(prev, e.detail, 'done'));
    });

    client.connect();
    return () => client.close();
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  function send(event, override) {
    event?.preventDefault();
    const text = (override ?? input).trim();
    if (!text) return;
    setInput('');
    setError(null);
    setSent((n) => n + 1);
    setMessages((prev) => [...prev, { kind: 'user', text, at: Date.now() }]);
    const ok = clientRef.current?.sendMessage(text);
    if (!ok) {
      setBackendMissing(true);
      setError('Not connected to the agent. The Worker may not be deployed yet.');
    }
  }

  async function interrupt() {
    if (activeRun) {
      clientRef.current?.interrupt(activeRun);
      setActiveRun(null);
    }
  }

  async function onMutated({ verb }) {
    // The agent needs to know the user acted. Per docs/AI-SKILLS.md §7.2 the
    // binding write is also an event to the agent.
    try {
      if (!clientRef.current?.sendMessage) return;
      clientRef.current.send({
        type: 'message',
        id: cryptoId(),
        content: `[user action] ${verb} applied in the UI`,
        meta: { source: 'artifact_binding', verb },
      });
    } catch {
      /* non-fatal */
    }
  }

  return (
    <section className="stage stage-ai" aria-label="Agent stream">
      <header className="stage__head">
        <div className="stage__who">
          <span className="stage__mark" aria-hidden="true">
            <IconStream size={16} />
          </span>
          <div className="col">
            <h2 className="stage__name">Millo</h2>
            <span className={`status status-${status}`}>
              {STATUS_LABEL[status]}
            </span>
          </div>
        </div>
        <div className="stage__tools">
          {activeRun && (
            <button className="btn btn-ghost btn-sm" onClick={interrupt}>
              <IconKill size={15} /> Stop
            </button>
          )}
          <button className="btn btn-ghost btn-sm" onClick={onOpenSettings}>
            Autonomy
          </button>
        </div>
      </header>

      <div className="chip-row stage__stats" role="group" aria-label="Session counters">
        <span className="badge badge-mute">
          <span className="strong">{tally.runs}</span> {plural(tally.runs, 'run')}
        </span>
        <span className="badge badge-mute">
          <span className="strong">{tally.calls}</span> tool{' '}
          {plural(tally.calls, 'call')}
        </span>
        <span className="badge badge-mute">
          <span className="strong">{tally.tokens.toLocaleString()}</span> tokens
        </span>
        {sent > 0 && (
          <span className="badge badge-mute">
            <span className="strong">{sent}</span> sent
          </span>
        )}
      </div>

      {backendMissing && (
        <div className="notice" role="status">
          <strong>Cannot reach the agent.</strong> The Worker is not answering on the
          WebSocket. Everything below stays wired and reconnects on its own.
        </div>
      )}

      <div className="stage-scroll scroll-silk" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="feed-empty">
            <p className="feed-empty-title">Ask for something</p>
            <p className="feed-empty-body">
              The agent reads, acts, and reports back. Every tool call it makes is
              shown here as it happens.
            </p>
            <ul className="intents">
              <li className="intents__label">
                <span className="eyebrow">Quick intents</span>
              </li>
              {QUICK_INTENTS.map((s) => (
                <li key={s}>
                  <button
                    className="chip"
                    data-active={input === s}
                    onClick={() => setInput(s)}
                  >
                    <span className="ms" aria-hidden="true">
                      bolt
                    </span>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m, i) => (
          <Message key={m.id || i} message={m} onAnswer={(c) => send(null, c)} />
        ))}

        {artifacts.map((a) => (
          <ArtifactFrame
            key={a.id}
            artifact={a}
            theme={theme}
            onMutated={onMutated}
          />
        ))}
      </div>

      <form className="composer" onSubmit={send}>
        <input
          className="input composer__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent, or tell it to do something…"
          aria-label="Message the agent"
          disabled={status !== 'open'}
        />
        <button
          className="btn btn-primary composer__send"
          type="submit"
          disabled={!input.trim()}
        >
          <IconSend size={15} />
          <span className="sr-only">Send</span>
        </button>
      </form>

      {error && (
        <p className="stream-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

export function Message({ message, onAnswer }) {
  if (message.kind === 'user') {
    return (
      <div className="say say-user">
        <p>{message.text}</p>
      </div>
    );
  }

  if (message.kind === 'agent') {
    return (
      <div className="say say-agent">
        <p>{message.text}</p>
      </div>
    );
  }

  // The approval card from the agent dashboard, wired to the one real decision
  // the agent can hand back. It used to render inert buttons, so a user who
  // tapped one got silence and no indication anything had been sent.
  if (message.kind === 'escalation') {
    const choices = message.choices?.length ? message.choices : ['yes', 'no'];
    return (
      <div className="approval" role="group" aria-label="The agent needs a decision">
        <div className="approval__head">
          <span className="approval__mark" aria-hidden="true">
            <span className="ms">priority_high</span>
          </span>
          <strong className="approval__title">Needs your answer</strong>
        </div>
        <p className="approval__question">{message.question}</p>
        {message.context && (
          <p className="approval__context">{message.context}</p>
        )}
        <div className="approval__actions">
          {choices.map((c, i) => (
            <button
              key={c}
              className={`btn btn-sm ${i === 0 ? 'btn-primary' : 'btn-secondary'}`}
              onClick={() => onAnswer?.(c)}
            >
              {c}
            </button>
          ))}
        </div>
        <p className="approval__hint">
          Choosing one sends it as your reply. The agent is waiting.
        </p>
      </div>
    );
  }

  if (message.kind === 'tool_call') {
    return (
      <details className="call">
        <summary>
          <span className="call__name">{message.tool}</span>
          <span className="call__meta">called</span>
        </summary>
        <pre className="call__args">{formatArgs(message.args)}</pre>
      </details>
    );
  }

  if (message.kind === 'tool_result') {
    return (
      <div className="result" data-ok={message.ok ? 'true' : 'false'}>
        <span className="result__summary">
          {message.ok ? message.summary || 'ok' : 'failed'}
        </span>
        {message.latency_ms != null && (
          <span className="result__meta">{message.latency_ms}ms</span>
        )}
      </div>
    );
  }

  if (message.kind === 'done') {
    return (
      <div className="tick">
        <span className="ms" aria-hidden="true">
          check_circle
        </span>
        run complete · {message.tokens ?? 0} tokens
        {message.cost_usd != null && ` · $${Number(message.cost_usd).toFixed(4)}`}
      </div>
    );
  }

  return null;
}

function plural(n, word) {
  return n === 1 ? word : `${word}s`;
}

function formatArgs(args) {
  if (!args || typeof args !== 'object') return '';
  const text = JSON.stringify(args, null, 2);
  return text.length > 400 ? `${text.slice(0, 400)}…` : text;
}

let seq = 0;
function appendToken(prev, runId, text) {
  const last = prev[prev.length - 1];
  if (last?.kind === 'agent' && last.runId === runId) {
    const copy = prev.slice(0, -1);
    copy.push({ ...last, text: last.text + text });
    return copy;
  }
  return [...prev, { kind: 'agent', runId, text: text || '', id: `a${seq++}` }];
}

function appendEvent(prev, detail, kind) {
  return [
    ...prev,
    {
      id: `m${seq++}`,
      kind,
      runId: detail.run_id,
      ...detail,
    },
  ];
}
