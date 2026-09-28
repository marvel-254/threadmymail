-- Phase 1 development user.
--
-- Real user rows are created on first Google OAuth (Phase 2). Until then the API
-- needs one to scope its queries against, because every table is keyed by user_id
-- and the foreign keys are real. This row is replaced the moment OAuth runs.
--
-- Id matches DEV_USER_ID in src/http/routes.ts.

INSERT INTO users (id, email, full_name, profile, ai_config, prefs, budget_state)
VALUES (
  '00000000-0000-4000-8000-000000000001',
  'me@threadmymail.local',
  'Me',
  '{"timezone": "Europe/Berlin"}'::jsonb,
  '{
    "primary":    { "provider": "openrouter", "model": "", "temperature": 0.4, "max_tokens": 8000 },
    "background": { "provider": "openrouter", "model": "", "temperature": 0.1, "max_tokens": 2000 },
    "max_steps": 12
  }'::jsonb,
  '{
    "new_contact_policy": "ask",
    "new_contact_allowlist": [],
    "notification_threshold": 7,
    "digest_time": "07:00",
    "timezone": "Europe/Berlin",
    "quiet_hours": { "start": "22:00", "end": "07:30" }
  }'::jsonb,
  '{}'::jsonb
)
ON CONFLICT (id) DO NOTHING;
