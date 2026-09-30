import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { FeedHeader, EmptyFeed, shortWhen } from '../ThreadFeed.jsx';

const TRIGGER_ICON = {
  on_demand: 'pan_tool',
  cron: 'schedule',
  event: 'bolt',
  digest: 'summarize',
};

/** Skills: what Millo is allowed to do, and when it will do it unasked. */
export default function SkillsList({ selectedId, onOpen }) {
  const [skills, setSkills] = useState([]);
  const [schedule, setSchedule] = useState(null);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    setState('loading');
    const [sk, sch] = await Promise.allSettled([api.skills(), api.schedule()]);
    setSkills(sk.status === 'fulfilled' ? (sk.value?.items || sk.value || []) : []);
    if (sch.status === 'fulfilled') setSchedule(sch.value);
    setState('ready');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <FeedHeader title="Skills" meta={skills.length ? String(skills.length) : undefined} />
      <div className="scroll-silk feed-scroll">
        {state === 'loading' && <p className="feed-note">Loading…</p>}
        {state === 'ready' && skills.length === 0 && (
          <EmptyFeed
            icon="psychology"
            title="No skills yet"
            body="A skill is a standing instruction — 'triage the inbox every morning' — that Millo runs on its own."
          />
        )}
        {skills.map((s) => {
          const kind = s.trigger?.type || 'on_demand';
          return (
            <button
              key={s.id}
              className="stream-row t-lift"
              data-active={s.id === selectedId}
              onClick={() => onOpen(s.id, s)}
            >
              <div className="thread-top">
                <span className="ms skill-trigger" aria-hidden="true">
                  {TRIGGER_ICON[kind] || 'pan_tool'}
                </span>
                <span className="thread-from truncate">{s.name}</span>
                {!s.enabled ? <span className="badge badge-mute">off</span> : null}
              </div>
              <div className="thread-snippet truncate">{s.description}</div>
              <div className="thread-when">
                {s.last_run_at ? `Last run ${shortWhen(s.last_run_at)}` : 'Never run'}
                {typeof s.runs_today === 'number' ? ` · ${s.runs_today} today` : ''}
              </div>
            </button>
          );
        })}
      </div>
    </>
  );
}
