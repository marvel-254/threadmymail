-- Email body / attachment store.
--
-- WHY THIS EXISTS (docs/ARCHITECTURE.md §4):
--   Postgres holds only a `body_key` pointer. The body itself is opaque content
--   that is written once and read rarely. Putting it in Neon would burn the
--   0.5 GB storage cap and, worse, keep Neon's compute awake (a compute that
--   never suspends exhausts its 100 CU-hour allowance mid-month).
--
-- WHY D1 INSTEAD OF R2:
--   R2 requires a payment method on the Cloudflare account even on the free
--   tier. D1 does not. D1 is also a native binding, so reads cost no network
--   hop and no egress.
--
-- Free-plan limits that shaped this schema (Cloudflare D1 limits, 2026-09):
--   - 500 MB per database, 5 GB per account, 1 database free
--   - 2 MB maximum value size  →  `content` is split into 1 MB CHUNKS
--   - 100,000 rows written/day, 5,000,000 rows read/day
--   - Maximum 50 queries per Worker invocation
--
-- Consequences:
--   1. Chunks are 1 MB, under the 2 MB value limit, so a large attachment can
--      span several rows. Reads reassemble them.
--   2. A body is written as ONE batched statement set, not one-per-chunk round
--      trip, to stay well inside the 50-queries-per-invocation limit.
--   3. `expires_at` drives the retention sweep; nothing here is permanent.
--   4. Attachments are NOT auto-downloaded (see docs/PLAN.md §4). They are
--      fetched on demand and expire fast, so the 500 MB budget goes to bodies.

CREATE TABLE IF NOT EXISTS bodies (
  -- Chunk identity. Chunk 0 is the head chunk.
  key          TEXT    NOT NULL,
  chunk        INTEGER NOT NULL DEFAULT 0,
  -- BLOB/TEXT chunk of the payload. Size is bounded by the 1 MB chunk size.
  content      BLOB    NOT NULL,
  content_type TEXT    NOT NULL DEFAULT 'text/plain',
  -- Total byte length of the whole object across all chunks.
  total_size   INTEGER NOT NULL,
  total_chunks INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER,
  PRIMARY KEY (key, chunk)
);

-- Retention sweep: find expired objects, then delete by key.
CREATE INDEX IF NOT EXISTS bodies_expires_idx ON bodies (expires_at);

-- Look up an object's head chunk metadata without reading its payload.
CREATE INDEX IF NOT EXISTS bodies_key_idx ON bodies (key, chunk);
