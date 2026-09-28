/**
 * Skills — the automations. Written in plain language; `allowed_tools` is the
 * security boundary, so a skill can never reach past its declared scope.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { IconSkills, IconClock, IconPlug } from './Icons.jsx';

const BLANK = {
  name: '',
  description: '',
  instructions: '',
  allowed_tools: [],
  trigger: { type: 'on_demand', config: {} },
  budget: { max_runs_per_day: 5, max_tokens: 40000 },
  model_slot: 'background',
};

export default function SkillsPane({ tools }) {
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState(null);
  const skills = useAsync(() => api.skills(), []);

  const toolNames = (tools || []).map((t) => t.name);

  async function save(skill) {
    setBusy('save');
    try {
      if (skill.id) await api.updateSkill(skill.id, skill);
      else await api.createSkill(skill);
      setEditing(null);
      await skills.reload({ silent: true });
    } finally {
      setBusy(null);
    }
  }

  async function toggle(skill) {
    setBusy(skill.id);
    try {
      await api.setSkillEnabled(skill.id, !skill.enabled);
      await skills.reload({ silent: true });
    } finally {
      setBusy(null);
    }
  }

  async function runNow(skill) {
    setBusy(skill.id);
    try {
      await api.runSkill(skill.id);
      await skills.reload({ silent: true });
    } finally {
      setBusy(null);
    }
  }

  async function remove(skill) {
    setBusy(skill.id);
    try {
      await api.deleteSkill(skill.id);
      await skills.reload({ silent: true });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="pane" aria-label="Skills">
      <header className="pane-head">
        <h2>
          <IconSkills size={18} /> Skills
        </h2>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing({ ...BLANK })}>
          New skill
        </button>
      </header>

      <div className="pane-body">
        {skills.loading && <p className="muted">loading…</p>}
        {skills.error && (
          <p className="muted small">
            {skills.error.notConnected
              ? 'Backend not connected yet.'
              : skills.error.message}
          </p>
        )}

        {editing && (
          <SkillEditor
            draft={editing}
            toolNames={toolNames}
            busy={busy === 'save'}
            onChange={setEditing}
            onCancel={() => setEditing(null)}
            onSave={() => save(editing)}
          />
        )}

        <ul className="card-list">
          {(skills.data || []).map((s) => (
            <li key={s.id} className={`card-row ${s.enabled ? '' : 'is-off'}`}>
              <div className="card-row-main">
                <div className="card-row-title">
                  <span>{s.name}</span>
                  <TriggerBadge trigger={s.trigger} />
                  {s.dry_run_until && new Date(s.dry_run_until) > new Date() && (
                    <span className="tag tag-warn">dry run</span>
                  )}
                </div>
                {s.description && <p className="card-row-sub">{s.description}</p>}
                <div className="card-row-meta">
                  <span>{s.allowed_tools?.length || 0} tools</span>
                  <span>{s.model_slot}</span>
                  {s.last_run_at && <span>last {formatTime(s.last_run_at)}</span>}
                </div>
              </div>
              <div className="card-row-actions">
                <button className="btn btn-ghost btn-sm" onClick={() => runNow(s)} disabled={busy === s.id}>
                  Run
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => toggle(s)} disabled={busy === s.id}>
                  {s.enabled ? 'Disable' : 'Enable'}
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => setEditing({ ...s })}>
                  Edit
                </button>
                <button className="btn btn-ghost btn-sm" onClick={() => remove(s)} disabled={busy === s.id}>
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>

        {!skills.loading && !skills.error && (skills.data || []).length === 0 && (
          <p className="muted small">
            No skills yet. A skill is a named automation — &ldquo;every Friday, tell me
            what I promised and whether I did it.&rdquo;
          </p>
        )}
      </div>
    </section>
  );
}

function TriggerBadge({ trigger }) {
  const type = trigger?.type || 'on_demand';
  const icon = type === 'cron' ? <IconClock size={13} /> : type === 'event' ? <IconPlug size={13} /> : null;
  return (
    <span className="tag">
      {icon}
      {type === 'cron' ? trigger?.config?.expression || 'cron' : type}
    </span>
  );
}

function SkillEditor({ draft, toolNames, onChange, onSave, onCancel, busy }) {
  const set = (patch) => onChange({ ...draft, ...patch });

  function toggleTool(name) {
    const has = draft.allowed_tools.includes(name);
    set({
      allowed_tools: has
        ? draft.allowed_tools.filter((t) => t !== name)
        : [...draft.allowed_tools, name],
    });
  }

  return (
    <div className="editor glass-strong">
      <h3>Skill</h3>

      <label className="field">
        <span>Name</span>
        <input value={draft.name} onChange={(e) => set({ name: e.target.value })} placeholder="weekly_review" />
      </label>

      <label className="field">
        <span>Description <em>— what the model sees when choosing a skill</em></span>
        <input value={draft.description} onChange={(e) => set({ description: e.target.value })} placeholder="Reports outstanding commitments each Friday." />
      </label>

      <label className="field">
        <span>Instructions <em>— plain language, no code</em></span>
        <textarea
          rows={5}
          value={draft.instructions}
          onChange={(e) => set({ instructions: e.target.value })}
          placeholder="Find threads where I committed to something in the last two weeks and check whether it was done."
        />
      </label>

      <div className="field">
        <span>Trigger</span>
        <div className="seg">
          {['on_demand', 'cron', 'event'].map((t) => (
            <button
              key={t}
              className={`seg-btn ${draft.trigger.type === t ? 'is-on' : ''}`}
              onClick={() => set({ trigger: { type: t, config: {} } })}
            >
              {t}
            </button>
          ))}
        </div>
        {draft.trigger.type === 'cron' && (
          <input
            className="mono"
            value={draft.trigger.config?.expression || ''}
            onChange={(e) =>
              set({ trigger: { type: 'cron', config: { ...draft.trigger.config, expression: e.target.value } } })
            }
            placeholder="0 17 * * 5"
          />
        )}
        {draft.trigger.type === 'event' && (
          <input
            className="mono"
            value={draft.trigger.config?.event || ''}
            onChange={(e) =>
              set({ trigger: { type: 'event', config: { ...draft.trigger.config, event: e.target.value } } })
            }
            placeholder="calendar.meeting_starting"
          />
        )}
      </div>

      <div className="field">
        <span>Allowed tools <em>— the security boundary</em></span>
        {toolNames.length === 0 ? (
          <p className="muted small">Tool list unavailable (backend not connected).</p>
        ) : (
          <div className="chip-row">
            {toolNames.map((name) => (
              <button
                key={name}
                className={`chip ${draft.allowed_tools.includes(name) ? 'is-on' : ''}`}
                onClick={() => toggleTool(name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="field">
        <span>Model slot</span>
        <div className="seg">
          {['background', 'primary', 'inherit'].map((m) => (
            <button
              key={m}
              className={`seg-btn ${draft.model_slot === m ? 'is-on' : ''}`}
              onClick={() => set({ model_slot: m })}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div className="editor-actions">
        <button className="btn btn-primary btn-sm" onClick={onSave} disabled={busy || !draft.name}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <p className="muted small">
          New skills start in <strong>dry-run</strong>: the agent rehearses the run and
          records what it would have done without acting on the outside world.
        </p>
      </div>
    </div>
  );
}

function formatTime(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso)) / 6e4);
  if (mins < 60) return `${Math.max(mins, 1)}m ago`;
  if (mins < 1440) return `${Math.round(mins / 60)}h ago`;
  return new Date(iso).toLocaleDateString();
}
