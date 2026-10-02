-- Add UNIQUE(user_id, provider) to oauth_tokens so that a re-auth upsert
-- cannot create duplicate rows and the callback can safely use ON CONFLICT.
--
-- The existing index (oauth_tokens_user_idx) is a plain non-unique index.
-- We keep it; the unique constraint creates its own backing index.

ALTER TABLE oauth_tokens
  ADD CONSTRAINT oauth_tokens_user_provider_unique UNIQUE (user_id, provider);
