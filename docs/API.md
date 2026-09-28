# ThreadMyMail - API Specification

> REST + WebSocket surface for the agent platform.
> **Status:** Authoritative. **Last updated:** 2026-09-27
> **Supersedes:** the earlier `summarize` / `compose` / `triage` / `chat` /
> `extract-tasks` endpoint set. Those capabilities now exist as **skills** and
> **tools**; see [AI-SKILLS.md](./AI-SKILLS.md).

---

## 1. Base URL & Conventions

```
https://threadmymail.workers.dev/v1
```

Auth: `Authorization: Bearer <session_token>` (or a session cookie for the web
client).

### 1.1 Envelope

Success:
```json
{ "success": true, "data": { }, "error": null }
```

Error:
```json
{
  "success": false,
  "data": null,
  "error": { "code": "PRECONDITION_FAILED", "message": "Connect Gmail first.", "detail": null }
}
```

### 1.2 Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing/invalid session |
| `NEEDS_REAUTH` | 401 | Google token expired; re-consent required |
| `FORBIDDEN` | 403 | Tool or permission not granted |
| `NOT_FOUND` | 404 | Resource missing |
| `PRECONDITION_FAILED` | 409 | Connection or setup not done |
| `BUDGET_EXCEEDED` | 429 | Daily autonomy budget spent |
| `AGENT_ABORTED` | 409 | Run cancelled (kill switch / escalation) |
| `RATE_LIMITED` | 429 | Per-endpoint limit |
| `INTERNAL` | 500 | Unexpected |

---

## 2. Auth

Google OAuth is the **sole** sign-in. One consent grants identity + Gmail +
Calendar. See [GOOGLE_OAUTH.md](./GOOGLE_OAUTH.md).

### `GET /auth/google`
Redirect to Google's consent screen. Returns 302.

### `GET /auth/google/callback?code=...`
Handles the redirect, upserts the user, stores tokens, sets the session cookie.
Returns 302 to the app.

### `POST /auth/logout`
Clears the session.

### `GET /auth/me`
```json
{ "success": true, "data": {
  "id": "uuid",
  "email": "you@gmail.com",
  "full_name": "Your Name",
  "connections": {
    "gmail":      { "connected": true,  "email": "you@gmail.com" },
    "calendar":   { "connected": true,  "email": "you@gmail.com" }
  },
  "persona_configured": false,
  "plugin_ids": ["gmail", "google_calendar", "todo", "memory", "exa"]
}}
```

### `GET /auth/status`
Lightweight health of the Google connection and token expiry.

---

## 3. Agent

### `GET /agent/stream` — WebSocket
The primary interface. Connect, send messages, receive streamed tokens and
tool-call events.

**Client → server**
```json
{ "type": "message", "id": "msg_1", "content": "what's waiting on me?" }
{ "type": "interrupt", "id": "run_xyz" }
```

**Server → client**
```json
{ "type": "token",        "run_id": "run_xyz", "text": "Three things are waiting." }
{ "type": "tool_call",    "run_id": "run_xyz", "tool": "todo.search",
  "args": { "status": "open" } }
{ "type": "tool_result",  "run_id": "run_xyz", "tool": "todo.search",
  "ok": true, "latency_ms": 42, "summary": "7 open" }
{ "type": "artifact",     "run_id": "run_xyz", "artifact_id": "art_1",
  "kind": "todo_panel" }
{ "type": "escalation",   "run_id": "run_xyz", "question": "Send to dana@newco.com?",
  "choices": ["yes", "no", "always"] }
{ "type": "done",         "run_id": "run_xyz", "tokens": 1420, "cost_usd": 0.0031 }
{ "type": "error",        "run_id": "run_xyz", "code": "BUDGET_EXCEEDED",
  "message": "Daily budget reached." }
```

### `POST /agent/runs`
Non-streaming execution. Useful for scripting and tests.
```json
{ "content": "summarize today's mail", "skill_id": null, "stream": false }
```
→ `{ "run_id": "run_xyz", "status": "completed", "output": { }, "tokens": 980 }`

### `GET /agent/runs?limit=50&status=completed`
Run history with per-run token/cost rollups.

### `GET /agent/runs/:id`
Full run detail including every `tool_calls` row.

### `POST /agent/runs/:id/abort`
Interrupt an in-flight run.

### `POST /agent/chat`
Convenience non-streaming single turn (no tools beyond safe reads).

---

## 4. Skills

### `GET /skills`
```json
{ "success": true, "data": [
  { "id": "uuid", "name": "morning_briefing", "enabled": true,
    "trigger": { "type": "cron", "config": { "expression": "0 7 * * *", "timezone": "Europe/Berlin" } },
    "model_slot": "background",
    "last_run_at": "2026-09-27T06:00:02Z", "runs_today": 1 }
]}
```

### `GET /skills/:id`
### `POST /skills`
```json
{
  "name": "chase_invoices",
  "description": "Checks for unpaid invoices and nudges.",
  "instructions": "Find threads mentioning invoice or payment older than 7 days...",
  "allowed_tools": ["email.search", "email.get_thread", "email.send", "todo.create"],
  "trigger": { "type": "cron", "config": { "expression": "0 9 * * 1-5", "timezone": "Europe/Berlin" } },
  "budget": { "max_runs_per_day": 5, "max_tokens": 40000 },
  "model_slot": "background"
}
```
→ creates with `dry_run_until` set (shadow mode) unless `"skip_dry_run": true`.

### `PUT /skills/:id` / `DELETE /skills/:id`
### `POST /skills/:id/run` — invoke now
### `POST /skills/:id/enable` / `POST /skills/:id/disable`
### `POST /skills/:id/dry-run` — toggle shadow mode
### `GET /skills/:id/runs` — run history

**Constraint:** `allowed_tools` is a security boundary. The model receives *no*
tool it was not granted, so prompt injection cannot widen a skill's reach.

---

## 5. Tools

### `GET /tools`
All tools visible to the agent, grouped, with grant state.
```json
{ "success": true, "data": [
  { "name": "email.search", "plugin": "gmail", "granted": true,
    "description": "...", "parameters": { } }
]}
```

### `GET /tools/:name` — full schema

> Tools are invoked **by the agent**, not by the client. There is intentionally
> no public `POST /tools/:name/execute`. Any action a tool can perform is
> reachable through the agent loop, where permissions, budgets, and the audit
> trail apply. Direct invocation would bypass all three.

---

## 6. To-dos

Bound mutations from artifacts land here. All reads must use `DB_FRESH`
(see ARCHITECTURE §6).

### `GET /todos`
Query: `status`, `due_before`, `source`, `thread_id`, `limit`, `cursor`.

### `POST /todos`
```json
{ "title": "Review Q3 budget variance", "notes": null, "due_at": "2026-09-30T17:00:00Z",
  "priority": 7, "source": "agent", "thread_id": "18f2…" }
```

### `GET /todos/:id`
### `PATCH /todos/:id`
### `POST /todos/:id/toggle` — **artifact binding target**
```json
{ "done": true }
```
Completes or reopens, emits `todo.completed` to the agent, and returns the
updated record.

### `POST /todos/reorder`
```json
{ "ids": ["8f3c…", "1a2b…", "9d4e…"] }
```

### `DELETE /todos/:id`

---

## 7. Artifacts

### `GET /artifacts/:id`
```json
{ "success": true, "data": {
  "id": "art_1", "kind": "todo_panel", "run_id": "run_xyz",
  "html": "<ul data-artifact=\"todos\">…</ul>",
  "state": { "todo_ids": ["8f3c…", "1a2b…"] },
  "bindings": ["todo.toggle", "todo.create", "todo.update"]
}}
```

> `html` is agent-authored and must be rendered in a **sandboxed iframe**:
> `sandbox="allow-scripts"` — no `allow-same-origin`, no `allow-top-navigation`,
> no network. The shell intercepts `postMessage` `bind_event` messages and
> dispatches only the verbs in `bindings` to the API above.
>
> The HTML is **presentation only**. Postgres is the source of truth; the iframe
> is a projection. See AI-SKILLS §7.

---

## 8. Email

### `GET /emails`
Query: `q` (Gmail syntax), `thread_id`, `label`, `unread`, `limit`, `cursor`.
Returns metadata + snippet. **Bodies are not included** — they live in the D1 body
store and are fetched on demand.

### `GET /emails/:id`
Full message. Body resolved from the D1 body store.

### `GET /emails/:id/thread`
### `POST /emails/:id/read`
### `POST /emails/:id/archive`
### `POST /emails/:id/label` — **artifact binding target**
### `POST /emails/sync` — trigger a sync now
### `GET /emails/sync/status` — cursor, last sync, error state

Sending is agent-only (`email.send` tool), subject to `new_contact_policy` and
the autonomy budget. This is deliberate: an API endpoint that sends mail on
behalf of a token is a footgun with no audit story.

---

## 9. Calendar

### `GET /calendar/events?from=&to=`
### `GET /calendar/freebusy?from=&to=&attendees[]=`
### `GET /calendar/agent-created`
Booking and modification are agent-only (`calendar.create_event`), subject to
`new_contact_policy`.

---

## 10. Memory

### `GET /memories?q=&kind=&limit=`
### `POST /memories`
```json
{ "kind": "commitment", "content": "Promised Dana the Q3 numbers by Friday",
  "importance": 8, "pinned": false, "source_ref": "run_xyz" }
```
### `PATCH /memories/:id` — including `pinned`
### `DELETE /memories/:id`
### `GET /memories/profile`
### `PUT /memories/profile`

`pinned` memories are user-locked and never auto-pruned.

---

## 11. Plugins

### `GET /plugins`
```json
{ "success": true, "data": [
  { "id": "notion", "name": "Notion", "version": "1.0.0", "source": "builtin",
    "enabled": true, "configured": false, "tools": 5, "permissions": [
      "network:api.notion.com", "data:notes:read", "data:notes:write" ] }
]}
```

### `GET /plugins/manifest?url=<git url>` — **review before install**
Fetches and validates a manifest without installing. Powers the approval UI.

### `POST /plugins/install`
```json
{ "url": "https://github.com/me/my-notion-plugin", "sha": "abc123…",
  "grants": { "notes_append": ["data:notes:write", "network:api.notion.com"] } }
```
Rejects if `sha` is absent (no unpinned installs).

### `POST /plugins/:id/credentials`
```json
{ "fields": { "token": "secret_…" } }
```
Encrypted at rest. Never returned by any endpoint.

### `GET /plugins/:id/permissions` / `PUT /plugins/:id/permissions`
Per-tool grant control.

### `POST /plugins/:id/enable` / `disable` / `uninstall`
`GET /plugins/:id/diff?url=&sha=` — manifest diff for an update.

---

## 12. Activity & Undo

### `GET /activity?limit=100`
The plain-language feed.
```json
{ "success": true, "data": [
  { "id": "uuid", "kind": "meeting_booked",
    "summary": "Booked 'Q3 Budget Review' with Dana, Thu 14:00–14:30",
    "reversible": true, "undo_ref": "cal_18f2…", "created_at": "2026-09-27T09:12:44Z" }
]}
```

### `POST /activity/:id/undo`
Reverses a reversible action — retracts a sent email, deletes an agent-created
event, reopens a completed todo. Idempotent.

### `GET /activity/:id` — full tool-call trace

---

## 13. Autonomy & Settings

### `GET /settings` / `PUT /settings`

```jsonc
{
  "persona": "…",                       // override; null = default
  "profile": { },                       // agent-maintained, user-editable
  "ai_config": {
    "primary":    { "provider": "openrouter", "model": "…", "temperature": 0.4 },
    "background": { "provider": "openrouter", "model": "…", "temperature": 0.1 },
    "max_steps": 12
  },
  "prefs": {
    "new_contact_policy": "ask",        // ask | allow | block
    "new_contact_allowlist": [],
    "quiet_hours": { "from": "22:00", "to": "07:30", "timezone": "Europe/Berlin" },
    "notification_threshold": 7,        // urgency 1-10 that triggers a push
    "digest_time": "07:00",
    "never_notify": []
  },
  "budget": { "daily_tokens": 200000, "daily_usd": 2.0, "max_outbound_per_day": 20 }
}
```

### `GET /settings/usage`
Daily and monthly token/cost rollup by skill, run, and model.

### `GET /kill-switch` / `PUT /kill-switch`
```json
{ "global": false, "skills": { "uuid": false } }
```

**`PUT`, not `POST`** — the frontend sends `PUT`. (An earlier draft of this
document said `POST`; the code was the source of truth.)

**The switch is written in two places and they are never allowed to disagree:**

| Where | Why |
|---|---|
| Durable Object storage | The only thing that can abort a run already in flight |
| `users.prefs.kill_switch` | So the API and UI agree on persisted state |

The agent checks **both** before every step. An earlier build wrote only to
Postgres, so engaging the switch left the agent running — a safety control that
can disagree with itself is not a safety control. `GET /kill-switch/live`
returns the DO's own flag for diagnostics.

Takes effect at the current step boundary.

### `GET /activity/digest?date=`
The daily action digest.

---

## 14. Webhooks (plugin)

### `POST /webhooks/:id`
Inbound. Authenticated by per-webhook secret (bearer token or HMAC-SHA256).
Rate-limited. Triggers only skills whose `trigger.config.webhook` matches.
Returns 202 immediately; the skill runs as an `agent_runs` row.

---

## 15. Health

### `GET /health`
```json
{ "success": true, "data": {
  "status": "ok",
  "db": "ok", "r2": "ok", "gmail": "ok",
  "cron": { "last_tick_at": "2026-09-27T09:15:00Z", "last_tick_ok": true },
  "version": "0.1.0"
}}
```

> **Keep this cheap.** Cloudflare Free allows 10 ms CPU per invocation on the
> HTTP path. This endpoint must not query Neon through a path that could be
> cache-stale, and must not fan out. Use Hyperdrive `DB` (cached) here, and
> bound it to a single trivial query.

---

## 16. Removed Endpoints

| Removed | Replacement |
|---|---|
| `POST /ai/summarize` | Skill `summarize_thread`, or the agent loop |
| `POST /ai/compose` | Skill `draft_replies`, or the agent loop |
| `POST /ai/triage` | Skill `triage_inbox` (cron-triggered) |
| `POST /ai/chat` | `GET /agent/stream` (WebSocket) |
| `POST /ai/extract-tasks` | `todo.create` tool via the agent |
| `GET /auth/magic-link`, `POST /auth/verify` | Google OAuth only |
| `GET /accounts`, `POST /accounts/:id` | Google OAuth; no manual account CRUD |
| `POST /tasks` (APScheduler) | `/skills` with a `cron` trigger |

---

*Related: [ARCHITECTURE.md](./ARCHITECTURE.md) · [AI-SKILLS.md](./AI-SKILLS.md) ·
[PLUGINS.md](./PLUGINS.md) · [GOOGLE_OAUTH.md](./GOOGLE_OAUTH.md)*
