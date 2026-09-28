/**
 * AgentStream — the conversation surface.
 *
 * The agent is the app: this is the primary pane. Tool calls are shown inline
 * (not hidden) because "what did it just do?" is the single most important
 * question an autonomous system has to answer honestly.
 */
import { useEffect, useRef, useState } from 'react';
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

  function send(event) {
    event?.preventDefault();
    const text = input.trim();
    if (!text) return;
    setInput('');
    setError(null);
    setMessages((prev) => [...prev, { kind: 'user', text, at: Date.now() }]);
    const ok = clientRef.current?.sendMessage(text);
    if (!ok) {
      setBackendMissing(true);
      setError('Not connected to the agent yet. Phase 0 is not deployed.');
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
    <section className="pane pane-stream" aria-label="Agent stream">
      <header className="pane-head">
        <h2>
          <IconStream size={18} /> Agent
        </h2>
        <div className="pane-head-actions">
          <span className={`status status-${status}`}>{STATUS_LABEL[status]}</span>
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

      {backendMissing && (
        <div className="notice" role="status">
          <strong>Backend not deployed yet.</strong> Phase 0 (Worker + Neon) hasn&apos;t
          run — see <code>docs/PLAN.md</code>. The interface below is fully wired and
          will connect as soon as the Worker exists.
        </div>
      )}

      <div className="stream-scroll" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="stream-empty">
            <p>Ask for something. The agent reads, acts, and reports back.</p>
            <ul className="stream-suggestions">
              {[
                "What's waiting on me?",
                "Summarize today's mail",
                'Find 30 minutes with Dana next week',
                'What did I promise this week?',
              ].map((s) => (
                <li key={s}>
                  <button className="btn btn-ghost btn-sm" onClick={() => setInput(s)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {messages.map((m, i) => (
          <Message key={m.id || i} message={m} />
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
          className="composer-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the agent, or tell it to do something…"
          aria-label="Message the agent"
          disabled={status !== 'open'}
        />
        <button className="btn btn-primary btn-sm" type="submit" disabled={!input.trim()}>
          <IconSend size={15} /> Send
        </button>
      </form>

      {error && <p className="stream-error">{error}</p>}
    </section>
  );
}

function Message({ message }) {
  if (message.kind === 'user') {
    return (
      <div className="msg msg-user">
        <p>{message.text}</p>
      </div>
    );
  }

  if (message.kind === 'agent') {
    return (
      <div className="msg msg-agent">
        <p>{message.text}</p>
      </div>
    );
  }

  if (message.kind === 'escalation') {
    return (
      <div className="msg msg-escalation" role="alertdialog">
        <strong>The agent is asking.</strong>
        <p>{message.question}</p>
        <div className="msg-actions">
          {(message.choices || ['yes', 'no']).map((c) => (
            <button key={c} className="btn btn-ghost btn-sm">
              {c}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (message.kind === 'tool_call') {
    return (
      <div className="msg msg-tool">
        <span className="tool-name">{message.tool}</span>
        <pre className="tool-args">{formatArgs(message.args)}</pre>
      </div>
    );
  }

  if (message.kind === 'tool_result') {
    return (
      <div className={`msg msg-tool-result ${message.ok ? '' : 'is-error'}`}>
        <span className="tool-summary">
          {message.ok ? message.summary || 'ok' : 'failed'}
        </span>
        {message.latency_ms != null && (
          <span className="tool-meta">{message.latency_ms}ms</span>
        )}
      </div>
    );
  }

  if (message.kind === 'done') {
    return (
      <div className="msg msg-done">
        run complete · {message.tokens ?? 0} tokens
        {message.cost_usd != null && ` · $${Number(message.cost_usd).toFixed(4)}`}
      </div>
    );
  }

  return null;
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
