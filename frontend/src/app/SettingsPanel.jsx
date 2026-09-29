/**
 * Autonomy settings — persona, model routing, guardrails, budgets, kill switch.
 *
 * The kill switch is deliberately first and impossible to miss. Autonomy without
 * a fast stop is a liability.
 *
 * MODEL ROUTING is provider-driven. The picker is built from
 * GET /settings/providers, so adding a provider server-side needs no change
 * here. Keys are saved one provider at a time and are never read back — the UI
 * only ever learns `has_key` plus a short fingerprint.
 */
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { IconSettings, IconKill } from './Icons.jsx';

const DEFAULT_SETTINGS = {
  persona: null,
  ai_config: {
    primary: { provider: 'openrouter', model: '', temperature: 0.4, baseUrl: '' },
    background: { provider: 'openrouter', model: '', temperature: 0.1, baseUrl: '' },
    max_steps: 12,
  },
  prefs: {
    new_contact_policy: 'ask',
    new_contact_allowlist: [],
    notification_threshold: 7,
    digest_time: '07:00',
    timezone: 'UTC',
    quiet_hours: null,
  },
  budget: { daily_tokens: 200000, daily_usd: 2.0, max_outbound_per_day: 20 },
};

/** One row of the credential table, keyed by provider id. */
const EMPTY_CREDENTIALS = {};

/**
 * "What the agent will do without you."
 *
 * The heartbeat is the least visible part of the product and the one with the
 * most authority, so its state is shown rather than implied: every skill that
 * can fire on a timer, what it will do, and when it next runs. This is the
 * Durable Object's own schedule table — the same rows the 5-minute tick reads
 * — so it cannot disagree with what will actually happen.
 */
function ScheduleBlock() {
  const [note, setNote] = useState(null);
  const schedule = useAsync(() => api.schedule(), []);
  const [draft, setDraft] = useState({ digest_time: '07:00', timezone: 'UTC', quiet_hours: null });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (schedule.data) {
      setDraft({
        digest_time: schedule.data.digest_time ?? '07:00',
        timezone: schedule.data.timezone ?? 'UTC',
        quiet_hours: schedule.data.quiet_hours ?? null,
      });
    }
  }, [schedule.data]);

  const entries = schedule.data?.entries ?? [];
  const timers = entries.filter((e) => e.next_due_ms >= 0);
  const armed = entries.filter((e) => e.next_due_ms < 0);

  async function savePrefs(patch) {
    setBusy(true);
    setNote(null);
    try {
      await api.saveSettings({ prefs: patch });
      await schedule.reload({ silent: true });
      setNote('Saved.');
    } catch (err) {
      setNote(err.notConnected ? 'Backend not connected yet.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  const quiet = draft.quiet_hours ?? { start: '22:00', end: '07:00' };
  const quietOn = draft.quiet_hours !== null;

  return (
    <section className="block">
      <h3 className="block-title">Unattended activity</h3>
      <p className="muted small">
        The agent checks every five minutes. Outside the times below it does nothing at
        all — no database, no model call, no token spent.
      </p>

      <div className="grid-3">
        <label className="field">
          <span>Timezone</span>
          <input
            value={draft.timezone}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, timezone: e.target.value }))}
            onBlur={() => draft.timezone !== schedule.data?.timezone && savePrefs({ timezone: draft.timezone })}
            placeholder="Europe/Berlin"
          />
        </label>
        <label className="field">
          <span>Briefing time</span>
          <input
            type="time"
            value={draft.digest_time}
            disabled={busy}
            onChange={(e) => setDraft((d) => ({ ...d, digest_time: e.target.value }))}
            onBlur={() => draft.digest_time !== schedule.data?.digest_time && savePrefs({ digest_time: draft.digest_time })}
          />
        </label>
        <label className="field">
          <span>Quiet hours</span>
          <div className="row-gap">
            <input
              type="time"
              value={quiet.start}
              disabled={busy || !quietOn}
              onChange={(e) => setDraft((d) => ({ ...d, quiet_hours: { ...quiet, start: e.target.value } }))}
            />
            <span className="muted">→</span>
            <input
              type="time"
              value={quiet.end}
              disabled={busy || !quietOn}
              onChange={(e) => setDraft((d) => ({ ...d, quiet_hours: { ...quiet, end: e.target.value } }))}
            />
            <label className="check" title="Defer everything the agent would do on its own">
              <input
                type="checkbox"
                checked={quietOn}
                disabled={busy}
                onChange={(e) =>
                  savePrefs({ quiet_hours: e.target.checked ? quiet : null })
                }
              />
              <span>On</span>
            </label>
          </div>
        </label>
      </div>

      {note && <p className="muted small">{note}</p>}

      <h4 className="block-subtitle">Next runs</h4>
      {timers.length === 0 && armed.length === 0 ? (
        <p className="muted small">
          Nothing scheduled. Create a skill with a time or new-mail trigger and it
          will appear here.
        </p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Skill</th>
              <th>Trigger</th>
              <th>Next</th>
            </tr>
          </thead>
          <tbody>
            {timers.map((e) => (
              <tr key={e.skill_id}>
                <td>{e.name}</td>
                <td className="muted">{TRIGGER_LABEL[e.kind] ?? e.kind}</td>
                <td>
                  <time dateTime={e.next_due}>{formatWhen(e.next_due, draft.timezone)}</time>
                </td>
              </tr>
            ))}
            {armed.map((e) => (
              <tr key={e.skill_id}>
                <td>{e.name}</td>
                <td className="muted">{TRIGGER_LABEL[e.kind] ?? e.kind}</td>
                <td className="muted">waiting for new mail</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

const TRIGGER_LABEL = {
  digest: 'daily briefing',
  cron: 'on a schedule',
  event: 'on new mail',
};

/**
 * Format an ISO instant in the user's own timezone.
 *
 * The server sends UTC; rendering it with the browser's locale without the
 * zone would show the wrong hour for anyone not on UTC — and this panel exists
 * precisely so the user can trust the time it claims to fire at.
 */
function formatWhen(iso, timezone) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      timeZone: timezone || undefined,
    }).format(date);
  } catch {
    // An unknown IANA zone must not blank the panel; the server validates the
    // zone separately, and showing UTC beats showing nothing.
    return date.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  }
}

export default function SettingsPanel({ onClose }) {
  const [draft, setDraft] = useState(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  // Draft key input per provider. Never populated from the server — there is
  // nothing to populate it with, by design.
  const [keyDraft, setKeyDraft] = useState({});
  const [baseUrlDraft, setBaseUrlDraft] = useState({});

  const settings = useAsync(() => api.settings(), []);
  const providers = useAsync(() => api.providers(), []);
  const usage = useAsync(() => api.usage(), []);
  const kill = useAsync(() => api.killSwitch(), []);

  useEffect(() => {
    if (settings.data) setDraft({ ...DEFAULT_SETTINGS, ...settings.data });
  }, [settings.data]);

  const catalogue = providers.data?.providers ?? [];
  const credentials = providers.data?.credentials ?? EMPTY_CREDENTIALS;
  const writable = providers.data?.writable !== false;

  const byId = useMemo(
    () => new Map(catalogue.map((p) => [p.id, p])),
    [catalogue],
  );
  const statusOf = (id) => credentials[id] ?? null;

  const engaged = kill.data?.global || kill.data?.skills
    ? kill.data.global || Object.values(kill.data.skills || {}).some(Boolean)
    : false;

  async function setKill(value) {
    setBusy(true);
    try {
      await api.setKillSwitch({ global: value, skills: kill.data?.skills || {} });
      await kill.reload({ silent: true });
    } catch (err) {
      setNote(err.notConnected ? 'Backend not connected yet.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  const setPrefs = (patch) =>
    setDraft((d) => ({ ...d, prefs: { ...d.prefs, ...patch } }));
  const setBudget = (patch) =>
    setDraft((d) => ({ ...d, budget: { ...d.budget, ...patch } }));
  const setModel = (slot, patch) =>
    setDraft((d) => ({
      ...d,
      ai_config: { ...d.ai_config, [slot]: { ...d.ai_config[slot], ...patch } },
    }));

  /**
   * Save the per-provider credential, then refresh status. The key is cleared
   * from component state as soon as the request resolves, so it does not linger
   * in a password field after being accepted.
   */
  async function saveCredential(providerId) {
    const apiKey = (keyDraft[providerId] ?? '').trim();
    const baseUrlRaw = (baseUrlDraft[providerId] ?? '').trim();
    const body = {};
    if (apiKey !== '') body.api_key = apiKey;
    if (baseUrlRaw !== '') body.base_url = baseUrlRaw;
    if (Object.keys(body).length === 0) return;

    setBusy(true);
    setNote(null);
    try {
      await api.saveProvider(providerId, body);
      setKeyDraft((d) => ({ ...d, [providerId]: '' }));
      setBaseUrlDraft((d) => ({ ...d, [providerId]: '' }));
      await providers.reload({ silent: true });
      setNote(`Saved ${byId.get(providerId)?.label ?? providerId} credentials.`);
    } catch (err) {
      setNote(err.notConnected ? 'Backend not connected yet.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function removeCredential(providerId) {
    setBusy(true);
    setNote(null);
    try {
      await api.removeProvider(providerId);
      await providers.reload({ silent: true });
      setNote(`Removed ${byId.get(providerId)?.label ?? providerId} credentials.`);
    } catch (err) {
      setNote(err.notConnected ? 'Backend not connected yet.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  /**
   * End-to-end check: a real completion against the saved credential, using the
   * server's fixed one-word prompt. Verifies a key + model *before* the user
   * commits either to ai_config.
   */
  async function testProvider(providerId) {
    const spec = byId.get(providerId);
    // Prefer the model this provider's slot already uses; otherwise its
    // documented default, so a bare key test still works.
    const slot =
      draft.ai_config.primary.provider === providerId
        ? draft.ai_config.primary
        : draft.ai_config.background.provider === providerId
          ? draft.ai_config.background
          : null;
    const model = slot?.model || spec?.suggest_primary || '';

    setBusy(true);
    setNote(null);
    try {
      const result = await api.testProvider(providerId, model);
      if (result?.ok) {
        setNote(`${spec?.label ?? providerId} works. Replied: ${result.text || '(empty)'}`);
      } else {
        setNote(
          `${spec?.label ?? providerId} failed: ${result?.error?.code ?? 'ERROR'} — ${
            result?.error?.message ?? 'unknown error'
          }`,
        );
      }
    } catch (err) {
      setNote(err.notConnected ? 'Backend not connected yet.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      await api.saveSettings(draft);
      setNote('Saved.');
      await usage.reload({ silent: true });
    } catch (err) {
      setNote(err.notConnected ? 'Backend not connected yet.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  const renderSlot = (slot, title, hint) => {
    const current = draft.ai_config[slot];
    const spec = byId.get(current.provider);
    return (
      <div className="block">
        <h3 className="block-title">{title}</h3>
        <div className="grid-2">
          <label className="field">
            <span>{hint}</span>
            <select
              value={current.provider}
              onChange={(e) => {
                const next = e.target.value;
                const nextSpec = byId.get(next);
                setModel(slot, {
                  provider: next,
                  // Offer the provider's suggestion instead of leaving a model
                  // id from a different provider in place, which would fail.
                  model: nextSpec ? (slot === 'background'
                    ? nextSpec.suggest_background
                    : nextSpec.suggest_primary) : '',
                });
              }}
            >
              {catalogue.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {statusOf(p.id)?.has_key ? ' · key saved' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Model</span>
            <input
              className="mono"
              value={current.model}
              onChange={(e) => setModel(slot, { model: e.target.value })}
              placeholder={spec?.suggest_primary || 'model id'}
            />
          </label>
        </div>
        {spec?.requires_base_url && (
          <label className="field">
            <span>Base URL <em>— must be https, or http on localhost</em></span>
            <input
              className="mono"
              value={current.baseUrl ?? ''}
              onChange={(e) => setModel(slot, { baseUrl: e.target.value })}
              placeholder="https://your-endpoint.com/v1"
            />
          </label>
        )}
        {!statusOf(current.provider)?.has_key && !spec?.local && (
          <p className="muted small">
            No {spec?.label ?? current.provider} key saved yet — add one below before the
            agent can complete a turn.
          </p>
        )}
      </div>
    );
  };

  return (
    <div className="sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="sheet glass-strong"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Autonomy settings"
      >
        <header className="sheet-head">
          <h2>
            <IconSettings size={18} /> Autonomy
          </h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>
            Close
          </button>
        </header>

        <div className="sheet-body">
          <section className={`kill ${engaged ? 'is-engaged' : ''}`}>
            <div>
              <h3>
                <IconKill size={16} /> Kill switch
              </h3>
              <p className="muted small">
                {engaged
                  ? 'Every run is halted. Nothing the agent does until you release this.'
                  : 'Halts all runs immediately. Use it when something looks wrong.'}
              </p>
            </div>
            <button
              className={`btn btn-sm ${engaged ? 'btn-primary' : 'btn-ghost'}`}
              onClick={() => setKill(!engaged)}
              disabled={busy}
            >
              {engaged ? 'Release' : 'Halt everything'}
            </button>
          </section>

          <section className="block">
            <h3 className="block-title">Voice</h3>
            <label className="field">
              <span>
                Persona override <em>— leave empty for the default warm, dry, sassy voice</em>
              </span>
              <textarea
                rows={4}
                value={draft.persona || ''}
                onChange={(e) => setDraft({ ...draft, persona: e.target.value || null })}
                placeholder="You are ThreadMyMail — this user's personal assistant…"
              />
            </label>
          </section>

          <section className="block">
            <h3 className="block-title">Model routing</h3>
            {renderSlot('primary', 'Primary model', 'Anything user-facing')}
            {renderSlot('background', 'Background model', 'Cron, triage, digests — keep it cheap')}
          </section>

          <section className="block">
            <h3 className="block-title">Model providers</h3>
            {!writable && (
              <p className="muted small">
                {providers.data?.reason ??
                  'Credentials cannot be saved until the encryption key is configured.'}
              </p>
            )}
            <p className="muted small">
              Keys are stored encrypted per‑user and never sent back to this page. Add as
              many as you like; the agent uses the ones your model slots point at.
            </p>
            {catalogue.map((p) => {
              const status = statusOf(p.id);
              return (
                <div key={p.id} className="block">
                  <h3 className="block-title">
                    {p.label}
                    {status?.has_key && (
                      <span className="muted small"> · key saved ({status.fingerprint})</span>
                    )}
                  </h3>
                  <div className="grid-2">
                    <label className="field">
                      <span>API key {p.key_hint && <em>— {p.key_hint}</em>}</span>
                      <input
                        type="password"
                        value={keyDraft[p.id] ?? ''}
                        onChange={(e) =>
                          setKeyDraft((d) => ({ ...d, [p.id]: e.target.value }))
                        }
                        placeholder={p.local ? 'optional for local models' : 'paste to replace'}
                        autoComplete="off"
                        spellCheck={false}
                      />
                    </label>
                    {p.requires_base_url && (
                      <label className="field">
                        <span>Base URL</span>
                        <input
                          className="mono"
                          value={baseUrlDraft[p.id] ?? status?.base_url ?? ''}
                          onChange={(e) =>
                            setBaseUrlDraft((d) => ({ ...d, [p.id]: e.target.value }))
                          }
                          placeholder="https://your-endpoint.com/v1"
                        />
                      </label>
                    )}
                  </div>
                  <div className="grid-2">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => saveCredential(p.id)}
                      disabled={busy}
                    >
                      Save {p.label}
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => testProvider(p.id)}
                      disabled={busy}
                    >
                      Test
                    </button>
                    {status?.has_key && (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => removeCredential(p.id)}
                        disabled={busy}
                      >
                        Remove
                      </button>
                    )}
                    {p.key_url && (
                      <a
                        className="muted small"
                        href={p.key_url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Get a key →
                      </a>
                    )}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="block">
            <h3 className="block-title">Guardrails</h3>
            <label className="field">
              <span>New external contacts</span>
              <div className="seg">
                {['ask', 'allow', 'block'].map((p) => (
                  <button
                    key={p}
                    className={`seg-btn ${draft.prefs.new_contact_policy === p ? 'is-on' : ''}`}
                    onClick={() => setPrefs({ new_contact_policy: p })}
                  >
                    {p}
                  </button>
                ))}
              </div>
            </label>
            <p className="muted small">
              Applies to sending mail and booking meetings with someone outside your
              existing threads. Hard blocks that cannot be changed: never send
              attachments, never delete.
            </p>
          </section>

          <ScheduleBlock />

          <section className="block">
            <h3 className="block-title">Budget</h3>
            <div className="grid-3">
              <label className="field">
                <span>Daily tokens</span>
                <input
                  type="number"
                  value={draft.budget.daily_tokens}
                  onChange={(e) => setBudget({ daily_tokens: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Daily spend (USD)</span>
                <input
                  type="number"
                  step="0.1"
                  value={draft.budget.daily_usd}
                  onChange={(e) => setBudget({ daily_usd: Number(e.target.value) })}
                />
              </label>
              <label className="field">
                <span>Outbound / day</span>
                <input
                  type="number"
                  value={draft.budget.max_outbound_per_day}
                  onChange={(e) => setBudget({ max_outbound_per_day: Number(e.target.value) })}
                />
              </label>
            </div>
            {usage.data && (
              <p className="muted small">
                Today: {usage.data.tokens ?? 0} tokens · $
                {Number(usage.data.cost_usd || 0).toFixed(4)} · {usage.data.runs ?? 0} runs
              </p>
            )}
          </section>
        </div>

        <footer className="sheet-foot">
          {note && <span className="muted small">{note}</span>}
          <button className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            {busy ? 'Saving…' : 'Save settings'}
          </button>
        </footer>
      </div>
    </div>
  );
}
