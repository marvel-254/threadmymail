-- ThreadMyMail initial schema
-- Target: Neon (Postgres 17). Extensions vector + pg_trgm must already exist.
--
-- Design rules enforced here (docs/ARCHITECTURE.md):
--   1. No email bodies in Postgres. Bodies live in R2; this table holds body_key.
--   2. gen_random_uuid() is native in PG17 — no uuid-ossp dependency.
--   3. Read-after-write paths must query through the cache-disabled Hyperdrive
--      binding (DB_FRESH), because Hyperdrive does not invalidate reads on write.

-- ── Identity ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub   TEXT UNIQUE,
  email        TEXT UNIQUE NOT NULL,
  full_name    TEXT,
  -- Editable system-prompt override. NULL means "use the shipped default".
  persona      TEXT,
  -- Structured facts the agent maintains. User-editable; never secret.
  profile      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- { primary: {provider,model,temperature,max_tokens}, background: {...}, max_steps }
  ai_config    JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Autonomy policy: new_contact_policy, quiet_hours, notification_threshold.
  prefs        JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- Daily token/spend consumption, reset by the worker.
  budget_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Generic and scope-aware. One row serves BOTH Gmail and Calendar so there is a
-- single Google connection (docs/GOOGLE_OAUTH.md). Scopes are recorded so a
-- newly added scope is detected and a targeted re-consent is triggered.
CREATE TABLE IF NOT EXISTS oauth_tokens (
  id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider               TEXT NOT NULL,
  scopes                 TEXT[] NOT NULL,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  expires_at             TIMESTAMPTZ,
  needs_reauth           BOOLEAN NOT NULL DEFAULT FALSE,
  created_at             TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS oauth_tokens_user_idx ON oauth_tokens (user_id, provider);

-- ── Agent execution ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS skills (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- What the model reads when deciding whether to invoke this skill.
  description   TEXT,
  -- Plain-language instructions. No code.
  instructions  TEXT NOT NULL,
  -- SECURITY BOUNDARY: the model receives no tool absent from this array.
  allowed_tools TEXT[] NOT NULL DEFAULT '{}',
  -- { type: 'on_demand'|'cron'|'event', config: {...} }
  trigger       JSONB NOT NULL DEFAULT '{"type":"on_demand","config":{}}'::jsonb,
  -- { max_runs_per_day, max_tokens }
  budget        JSONB NOT NULL DEFAULT '{}'::jsonb,
  model_slot    TEXT NOT NULL DEFAULT 'inherit',
  enabled       BOOLEAN NOT NULL DEFAULT TRUE,
  -- New skills run shadowed: outward actions recorded, not performed.
  dry_run_until TIMESTAMPTZ,
  version       INTEGER NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS skills_user_idx ON skills (user_id, enabled);

CREATE TABLE IF NOT EXISTS agent_runs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_id      UUID REFERENCES skills(id) ON DELETE SET NULL,
  -- Subagent runs point at their parent. Depth is enforced in code (max 2).
  parent_run_id UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
  trigger       TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'running',
  input         JSONB,
  output        JSONB,
  model         TEXT,
  tokens_in     INTEGER NOT NULL DEFAULT 0,
  tokens_out    INTEGER NOT NULL DEFAULT 0,
  cost_usd      NUMERIC(10,6) NOT NULL DEFAULT 0,
  error         TEXT,
  started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS agent_runs_user_idx  ON agent_runs (user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS agent_runs_parent_idx ON agent_runs (parent_run_id);

-- The audit trail. This table is the product's defense: an autonomous system
-- that will not log what it did is not trustworthy.
CREATE TABLE IF NOT EXISTS tool_calls (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  -- Fully-qualified, including plugin prefix: "notion.notes_append".
  tool        TEXT NOT NULL,
  args        JSONB,
  result      JSONB,
  ok          BOOLEAN NOT NULL DEFAULT TRUE,
  latency_ms  INTEGER,
  tokens      INTEGER NOT NULL DEFAULT 0,
  -- True when the action can be undone (undo stack).
  reversible  BOOLEAN NOT NULL DEFAULT FALSE,
  undo_ref    TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS tool_calls_run_idx ON tool_calls (run_id, created_at);

-- ── Plugins ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS plugins (
  id          TEXT PRIMARY KEY,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  manifest    JSONB NOT NULL,
  source      TEXT NOT NULL,               -- 'builtin' | git URL
  -- Pinned. An unpinned git install is rejected by the API.
  source_sha  TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  -- { "tool.name": ["permission", ...] } — the effective grant set.
  tool_grants JSONB NOT NULL DEFAULT '{}'::jsonb,
  installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS plugins_user_idx ON plugins (user_id);

CREATE TABLE IF NOT EXISTS plugin_credentials (
  plugin_id       TEXT NOT NULL,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,
  value_encrypted TEXT NOT NULL,
  PRIMARY KEY (plugin_id, user_id, key)
);

-- ── Work items ──────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS todos (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title             TEXT NOT NULL,
  notes             TEXT,
  status            TEXT NOT NULL DEFAULT 'open',      -- open | done | dropped
  priority          INTEGER NOT NULL DEFAULT 0,         -- 1..10
  due_at            TIMESTAMPTZ,
  source            TEXT,                               -- agent|user|email|notion
  source_ref        TEXT,
  thread_id         TEXT,
  calendar_event_id TEXT,
  position          INTEGER NOT NULL DEFAULT 0,
  completed_at      TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS todos_user_status_idx ON todos (user_id, status, due_at);

-- Agent-authored HTML. Rendered in a sandboxed iframe; Postgres stays the
-- source of truth and the frame is only a projection.
CREATE TABLE IF NOT EXISTS artifacts (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id     UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  html       TEXT NOT NULL,
  state      JSONB NOT NULL DEFAULT '{}'::jsonb,
  -- The verb allowlist this frame may dispatch. Never widened client-side.
  bindings   TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS artifacts_run_idx ON artifacts (run_id);

-- ── Memory & context ────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS memories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,                 -- fact|preference|commitment|person
  content    TEXT NOT NULL,
  importance INTEGER NOT NULL DEFAULT 5,     -- 1..10, drives retention
  -- Pinned memories are user-locked and never auto-pruned.
  pinned     BOOLEAN NOT NULL DEFAULT FALSE,
  source_ref TEXT,
  embedding  vector(1536),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS memories_user_idx    ON memories (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS memories_pinned_idx  ON memories (user_id) WHERE pinned;
CREATE INDEX IF NOT EXISTS memories_vec_idx     ON memories USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE TABLE IF NOT EXISTS contacts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,
  name         TEXT,
  relation     TEXT,                         -- the agent's read: "manager", "friend"
  first_seen   TIMESTAMPTZ,
  last_contact TIMESTAMPTZ,
  metadata     JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (user_id, email)
);

-- ── Email (metadata only — bodies live in R2) ───────────────────────────────

CREATE TABLE IF NOT EXISTS email_messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  gmail_id        TEXT NOT NULL,
  thread_id       TEXT,
  subject         TEXT,
  from_address    TEXT,
  to_addresses    JSONB,
  snippet         TEXT,
  -- R2 key for the body. NEVER store the body itself (docs/ARCHITECTURE.md §4).
  body_key        TEXT,
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  label_ids       TEXT[] NOT NULL DEFAULT '{}',
  received_at     TIMESTAMPTZ NOT NULL,
  read_at         TIMESTAMPTZ,
  ai_summary      TEXT,
  ai_priority     INTEGER NOT NULL DEFAULT 0,
  embedding       vector(1536),
  UNIQUE (user_id, gmail_id)
);

CREATE INDEX IF NOT EXISTS email_thread_idx   ON email_messages (user_id, thread_id);
CREATE INDEX IF NOT EXISTS email_recent_idx   ON email_messages (user_id, received_at DESC);
CREATE INDEX IF NOT EXISTS email_unread_idx   ON email_messages (user_id, received_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS email_bodykey_idx  ON email_messages (body_key) WHERE body_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_vec_idx      ON email_messages USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

-- ── Activity & undo ─────────────────────────────────────────────────────────

-- Plain-language feed. Undo references whatever the action touched.
CREATE TABLE IF NOT EXISTS activity (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id     UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  summary    TEXT NOT NULL,
  reversible BOOLEAN NOT NULL DEFAULT FALSE,
  undo_ref   TEXT,
  undone_at  TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_user_idx ON activity (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS activity_undo_idx ON activity (undo_ref) WHERE undo_ref IS NOT NULL;

-- ── Heartbeat state ─────────────────────────────────────────────────────────
-- IMPORTANT: the live sync cursor lives in the Durable Object, NOT here. The
-- 5-minute tick must never query Postgres, or Neon never suspends and burns
-- its 100 CU-hour allowance (docs/ARCHITECTURE.md §5). This table is only a
-- coarse, low-frequency observability record.

CREATE TABLE IF NOT EXISTS sync_state (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  last_sync_at   TIMESTAMPTZ,
  last_history_id TEXT,                      -- mirror for observability only
  last_error     TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
