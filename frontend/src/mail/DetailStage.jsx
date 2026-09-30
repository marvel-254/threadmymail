import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import Copilot from './Copilot.jsx';

/**
 * Detail for the non-mail views: a run, a skill, a plugin, a todo, an event.
 *
 * The row from the feed is passed in and rendered directly. Only the two views
 * with a real per-item endpoint — a run and a skill — ever fetch, and even then
 * only when the feed did not supply the row.
 *
 * That distinction is not a micro-optimisation. `/activity` and `/todos`
 * return arrays; there is no `GET /activity/:id`, so the previous version of
 * this component refetched the list, handed the array to `Object.entries`, and
 * rendered a numbered index down the left-hand column with `[object Object]`
 * on the right. Two of the six views could never have worked that way.
 */

/** Columns we never show: internal plumbing, or text the detail view renders itself. */
const HIDE = new Set([
  'id', 'user_id', 'created_at', 'updated_at', 'completed_at', 'undone_at',
  'instructions', 'notes', 'version', 'undo_ref', 'allowed_tools', 'dry_run_until',
  'budget', 'model_slot',
]);

const REFETCHABLE = new Set(['stream', 'skills']);

export default function DetailStage({ view, id, row, onBack, showBack }) {
  const [fetched, setFetched] = useState(null);
  const [state, setState] = useState('idle');

  // A new selection invalidates whatever was fetched for the previous one.
  useEffect(() => {
    setFetched(null);
    setState('idle');
  }, [id, view]);

  const data = row || fetched;

  const load = useCallback(async () => {
    if (!id || row || !REFETCHABLE.has(view)) return;
    setState('loading');
    try {
      setFetched(await fetchOne(view, id));
      setState('ready');
    } catch (e) {
      setFetched({ __error: e.message });
      setState('error');
    }
  }, [id, row, view]);

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
      {id && !data && state !== 'loading' && (
        <p className="feed-note">Nothing to show for that selection.</p>
      )}
      {id && !data && state === 'loading' && <p className="feed-note">Loading…</p>}
      {id && data?.__error && (
        <div className="reader-empty">
          <h3 className="reader-empty-title">Couldn&rsquo;t load that</h3>
          <p className="reader-empty-body">{data.__error}</p>
        </div>
      )}
      {id && data && !data.__error && <Fields view={view} row={data} />}

      {id ? <Copilot docked /> : null}
    </div>
  );
}

async function fetchOne(view, id) {
  if (view === 'stream') return api.run_(id);
  if (view === 'skills') return api.skill(id);
  return null;
}

function Fields({ view, row }) {
  const entries = Object.entries(row || {}).filter(
    ([k, v]) => !HIDE.has(k) && v !== null && v !== undefined && v !== '',
  );
  const heading = row.name || row.summary || row.tool || row.title;

  return (
    <div className="scroll-silk stage-scroll">
      {view === 'skills' && row.name ? (
        <>
          <h2 className="reader-subject">{row.name}</h2>
          {row.description ? <p className="reader-empty-body">{row.description}</p> : null}
        </>
      ) : null}

      {view === 'activity' && row.summary ? (
        <>
          <div className="row" style={{ gap: 8, marginBottom: 8 }}>
            <span className="badge badge-mute">{row.kind}</span>
            {row.reversible ? <span className="badge badge-success">reversible</span> : null}
          </div>
          <h2 className="reader-subject">{row.summary}</h2>
        </>
      ) : null}

      {view === 'today' && heading ? <h2 className="reader-subject">{heading}</h2> : null}

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

      {view === 'skills' && row.budget ? (
        <section className="card stage-ai">
          <div className="eyebrow">Budget</div>
          <p className="reader-ai-text">{render(row.budget)}</p>
        </section>
      ) : null}
    </div>
  );
}

function render(v) {
  if (typeof v === 'boolean') return v ? 'yes' : 'no';
  if (v === null || v === undefined) return '—';
  if (Array.isArray(v)) return v.length ? v.map(render).join(', ') : '—';
  if (typeof v === 'object') {
    // Triggers are { type, expr }; anything else falls back to JSON.
    if (v.type) return `${v.type}${v.expr ? ` ${v.expr}` : ''}`;
    return Object.entries(v)
      .map(([k, x]) => `${humanise(k)}: ${render(x)}`)
      .join(' · ');
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
    skills: 'Pick a skill to see its instructions, schedule and settings.',
    plugins: 'Pick a plugin to review what it is allowed to reach.',
  };
  return (
    <div className="reader-empty">
      <h3 className="reader-empty-title">Nothing selected</h3>
      <p className="reader-empty-body">{copy[view] || 'Pick something from the list.'}</p>
    </div>
  );
}
