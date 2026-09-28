/**
 * Plugins — install, configure, and grant permissions.
 *
 * The review step is the whole point: a git-URL plugin is arbitrary code in the
 * Worker process, so the user must see exactly what it wants before it runs.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAsync } from '../lib/hooks.js';
import { IconPlugins } from './Icons.jsx';

export default function PluginsPane() {
  const [url, setUrl] = useState('');
  const [pending, setPending] = useState(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState(null);
  const plugins = useAsync(() => api.plugins(), []);

  async function review(event) {
    event.preventDefault();
    if (!url.trim()) return;
    setBusy(true);
    setNote(null);
    setPending(null);
    try {
      setPending(await api.pluginManifest(url.trim()));
    } catch (err) {
      setNote(err.notConnected ? 'Backend not connected yet.' : err.message);
    } finally {
      setBusy(false);
    }
  }

  async function install(manifest) {
    setBusy(true);
    try {
      // A commit SHA is mandatory — no unpinned installs (docs/PLUGINS.md §4).
      const sha = prompt('Pin this plugin to a commit SHA (required):', 'HEAD');
      if (!sha) return;
      const grants = Object.fromEntries(
        (manifest.tools || []).map((t) => [t.name, t.permissions || []]),
      );
      await api.installPlugin({ url, sha, grants });
      setPending(null);
      setUrl('');
      await plugins.reload({ silent: true });
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function credentials(p) {
    const fields = {};
    for (const f of p.manifest?.setup?.fields || []) {
      const value = window.prompt(f.label, '');
      if (value) fields[f.key] = value;
    }
    setBusy(true);
    try {
      await api.pluginCredentials(p.id, fields);
      await plugins.reload({ silent: true });
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggle(p) {
    setBusy(true);
    try {
      await api.setPluginEnabled(p.id, !p.enabled);
      await plugins.reload({ silent: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pane" aria-label="Plugins">
      <header className="pane-head">
        <h2>
          <IconPlugins size={18} /> Plugins
        </h2>
      </header>

      <div className="pane-body">
        <form className="install-form" onSubmit={review}>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/you/your-plugin"
            className="mono"
            aria-label="Plugin git URL"
          />
          <button className="btn btn-primary btn-sm" type="submit" disabled={busy || !url.trim()}>
            Review
          </button>
        </form>

        {note && <p className="muted small">{note}</p>}

        {pending && (
          <div className="review glass-strong">
            <h3>
              {pending.name} <span className="muted small">v{pending.version}</span>
            </h3>
            <p className="card-row-sub">{pending.description}</p>

            <div className="review-block">
              <h4>This plugin wants to:</h4>
              <ul className="perm-list">
                {(pending.permissions || []).map((perm) => (
                  <li key={perm}>{describePermission(perm)}</li>
                ))}
              </ul>
            </div>

            <div className="review-block">
              <h4>Tools it registers</h4>
              <ul className="perm-list">
                {(pending.tools || []).map((t) => (
                  <li key={t.name}>
                    <code>{t.name}</code> — {t.description}
                  </li>
                ))}
              </ul>
            </div>

            <p className="warn">
              A plugin is arbitrary code running inside the Worker. There is no sandbox.
              Only install from a source you trust.
            </p>

            <div className="editor-actions">
              <button className="btn btn-primary btn-sm" onClick={() => install(pending)} disabled={busy}>
                Approve &amp; install
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPending(null)}>
                Reject
              </button>
            </div>
          </div>
        )}

        {plugins.loading && <p className="muted">loading…</p>}
        {plugins.error && (
          <p className="muted small">
            {plugins.error.notConnected ? 'Backend not connected yet.' : plugins.error.message}
          </p>
        )}

        <ul className="card-list">
          {(plugins.data || []).map((p) => (
            <li key={p.id} className={`card-row ${p.enabled ? '' : 'is-off'}`}>
              <div className="card-row-main">
                <div className="card-row-title">
                  <span>{p.name}</span>
                  <span className="tag">{p.source}</span>
                  {!p.configured && <span className="tag tag-warn">needs setup</span>}
                </div>
                {p.manifest?.description && <p className="card-row-sub">{p.manifest.description}</p>}
                <div className="card-row-meta">
                  <span>{p.tools} tools</span>
                  <span>{(p.permissions || []).length} permissions</span>
                </div>
              </div>
              <div className="card-row-actions">
                {!p.configured && (
                  <button className="btn btn-ghost btn-sm" onClick={() => credentials(p)} disabled={busy}>
                    Configure
                  </button>
                )}
                <button className="btn btn-ghost btn-sm" onClick={() => toggle(p)} disabled={busy}>
                  {p.enabled ? 'Disable' : 'Enable'}
                </button>
              </div>
            </li>
          ))}
        </ul>

        {!plugins.loading && !plugins.error && (plugins.data || []).length === 0 && (
          <p className="muted small">No plugins installed.</p>
        )}
      </div>
    </section>
  );
}

function describePermission(perm) {
  if (perm.startsWith('network:')) return `make HTTPS requests to ${perm.slice(8)}`;
  if (perm.startsWith('data:')) {
    const [, resource, level] = perm.split(':');
    return `${level === 'write' ? 'write' : 'read'} your ${resource}`;
  }
  return perm;
}
