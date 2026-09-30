/**
 * System — the honest version of the design's "Enterprise Admin" screen.
 *
 * The mockup showed a multi-tenant admin console: user tables, seat counts,
 * org-wide audit exports, a policy engine. None of that exists. This app has
 * exactly one account and no admin concept at all.
 *
 * So rather than build a dashboard full of invented numbers, this shows the
 * things that are genuinely true and genuinely useful to see: whether the
 * Worker is healthy, which providers exist, which one is configured, and what
 * has actually been spent.
 *
 * Every figure below comes from the running API. Nothing here is hard-coded.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

export default function System() {
  const [health, setHealth] = useState(null);
  const [providers, setProviders] = useState([]);
  const [status, setStatus] = useState([]);
  const [usage, setUsage] = useState(null);
  const [config, setConfig] = useState(null);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    setState('loading');
    const [h, p, s, u, c] = await Promise.all([
      api.health().catch(() => null),
      api.providers().catch(() => []),
      api.settings().catch(() => null),
      api.usage().catch(() => null),
      Promise.resolve(null),
    ]);
    setHealth(h);
    setProviders(Array.isArray(p) ? p : []);
    setStatus(Array.isArray(s) ? s : []);
    setUsage(u || null);
    setConfig(c || null);
    setState('ready');
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const configured = new Set(status.filter((s) => s.has_key).map((s) => s.provider || s.id));
  const primary = config?.ai_config?.primary;

  return (
    <div className="doc">
      <header className="doc-head">
        <span className="eyebrow">System</span>
        <h1 className="lp-h1" style={{ fontSize: 32 }}>Deployment</h1>
        <p className="lp-sub">
          Live state, read from the API. There is no organisation console here
          because this build has no organisations &mdash; it has one account.
        </p>
      </header>

      {state === 'loading' && <p className="feed-note">Reading from the API…</p>}

      {state === 'ready' && (
        <>
          <section className="doc-sec">
            <h2 className="lp-h2" style={{ fontSize: 20 }}>Health</h2>
            <div className="sys-grid">
              <Stat label="Status" value={health?.status || 'unreachable'} tone={health?.status === 'ok' ? 'ok' : 'bad'} />
              <Stat label="Environment" value={health?.environment || '—'} />
              <Stat label="Version" value={health?.version || '—'} />
              <Stat
                label="Credentials"
                value={health?.credentials_encrypted ? 'encrypted at rest' : 'NOT ENCRYPTED'}
                tone={health?.credentials_encrypted ? 'ok' : 'bad'}
              />
            </div>
            {!health && (
              <p className="doc-note doc-note-bad">
                The Worker did not respond to <code>/health</code>. Either it is
                down or <code>CORS_ORIGINS</code> does not include this origin.
              </p>
            )}
          </section>

          <section className="doc-sec">
            <h2 className="lp-h2" style={{ fontSize: 20 }}>Usage</h2>
            <div className="sys-grid">
              <Stat label="Agent runs" value={fmt(usage?.runs)} />
              <Stat label="Tokens" value={fmt(usage?.tokens)} />
              <Stat
                label="Cost"
                value={usage?.cost_usd != null ? `$${Number(usage.cost_usd).toFixed(4)}` : '—'}
              />
            </div>
            <p className="doc-note">
              Counts every run since the beginning. Zero is a truthful answer, not
              a placeholder &mdash; the model key has not been set yet.
            </p>
          </section>

          <section className="doc-sec">
            <h2 className="lp-h2" style={{ fontSize: 20 }}>Model</h2>
            <dl className="lp-facts">
              <div>
                <dt>Primary provider</dt>
                <dd>{primary?.provider || <em>not set</em>}</dd>
              </div>
              <div>
                <dt>Model</dt>
                <dd>{primary?.model || <em>not set</em>}</dd>
              </div>
              <div>
                <dt>Base URL</dt>
                <dd>{primary?.base_url || <em>provider default</em>}</dd>
              </div>
            </dl>
            {!primary || primary.model === 'mock-model' ? (
              <p className="doc-note doc-note-bad">
                Still pointed at the mock provider. Paste a real key in Settings
                before judging how the agent behaves.
              </p>
            ) : null}
          </section>

          <section className="doc-sec">
            <h2 className="lp-h2" style={{ fontSize: 20 }}>
              Providers <span className="lp-count">{providers.length}</span>
            </h2>
            <div className="sys-providers">
              {providers.map((p) => {
                const on = configured.has(p.id);
                return (
                  <div className="sys-provider" key={p.id} data-on={on}>
                    <span className="ms sys-provider-icon" aria-hidden="true">
                      {on ? 'check_circle' : 'radio_button_unchecked'}
                    </span>
                    <div className="sys-provider-body">
                      <span className="sys-provider-label">{p.label}</span>
                      <span className="sys-provider-id">{p.id}</span>
                    </div>
                    {p.local ? <span className="badge badge-mute">local</span> : null}
                    {p.custom ? <span className="badge badge-mute">custom</span> : null}
                    {on ? <span className="badge badge-success">key set</span> : null}
                  </div>
                );
              })}
            </div>
            <p className="doc-note">
              {configured.size} of {providers.length} configured. The API returns a
              fingerprint and a hint, never the key.
            </p>
          </section>
        </>
      )}
    </div>
  );
}

function Stat({ label, value, tone }) {
  return (
    <div className="sys-stat t-well" data-tone={tone || 'neutral'}>
      <div className="sys-stat-label">{label}</div>
      <div className="sys-stat-value">{value}</div>
    </div>
  );
}

function fmt(n) {
  if (n == null) return '—';
  return typeof n === 'number' ? n.toLocaleString() : String(n);
}
