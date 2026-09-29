/**
 * Autonomy settings — persona, model routing, guardrails, budgets, kill switch.
 *
 * The kill switch is deliberately first and impossible to miss. Autonomy without
 * a fast stop is a liability.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { IconSettings, IconKill } from './Icons.jsx';

const DEFAULT_SETTINGS = {
  persona: null,
  ai_config: {
    primary: { provider: 'openrouter', model: '', temperature: 0.4 },
    background: { provider: 'openrouter', model: '', temperature: 0.1 },
    max_steps: 12,
  },
  prefs: {
    new_contact_policy: 'ask',
    new_contact_allowlist: [],
    notification_threshold: 7,
    digest_time: '07:00',
  },
  budget: { daily_tokens: 200000, daily_usd: 2.0, max_outbound_per_day: 20 },
  // API keys are handled via pluginCredentials API
  apiKeys: {
    openrouter: '',
    anthropic: '',
    openai: '',
    google: '',
    custom: '',
  },
  // Custom endpoint configuration
  customEndpoint: '',
};

export default function SettingsPanel({ onClose }) {
  const [draft, setDraft] = useState(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);

  const settings = useAsync(() => api.settings(), []);
  const usage = useAsync(() => api.usage(), []);
  const kill = useAsync(() => api.killSwitch(), []);

  useEffect(() => {
    if (settings.data) setDraft({ ...DEFAULT_SETTINGS, ...settings.data });
  }, [settings.data]);

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

  async function save() {
    setBusy(true);
    setNote(null);
    try {
      // Save regular settings first (excluding API keys and custom endpoint)
      const settingsToSave = { ...draft };
      delete settingsToSave.apiKeys;
      delete settingsToSave.customEndpoint;
      await api.saveSettings(settingsToSave);
      
      // Save each API key separately via pluginCredentials if provided
      const apiKeyPromises = [];
      if (draft.apiKeys.openrouter.trim() !== '') {
        apiKeyPromises.push(api.pluginCredentials('openrouter', { api_key: draft.apiKeys.openrouter }));
      }
      if (draft.apiKeys.anthropic.trim() !== '') {
        apiKeyPromises.push(api.pluginCredentials('anthropic', { api_key: draft.apiKeys.anthropic }));
      }
      if (draft.apiKeys.openai.trim() !== '') {
        apiKeyPromises.push(api.pluginCredentials('openai', { api_key: draft.apiKeys.openai }));
      }
      if (draft.apiKeys.google.trim() !== '') {
        apiKeyPromises.push(api.pluginCredentials('google', { api_key: draft.apiKeys.google }));
      }
      if (draft.apiKeys.custom.trim() !== '') {
        apiKeyPromises.push(api.pluginCredentials('custom', { api_key: draft.apiKeys.custom }));
      }
      
      // Save custom endpoint if provided
      if (draft.customEndpoint.trim() !== '') {
        // For custom endpoint, we'll save it as a plugin credential too
        apiKeyPromises.push(api.pluginCredentials('custom-endpoint', { endpoint: draft.customEndpoint }));
      }
      
      // Wait for all API key saves to complete
      if (apiKeyPromises.length > 0) {
        await Promise.all(apiKeyPromises);
      }
      
      setNote('Saved.');
      await usage.reload({ silent: true });
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
            <div className="grid-2">
              <label className="field">
                <span>Primary <em>— anything user-facing</em></span>
                <input
                  className="mono"
                  value={draft.ai_config.primary.model}
                  onChange={(e) => setModel('primary', { model: e.target.value })}
                  placeholder="anthropic/claude-sonnet-4"
                />
              </label>
              <label className="field">
                <span>Background <em>— cron, triage, digests</em></span>
                <input
                  className="mono"
                  value={draft.ai_config.background.model}
                  onChange={(e) => setModel('background', { model: e.target.value })}
                  placeholder="a cheap fast model"
                />
              </label>
            </div>
            <div className="field">
              <label>
                <span>API Keys</em></span>
                <div className="grid-2">
                  <label className="field">
                    <span>OpenRouter</span>
                    <input
                      type="password"
                      value={draft.apiKeys.openrouter}
                      onChange={(e) => setDraft({ ...draft, apiKeys: { ...draft.apiKeys, openrouter: e.target.value } })}
                      placeholder="sk-or-v1-..."
                    />
                  </label>
                  <label className="field">
                    <span>Anthropic</span>
                    <input
                      type="password"
                      value={draft.apiKeys.anthropic}
                      onChange={(e) => setDraft({ ...draft, apiKeys: { ...draft.apiKeys, anthropic: e.target.value } })}
                      placeholder="sk-ant-..."
                    />
                  </label>
                </div>
                <div className="grid-2">
                  <label className="field">
                    <span>OpenAI</span>
                    <input
                      type="password"
                      value={draft.apiKeys.openai}
                      onChange={(e) => setDraft({ ...draft, apiKeys: { ...draft.apiKeys, openai: e.target.value } })}
                      placeholder="sk-..."
                    />
                  </label>
                  <label className="field">
                    <span>Google</span>
                    <input
                      type="password"
                      value={draft.apiKeys.google}
                      onChange={(e) => setDraft({ ...draft, apiKeys: { ...draft.apiKeys, google: e.target.value } })}
                      placeholder="AIza..."
                    />
                  </label>
                </div>
                <div className="field">
                  <label>
                    <span>Custom Provider</em></span>
                    <input
                      type="password"
                      value={draft.apiKeys.custom}
                      onChange={(e) => setDraft({ ...draft, apiKeys: { ...draft.apiKeys, custom: e.target.value } })}
                      placeholder="your-api-key-here"
                    />
                  </label>
                </div>
              </label>
            </div>
            <div className="field">
              <label>
                <span>Custom Endpoint <em>— for self-hosted models</em></span>
                <input
                  type="text"
                  value={draft.customEndpoint}
                  onChange={(e) => setDraft({ ...draft, customEndpoint: e.target.value })}
                  placeholder="https://your-model-endpoint.com/v1"
                />
              </label>
              <p className="muted small">
                Leave blank to use OpenRouter. Format: BASE_URL (no trailing slash)
              </p>
            </div>
            <p className="muted small">
              API keys are stored encrypted per‑user. Never logged or exposed in responses.
            </p>
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
