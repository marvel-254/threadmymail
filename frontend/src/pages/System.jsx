/**
 * System — live deployment state. 90s Nostalgia edition.
 *
 * Hit-counter style stat boxes (black bg, green mono text),
 * Win95 section cards with titlebar heading, alternating provider rows.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import DocNav from '../components/DocNav.jsx';

export default function System() {
  const [health, setHealth] = useState(null);
  const [providers, setProviders] = useState([]);
  const [status, setStatus] = useState([]);
  const [usage, setUsage] = useState(null);
  const [config, setConfig] = useState(null);
  const [state, setState] = useState('loading');

  const load = useCallback(async () => {
    setState('loading');
    const [h, prov, s, u] = await Promise.all([
      api.health().catch(() => null),
      // Returns { providers, credentials, writable } — not a flat array.
      api.providers().catch(() => null),
      // /settings returns { ai_config, persona, prefs, … }
      api.settings().catch(() => null),
      api.usage().catch(() => null),
    ]);
    setHealth(h);
    setProviders(Array.isArray(prov?.providers) ? prov.providers : []);
    // credentials has { provider, has_key } entries — that is the status list.
    setStatus(Array.isArray(prov?.credentials) ? prov.credentials : []);
    setUsage(u || null);
    // ai_config lives on the settings payload.
    setConfig(s || null);
    setState('ready');
  }, []);

  useEffect(() => { load(); }, [load]);

  const configured = new Set(status.filter((s) => s.has_key).map((s) => s.provider || s.id));
  const primary = config?.ai_config?.primary;

  return (
    <div className="doc">
      <DocNav
        title="System"
        links={[
          { to: '/docs', label: 'Docs' },
          { to: '/terms', label: 'Terms' },
        ]}
      />
      <header className="doc-head">
        <span className="r-eyebrow">System</span>
        <h1 className="lp-h1" style={{ fontSize: '28px', textShadow: '2px 2px 0 #808080' }}>
          Deployment
        </h1>
        <p className="lp-sub">
          Live state, read from the API. There is no organisation console here
          because this build has no organisations — it has one account.
        </p>
      </header>

      {state === 'loading' && (
        <p className="feed-note" style={{ fontFamily: 'Courier New, monospace' }}>
          Reading from the API…
        </p>
      )}

      {state === 'ready' && (
        <>
          <section className="doc-sec">
            <h2 className="lp-h2" style={{ fontSize: '18px' }}>Health</h2>
            <div className="sys-grid">
              <Stat label="Status" value={health?.status || 'unreachable'} tone={health?.status === 'ok' ? 'ok' : 'bad'} />
              <Stat label="Environment" value={health?.environment || '—'} />
              <Stat label="Version" value={health?.version || '—'} />
              <Stat
                label="Credentials"
                value={health?.credentials_encrypted ? 'ENCRYPTED' : 'NOT ENCRYPTED'}
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
            <h2 className="lp-h2" style={{ fontSize: '18px' }}>Usage</h2>
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
              a placeholder — the model key has not been set yet.
            </p>
          </section>

          <section className="doc-sec">
            <h2 className="lp-h2" style={{ fontSize: '18px' }}>Model</h2>
            <dl className="lp-facts" style={{ borderTop: '2px solid #c0c0c0' }}>
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
              <p className="doc-note doc-note-bad" style={{ marginTop: '8px' }}>
                Still pointed at the mock provider. Paste a real key in Settings
                before judging how the agent behaves.
              </p>
            ) : null}
          </section>

          <section className="doc-sec">
            <h2 className="lp-h2" style={{ fontSize: '18px' }}>
              Providers{' '}
              <span className="lp-count">{providers.length}</span>
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
                    {p.local  ? <span className="badge badge-mute">local</span>  : null}
                    {p.custom ? <span className="badge badge-mute">custom</span> : null}
                    {on ? <span className="badge badge-success">key set</span> : null}
                  </div>
                );
              })}
            </div>
            <p className="doc-note" style={{ marginTop: '8px' }}>
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
    <div className="sys-stat" data-tone={tone || 'neutral'}>
      <div className="sys-stat-label">{label}</div>
      <div className="sys-stat-value">{value}</div>
    </div>
  );
}

function fmt(n) {
  if (n == null) return '—';
  return typeof n === 'number' ? n.toLocaleString() : String(n);
}
