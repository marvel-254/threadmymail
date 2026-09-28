/**
 * BodyStore — opaque blob storage for email bodies and attachments.
 *
 * WHY THIS IS NOT IN POSTGRES (docs/ARCHITECTURE.md §4):
 *   Bodies are write-once/read-rarely opaque content. Storing them in Neon
 *   would exhaust the 0.5 GB storage cap, and — worse — a compute that never
 *   suspends burns its 100 CU-hour allowance mid-month, taking the agent dark.
 *   Postgres keeps only a `body_key` pointer.
 *
 * BACKEND: D1, not R2.
 *   R2 needs a payment method on the Cloudflare account even on the free tier.
 *   D1 does not, and is a native binding, so reads cost no network hop and no
 *   egress. The trade is a smaller budget: 500 MB per database (vs R2's 10 GB)
 *   and a 2 MB maximum value size, which is why content is chunked.
 *
 * PORTABILITY: everything above the `put`/`get`/`delete` surface is
 * backend-agnostic. Swapping D1 → R2 means reimplementing this one file; the
 * rest of the codebase only ever sees keys. See docs/ARCHITECTURE.md §4.
 */

const CHUNK_BYTES = 1_048_576; // 1 MB — comfortably under D1's 2 MB value cap
const DEFAULT_TTL_DAYS = 180;

export interface StoredMeta {
  key: string;
  size: number;
  chunks: number;
  contentType: string;
  createdAt: number;
  expiresAt: number | null;
}

export class BodyStore {
  constructor(private db: D1Database) {}

  /**
   * Store content under `key`, replacing any previous value.
   * Written as ONE batched statement set: D1 allows only 50 queries per Worker
   * invocation, so a per-chunk round trip would break on large objects.
   */
  async put(
    key: string,
    content: ArrayBuffer | Uint8Array,
    contentType = 'text/plain',
    ttlDays = DEFAULT_TTL_DAYS,
  ): Promise<StoredMeta> {
    const bytes =
      content instanceof Uint8Array ? content : new Uint8Array(content);
    const totalSize = bytes.byteLength;
    const totalChunks = Math.max(1, Math.ceil(totalSize / CHUNK_BYTES));
    const now = Date.now();
    const expiresAt = ttlDays > 0 ? now + ttlDays * 86_400_000 : null;

    const statements: D1PreparedStatement[] = [];

    for (let i = 0; i < totalChunks; i++) {
      const slice = bytes.subarray(
        i * CHUNK_BYTES,
        Math.min((i + 1) * CHUNK_BYTES, totalSize),
      );
      statements.push(
        this.db
          .prepare(
            `INSERT INTO bodies
               (key, chunk, content, content_type, total_size, total_chunks, created_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(key, chunk) DO UPDATE SET
               content = excluded.content,
               content_type = excluded.content_type,
               total_size = excluded.total_size,
               total_chunks = excluded.total_chunks,
               created_at = excluded.created_at,
               expires_at = excluded.expires_at`,
          )
          .bind(
            key,
            i,
            slice,
            contentType,
            totalSize,
            totalChunks,
            now,
            expiresAt,
          ),
      );
    }

    // Drop any stale chunks left over from a larger previous version.
    if (totalChunks === 1) {
      statements.push(
        this.db
          .prepare(
            `DELETE FROM bodies WHERE key = ?1 AND chunk > 0`,
          )
          .bind(key),
      );
    }

    await this.db.batch(statements);

    return { key, size: totalSize, chunks: totalChunks, contentType, createdAt: now, expiresAt };
  }

  /** Retrieve content and reassemble the chunks. Returns null if absent. */
  async get(
    key: string,
  ): Promise<{ content: Uint8Array; contentType: string } | null> {
    const head = await this.db
      .prepare(
        `SELECT content_type, total_size, total_chunks
           FROM bodies WHERE key = ?1 AND chunk = 0`,
      )
      .bind(key)
      .first<{ content_type: string; total_size: number; total_chunks: number }>();

    if (!head) return null;

    const rows = await this.db
      .prepare(
        `SELECT chunk, content FROM bodies
          WHERE key = ?1 ORDER BY chunk ASC`,
      )
      .bind(key)
      .all<{ chunk: number; content: ArrayBuffer }>();

    if (!rows.results.length) return null;

    const out = new Uint8Array(head.total_size);
    let offset = 0;
    for (const row of rows.results) {
      const chunk = row.content instanceof ArrayBuffer
        ? new Uint8Array(row.content)
        : new Uint8Array(row.content as unknown as ArrayBufferLike);
      // Guard against a short/empty chunk rather than throwing.
      if (chunk.byteLength) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
    }

    return {
      content: offset === head.total_size ? out : out.subarray(0, offset),
      contentType: head.content_type,
    };
  }

  /** Metadata only — does not read the payload. */
  async head(key: string): Promise<StoredMeta | null> {
    const row = await this.db
      .prepare(
        `SELECT key, content_type, total_size, total_chunks, created_at, expires_at
           FROM bodies WHERE key = ?1 AND chunk = 0`,
      )
      .bind(key)
      .first<{
        key: string;
        content_type: string;
        total_size: number;
        total_chunks: number;
        created_at: number;
        expires_at: number | null;
      }>();

    if (!row) return null;
    return {
      key: row.key,
      size: row.total_size,
      chunks: row.total_chunks,
      contentType: row.content_type,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  /** Decode a stored body as text. Convenience for the common case. */
  async getText(key: string): Promise<string | null> {
    const found = await this.get(key);
    if (!found) return null;
    return new TextDecoder().decode(found.content);
  }

  async delete(key: string): Promise<void> {
    await this.db
      .prepare(`DELETE FROM bodies WHERE key = ?1`)
      .bind(key)
      .run();
  }

  /**
   * Retention sweep. Returns the number of objects removed.
   * Called from the low-frequency cron, never from the hot heartbeat.
   */
  async pruneExpired(limit = 500): Promise<number> {
    const doomed = await this.db
      .prepare(
        `SELECT key FROM bodies
          WHERE expires_at IS NOT NULL AND expires_at < ?1
          GROUP BY key LIMIT ?2`,
      )
      .bind(Date.now(), limit)
      .all<{ key: string }>();

    const keys = doomed.results.map((r) => r.key);
    if (!keys.length) return 0;

    // Chunked DELETE so we never exceed the 100 bound-parameter limit.
    for (let i = 0; i < keys.length; i += 90) {
      const batch = keys.slice(i, i + 90);
      const placeholders = batch.map(() => '?').join(',');
      await this.db
        .prepare(`DELETE FROM bodies WHERE key IN (${placeholders})`)
        .bind(...batch)
        .run();
    }
    return keys.length;
  }

  async usage(): Promise<{ objects: number; bytes: number }> {
    const row = await this.db
      .prepare(
        `SELECT count(DISTINCT key) AS objects, coalesce(sum(total_size), 0) AS bytes
           FROM bodies`,
      )
      .first<{ objects: number; bytes: number }>();
    return { objects: row?.objects ?? 0, bytes: row?.bytes ?? 0 };
  }
}

/** Deterministic key builder. Keeping this in one place stops key drift. */
export const bodyKey = {
  email: (gmailId: string) => `em/${gmailId}`,
  attachment: (gmailId: string, attachmentId: string) =>
    `at/${gmailId}/${attachmentId}`,
  thread: (threadId: string) => `th/${threadId}`,
  artifact: (artifactId: string) => `ar/${artifactId}`,
};
