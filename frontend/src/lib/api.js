/**
 * API client for the ThreadMyMail Worker.
 *
 * The Worker is not built yet, so every call here can fail. Callers must handle
 * `ApiError` and the `notConnected` case rather than assuming a response shape.
 *
 * See docs/API.md for the authoritative contract.
 */

const RAW_BASE = import.meta.env.VITE_API_BASE || '/v1';

/** Absolute ws:// or wss:// origin for the agent stream. */
export function streamOrigin() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL;
  const base =
    RAW_BASE.startsWith('http')
      ? RAW_BASE
      : `${window.location.origin}${RAW_BASE}`;
  return base.replace(/^http/, 'ws');
}

export const apiBase = RAW_BASE;

export class ApiError extends Error {
  constructor(code, message, status) {
    super(message || code || 'Request failed');
    this.code = code || 'INTERNAL';
    this.status = status ?? 0;
  }

  /** True when the backend is simply not there yet (Phase 0+ not deployed). */
  get notConnected() {
    return this.status === 0 || this.code === 'INTERNAL';
  }

  get needsReauth() {
    return this.code === 'NEEDS_REAUTH';
  }
}

let sessionToken = null;

export function setSessionToken(token) {
  sessionToken = token;
}

function authHeaders() {
  return sessionToken ? { Authorization: `Bearer ${sessionToken}` } : {};
}

async function request(method, path, { body, query, signal } = {}) {
  const url = new URL(`${apiBase}${path}`, window.location.origin);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }

  let res;
  try {
    res = await fetch(url.toString(), {
      method,
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
      credentials: 'include',
    });
  } catch (cause) {
    // Network-level failure: Worker absent, offline, or blocked.
    throw new ApiError('INTERNAL', 'Cannot reach the backend yet.', 0);
  }

  let payload = null;
  try {
    payload = await res.json();
  } catch {
    /* non-JSON response */
  }

  if (!res.ok || (payload && payload.success === false)) {
    const err = payload?.error || {};
    throw new ApiError(err.code, err.message, res.status);
  }

  return payload ? payload.data : null;
}

const get = (path, opts) => request('GET', path, opts);
const post = (path, body, opts) => request('POST', path, { ...opts, body });
const put = (path, body, opts) => request('PUT', path, { ...opts, body });
const patch = (path, body, opts) => request('PATCH', path, { ...opts, body });
const del = (path, opts) => request('DELETE', path, opts);

export const api = {
  // ── Health ───────────────────────────────────────────────────────────
  health: () => get('/health'),

  // ── Auth ─────────────────────────────────────────────────────────────
  authUrl: () => `${apiBase}/auth/google`,
  me: () => get('/auth/me'),
  authStatus: () => get('/auth/status'),
  logout: () => post('/auth/logout'),

  // ── Agent ────────────────────────────────────────────────────────────
  run: (content, extra) => post('/agent/runs', { content, ...extra }),
  runs: (query) => get('/agent/runs', { query }),
  run_: (id) => get(`/agent/runs/${id}`),
  abortRun: (id) => post(`/agent/runs/${id}/abort`),

  // ── Skills ───────────────────────────────────────────────────────────
  skills: () => get('/skills'),
  skill: (id) => get(`/skills/${id}`),
  createSkill: (body) => post('/skills', body),
  updateSkill: (id, body) => put(`/skills/${id}`, body),
  deleteSkill: (id) => del(`/skills/${id}`),
  runSkill: (id) => post(`/skills/${id}/run`),
  setSkillEnabled: (id, enabled) => post(`/skills/${id}/${enabled ? 'enable' : 'disable'}`),
  skillRuns: (id) => get(`/skills/${id}/runs`),

  // ── Tools ────────────────────────────────────────────────────────────
  tools: () => get('/tools'),
  tool: (name) => get(`/tools/${encodeURIComponent(name)}`),

  // ── Todos ────────────────────────────────────────────────────────────
  todos: (query) => get('/todos', { query }),
  createTodo: (body) => post('/todos', body),
  updateTodo: (id, body) => patch(`/todos/${id}`, body),
  toggleTodo: (id, done) => post(`/todos/${id}/toggle`, { done }),
  reorderTodos: (ids) => post('/todos/reorder', { ids }),
  deleteTodo: (id) => del(`/todos/${id}`),

  // ── Artifacts ────────────────────────────────────────────────────────
  artifact: (id) => get(`/artifacts/${id}`),

  // ── Email ────────────────────────────────────────────────────────────
  emails: (query) => get('/emails', { query }),
  email: (id) => get(`/emails/${id}`),
  emailThread: (id) => get(`/emails/${id}/thread`),
  markRead: (id) => post(`/emails/${id}/read`),
  archiveEmail: (id) => post(`/emails/${id}/archive`),
  labelEmail: (id, labelIds) => post(`/emails/${id}/label`, { label_ids: labelIds }),
  syncStatus: () => get('/emails/sync/status'),
  triggerSync: () => post('/emails/sync'),

  // ── Calendar ─────────────────────────────────────────────────────────
  events: (from, to) => get('/calendar/events', { query: { from, to } }),
  freebusy: (from, to, attendees) =>
    get('/calendar/freebusy', { query: { from, to, attendees } }),
  agentEvents: () => get('/calendar/agent-created'),

  // ── Memory ───────────────────────────────────────────────────────────
  memories: (query) => get('/memories', { query }),
  remember: (body) => post('/memories', body),
  updateMemory: (id, body) => patch(`/memories/${id}`, body),
  deleteMemory: (id) => del(`/memories/${id}`),
  profile: () => get('/memories/profile'),
  updateProfile: (body) => put('/memories/profile', body),

  // ── Plugins ──────────────────────────────────────────────────────────
  plugins: () => get('/plugins'),
  pluginManifest: (url) => get('/plugins/manifest', { query: { url } }),
  installPlugin: (body) => post('/plugins/install', body),
  pluginCredentials: (id, fields) => post(`/plugins/${id}/credentials`, { fields }),
  pluginPermissions: (id) => get(`/plugins/${id}/permissions`),
  setPluginPermissions: (id, grants) => put(`/plugins/${id}/permissions`, { grants }),
  setPluginEnabled: (id, enabled) =>
    post(`/plugins/${id}/${enabled ? 'enable' : 'disable'}`),
  uninstallPlugin: (id) => del(`/plugins/${id}`),

  // ── Activity & undo ──────────────────────────────────────────────────
  activity: (query) => get('/activity', { query }),
  undoActivity: (id) => post(`/activity/${id}/undo`),
  activityDigest: (date) => get('/activity/digest', { query: { date } }),

  // ── Settings & autonomy ──────────────────────────────────────────────
  settings: () => get('/settings'),
  saveSettings: (body) => put('/settings', body),
  usage: () => get('/settings/usage'),
  killSwitch: () => get('/kill-switch'),
  setKillSwitch: (body) => put('/kill-switch', body),

  // ── Webhooks ─────────────────────────────────────────────────────────
  webhook: (id, payload, secret) =>
    request('POST', `/webhooks/${id}`, { body: { ...payload, secret } }),
};

/**
 * The fixed verb allowlist an artifact frame may dispatch.
 * Mirrors docs/AI-SKILLS.md §7.1 — never widen this in the client.
 */
export const BINDING_VERBS = Object.freeze([
  'todo.toggle',
  'todo.create',
  'todo.update',
  'todo.reorder',
  'todo.delete',
  'event.rsvp',
  'email.archive',
  'email.mark_read',
  'email.label',
]);

const VERB_ROUTES = {
  'todo.toggle': (id, p) => api.toggleTodo(id, Boolean(p.done)),
  'todo.create': (_id, p) => api.createTodo(p),
  'todo.update': (id, p) => api.updateTodo(id, p),
  'todo.reorder': (_id, p) => api.reorderTodos(p.ids),
  'todo.delete': (id) => api.deleteTodo(id),
  'email.archive': (id) => api.archiveEmail(id),
  'email.mark_read': (id) => api.markRead(id),
  'email.label': (id, p) => api.labelEmail(id, p.label_ids || []),
  // Calendar bindings exist in the protocol but have no endpoint until Phase 5.
  // Failing loudly beats a silent no-op that looks like it worked.
  'event.rsvp': () => {
    throw new ApiError(
      'NOT_IMPLEMENTED',
      'Calendar RSVP is not wired up yet (Phase 5).',
      501,
    );
  },
};

/** Dispatch a binding verb. Rejects anything outside the allowlist. */
export async function dispatchBinding(verb, id, payload) {
  const fn = VERB_ROUTES[verb];
  if (!fn || !BINDING_VERBS.includes(verb)) {
    throw new ApiError('FORBIDDEN', `Binding verb not allowed: ${verb}`, 400);
  }
  return fn(id, payload || {});
}
