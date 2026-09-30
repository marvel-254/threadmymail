import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Copilot from './Copilot.jsx';

/**
 * Detail for the non-mail views: a run, a skill, a todo, a day.
 *
 * One generic surface rather than five bespoke ones. The feed already
 * distinguishes the rows; the pane behind it is the same job — show the
 * selected thing, and keep Millo reachable while you look at it.
 */
export default function DetailStage({ view, id, onBack, showBack }) {
  const [row, setRow] = useState(null);
  const [state, setState] = useState('idle');

  const load = useCallback(async () => {
    if (!id) {
      setRow(null);
      setState('idle');
      return;
    }
    setState('loading');
    try {
      const res = await fetchOne(view, id);
      setRow(res);
      setState('ready');
    } catch (e) {
      setRow({ __error: e.message });
      setState('error');
    }
  }, [view, id]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="stage detail">
      {showBack && (
        <button className="btn-ghost stage-back" onClick={onBack} aria-label="Back">
          <span className="ms" aria-hidden="true">arrow_back</span>
        </button>
      )}

      {!id && <NothingSelected view={view} />}

      {id && state === 'loading' && <p className="feed-note">Loading…</p>}

      {id && state === 'error' && (
        <div className="reader-empty">
          <h3 className="reader-empty-title">Couldn&rsquo;t load that</h3>
          <p className="reader-empty-body">{row?.__error}</p>
        </div>
      )}

      {id && state === 'ready' && row && <Fields view={view} row={row} />}

      {id && <Copilot docked />}
    </div>
  );
}

async function fetchOne(view, id) {
  switch (view) {
    case 'stream': return api.run_(id);
    case 'skills': return api.skill(id);
    case 'plugins': return api.tool(id);
    case 'today': return api.todos({ limit: 100 });
    case 'activity': return api.activity({ limit: 100 });
    default: return null;
  }
}

const SKIP = new Set([
  'id', 'user_id', 'created_at', 'updated_at', 'completed_at', 'undone_at',
  'instructions', 'notes', 'version', 'undo_ref', 'allowed_tools', 'dry_run_until',
]);

function Fields({ view, row }) {
  const entries = Object.entries(row || {}).filter(
    ([k, v]) => !SKIP.has(k) && v !== null && v !== undefined && v !== '',
  );
  if (!entries.length) return <p className="feed-note">No details to show.</p>;

  return (
    <div className="scroll-silk stage-scroll">
      {view === 'skills' && row.name ? <h2 className="reader-subject">{row.name}</h2> : null}
      {view === 'skills' && row.description ? (
        <p className="reader-empty-body">{row.description}</p>
      ) : null}

      <dl className="fields">
        {entries.map(([k, v]) => (
          <div className="field-row" key={k}>
            <dt className="field-key">{humanise(k)}</dt>
            <dd className="field-val">{render(v)}</dd>
          </div>
        ))}
      </dl>

      {row.instructions ? (
        <section className="card-ai stage-ai">
          <div className="eyebrow">Instructions</div>
          <p className="reader-ai-text">{row.instructions}</p>
        </section>
      ) : null}
    </div>
  );
}

function render(v) {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (Array.isArray(v)) return v.length ? v.map((x) => render(x)).join(', ') : '—';
  if (typeof v === 'object') {
    if (v.type) return `${v.type}${v.expr ? ` ${v.expr}` : ''}`;
    return JSON.stringify(v);
  }
  return String(v);
}

function humanise(k) {
  return k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

function NothingSelected({ view }) {
  const copy = {
    stream: 'Pick a run to read what Millo did, step by step.',
    today: 'Pick an event or a task to work on it.',
    activity: 'Pick an action to see exactly what changed.',
    skills: 'Pick a skill to see its instructions, schedule and recent runs.',
    plugins: 'Pick a plugin to review what it can reach.',
  };
  return (
    <div className="reader-empty">
      <h3 className="reader-empty-title">Nothing selected</h3>
      <p className="reader-empty-body">{copy[view] || 'Pick something from the list.'}</p>
    </div>
  );
}
