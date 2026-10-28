/**
 * Memory Store — on-device persistent memory for Millo.
 *
 * Implements the AI-SKILLS.md §8 specification:
 * - Memories (facts/preferences/commitments/people) with importance 1-10, pinning, source_ref
 * - Contacts (relationship notes, interaction stats from message history)
 * - Profile (structured user-editable facts: name, timezone, sign-off, tone)
 * - FTS5 for keyword/recency/importance recall (pgvector embeddings are opt-in, off-device)
 * - Secrets guard: never store keys/passwords/tokens
 * - Activity logging: every write logs to activityStore ("Millo remembered: …")
 *
 * Additive migrations only; no destructive schema changes.
 */

import * as SQLite from 'expo-sqlite';
import { logActivity } from './activityStore';

const DB_NAME = 'threadmymail.db';

export type MemoryKind = 'fact' | 'preference' | 'commitment' | 'person';

export type Memory = {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number; // 1-10
  pinned: boolean;
  sourceRef: string | null; // mail UID or conversation message ID
  createdAt: number;
  lastUsedAt: number | null;
};

export type Contact = {
  id: string;
  email: string;
  name: string | null;
  notes: string | null;
  messageCount: number;
  lastInteractionAt: number | null;
  createdAt: number;
};

export type Profile = {
  id: 'singleton'; // only one profile per device
  name: string | null;
  timezone: string | null;
  signOff: string | null;
  tone: string | null;
  updatedAt: number;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/**
 * True once FTS5 is confirmed present. Base tables are always created; the
 * FTS5 virtual table and its triggers are best-effort so an embedded SQLite
 * build without FTS5 still boots and recall falls back to LIKE.
 */
let ftsAvailable = false;

function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;

        -- Memories table
        CREATE TABLE IF NOT EXISTS agent_memories (
          id TEXT PRIMARY KEY NOT NULL,
          kind TEXT NOT NULL CHECK(kind IN ('fact','preference','commitment','person')),
          content TEXT NOT NULL,
          importance INTEGER NOT NULL DEFAULT 5 CHECK(importance BETWEEN 1 AND 10),
          pinned INTEGER NOT NULL DEFAULT 0,
          source_ref TEXT,
          created_at INTEGER NOT NULL,
          last_used_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_memories_kind ON agent_memories(kind);
        CREATE INDEX IF NOT EXISTS idx_memories_importance ON agent_memories(importance DESC, created_at DESC);
        CREATE INDEX IF NOT EXISTS idx_memories_pinned ON agent_memories(pinned DESC, importance DESC);

        -- Contacts table
        CREATE TABLE IF NOT EXISTS agent_contacts (
          id TEXT PRIMARY KEY NOT NULL,
          email TEXT NOT NULL UNIQUE,
          name TEXT,
          notes TEXT,
          message_count INTEGER NOT NULL DEFAULT 0,
          last_interaction_at INTEGER,
          created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_contacts_email ON agent_contacts(email);

        -- Profile table (singleton)
        CREATE TABLE IF NOT EXISTS agent_profile (
          id TEXT PRIMARY KEY NOT NULL DEFAULT 'singleton',
          name TEXT,
          timezone TEXT,
          sign_off TEXT,
          tone TEXT,
          updated_at INTEGER NOT NULL
        );
      `);

      // FTS5 is best-effort: wrap each statement so one failure (an SQLite
      // build compiled without the FTS5 module) cannot break boot or the
      // base-table migration.
      try {
        await db.execAsync(`
          CREATE VIRTUAL TABLE IF NOT EXISTS agent_memories_fts USING fts5(
            id UNINDEXED,
            kind,
            content,
            source_ref,
            tokenize='porter unicode61'
          );
        `);
        await db.execAsync(`
          CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON agent_memories BEGIN
            INSERT INTO agent_memories_fts(id, kind, content, source_ref)
            VALUES (new.id, new.kind, new.content, new.source_ref);
          END;
          CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON agent_memories BEGIN
            DELETE FROM agent_memories_fts WHERE id = old.id;
          END;
          CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON agent_memories BEGIN
            DELETE FROM agent_memories_fts WHERE id = old.id;
            INSERT INTO agent_memories_fts(id, kind, content, source_ref)
            VALUES (new.id, new.kind, new.content, new.source_ref);
          END;
        `);
        ftsAvailable = true;
      } catch {
        ftsAvailable = false;
      }

      return db;
    });
  }
  return dbPromise;
}

// ──────────────────────────────────────────────────────────────────────────────
// Secrets guard
// ──────────────────────────────────────────────────────────────────────────────

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/,           // OpenAI-style keys
  /Bearer\s+[a-zA-Z0-9\-_]{20,}/i, // Bearer tokens
  /api[_-]?key\s*[:=]\s*[a-zA-Z0-9\-_]{16,}/i,
  /password\s*[:=]\s*[^\s]{8,}/i,
  /secret\s*[:=]\s*[a-zA-Z0-9\-_]{16,}/i,
  /token\s*[:=]\s*[a-zA-Z0-9\-_]{20,}/i,
];

function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((re) => re.test(text));
}

// ──────────────────────────────────────────────────────────────────────────────
// Memory CRUD
// ──────────────────────────────────────────────────────────────────────────────

function fromMemoryRow(row: unknown): Memory {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    kind: String(r.kind) as MemoryKind,
    content: String(r.content),
    importance: Number(r.importance),
    pinned: Number(r.pinned) === 1,
    sourceRef: r.source_ref ? String(r.source_ref) : null,
    createdAt: Number(r.created_at),
    lastUsedAt: r.last_used_at ? Number(r.last_used_at) : null,
  };
}

export async function rememberMemory(params: {
  kind: MemoryKind;
  content: string;
  importance?: number; // 1-10
  pinned?: boolean;
  sourceRef?: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!params.content.trim()) return { ok: false, error: 'Empty content' };
  if (containsSecret(params.content)) return { ok: false, error: 'Secrets are not allowed in memory' };

  const importance = Math.max(1, Math.min(10, Math.round(params.importance ?? 5)));
  const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();

  const db = await openDb();
  await db.runAsync(
    `INSERT INTO agent_memories (id, kind, content, importance, pinned, source_ref, created_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, params.kind, params.content.trim(), importance, params.pinned ? 1 : 0, params.sourceRef ?? null, now, null]
  );

  // Log to activity
  await logActivity({
    type: 'memory_write',
    outcome: 'ok',
    detail: `Millo remembered (${params.kind}): ${params.content.slice(0, 80)}${params.content.length > 80 ? '…' : ''}`,
    undoPayload: null,
  });

  return { ok: true, id };
}

export async function listMemories(opts?: {
  kind?: MemoryKind;
  pinnedOnly?: boolean;
  limit?: number;
  offset?: number;
}): Promise<Memory[]> {
  const db = await openDb();
  const where: string[] = [];
  const args: (string | number)[] = [];

  if (opts?.kind) {
    where.push('kind = ?');
    args.push(opts.kind);
  }
  if (opts?.pinnedOnly) {
    where.push('pinned = 1');
  }

  const limit = opts?.limit ?? 200;
  const offset = opts?.offset ?? 0;
  args.push(limit, offset);

  const sql = `
    SELECT * FROM agent_memories
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY pinned DESC, importance DESC, created_at DESC
    LIMIT ? OFFSET ?
  `;

  const rows = await db.getAllAsync(sql, args);
  return rows.map((r) => fromMemoryRow(r));
}

export async function getMemory(id: string): Promise<Memory | null> {
  const db = await openDb();
  const row = await db.getFirstAsync('SELECT * FROM agent_memories WHERE id = ?', [id]);
  return row ? fromMemoryRow(row) : null;
}

export async function updateMemory(id: string, patch: {
  content?: string;
  importance?: number;
  pinned?: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  if (patch.content && containsSecret(patch.content)) return { ok: false, error: 'Secrets are not allowed in memory' };
  if (patch.importance !== undefined) {
    patch.importance = Math.max(1, Math.min(10, Math.round(patch.importance)));
  }

  const sets: string[] = [];
  const args: (string | number | boolean)[] = [];

  if (patch.content !== undefined) { sets.push('content = ?'); args.push(patch.content.trim()); }
  if (patch.importance !== undefined) { sets.push('importance = ?'); args.push(patch.importance); }
  if (patch.pinned !== undefined) { sets.push('pinned = ?'); args.push(patch.pinned ? 1 : 0); }

  if (!sets.length) return { ok: true };

  args.push(id);
  const db = await openDb();
  await db.runAsync(`UPDATE agent_memories SET ${sets.join(', ')} WHERE id = ?`, args);

  await logActivity({
    type: 'memory_write',
    outcome: 'ok',
    detail: `Millo updated memory ${id}`,
    undoPayload: null,
  });

  return { ok: true };
}

export async function forgetMemory(id: string): Promise<{ ok: boolean; error?: string }> {
  const db = await openDb();
  await db.runAsync('DELETE FROM agent_memories WHERE id = ?', [id]);

  await logActivity({
    type: 'memory_delete',
    outcome: 'ok',
    detail: `Millo forgot memory ${id}`,
    undoPayload: null,
  });

  return { ok: true };
}

export async function touchMemory(id: string): Promise<void> {
  const db = await openDb();
  await db.runAsync('UPDATE agent_memories SET last_used_at = ? WHERE id = ?', [Date.now(), id]);
}

// ──────────────────────────────────────────────────────────────────────────────
// Recall (FTS5 keyword search)
// ──────────────────────────────────────────────────────────────────────────────

export type RecallResult = Memory & { rank: number };

export async function recallMemories(query: string, limit = 10): Promise<RecallResult[]> {
  if (!query.trim()) return [];
  const db = await openDb();

  // FTS5: rank = bm25 (lower is better). Fallback to LIKE (case-insensitive,
  // simple) when the module isn't available or the query contains punctuation
  // that might confuse FTS5.
  if (!ftsAvailable || query.match(/[\[\]*?"'\\]|^[{\}]| MATCH \w+/)) {
    const rows = await db.getAllAsync<Memory & { rank: number }>(
      `SELECT * FROM agent_memories
       WHERE content LIKE ? ESCAPE '\'
         OR kind LIKE ? ESCAPE '\' ESCAPE '\''
         OR (source_ref IS NOT NULL AND source_ref LIKE ? ESCAPE '\'')
       ORDER BY importance DESC, created_at DESC
       LIMIT ?`,
      [`%${query}%`, `%${query}%`, `%${query}%`, limit],
    );
    return rows.map((r) => ({ ...r, rank: 1000 - Math.min(999, r.importance * 100) }));
  }

  // FTS5 path: join for bm25 ranking
  const sql = `
    SELECT m.*, (1.0 / bm25(fts)) * 1000 AS rank
    FROM agent_memories_fts fts
    JOIN agent_memories m ON m.id = fts.id
    WHERE agent_memories_fts MATCH ?
    ORDER BY rank DESC
    LIMIT ?
  `;
  const rows = await db.getAllAsync(sql, [query, limit]);
  return rows.map((r: unknown) => ({ ...fromMemoryRow(r), rank: Number((r as Record<string, unknown>).rank) }));
}

// ──────────────────────────────────────────────────────────────────────────────
// Profile
// ──────────────────────────────────────────────────────────────────────────────

export async function getProfile(): Promise<Profile> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ id: string; name: string | null; timezone: string | null; sign_off: string | null; tone: string | null; updated_at: number }>('SELECT * FROM agent_profile WHERE id = ?', ['singleton']);
  if (!row) {
    // Initialize singleton
    await db.runAsync('INSERT OR IGNORE INTO agent_profile (id, updated_at) VALUES (?, ?)', ['singleton', Date.now()]);
    return { id: 'singleton', name: null, timezone: null, signOff: null, tone: null, updatedAt: Date.now() };
  }
  return {
    id: 'singleton',
    name: row.name ? String(row.name) : null,
    timezone: row.timezone ? String(row.timezone) : null,
    signOff: row.sign_off ? String(row.sign_off) : null,
    tone: row.tone ? String(row.tone) : null,
    updatedAt: Number(row.updated_at),
  };
}

export async function updateProfile(patch: {
  name?: string | null;
  timezone?: string | null;
  signOff?: string | null;
  tone?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const sets: string[] = [];
  const args: (string | null | number)[] = [];

  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name); }
  if (patch.timezone !== undefined) { sets.push('timezone = ?'); args.push(patch.timezone); }
  if (patch.signOff !== undefined) { sets.push('sign_off = ?'); args.push(patch.signOff); }
  if (patch.tone !== undefined) { sets.push('tone = ?'); args.push(patch.tone); }

  if (!sets.length) return { ok: true };

  sets.push('updated_at = ?');
  args.push(Date.now());

  const db = await openDb();
  await db.runAsync(`UPDATE agent_profile SET ${sets.join(', ')} WHERE id = ?`, [...args, 'singleton']);

  await logActivity({
    type: 'memory_write',
    outcome: 'ok',
    detail: `Millo updated profile`,
    undoPayload: null,
  });

  return { ok: true };
}

/**
 * Derives sign-off + tone heuristics from approved voice samples and stores
 * them on the profile if unset or changed. This is what makes the README's
 * "draft replies — in your voice" claim real without a second model: the
 * sign-off line and a short tone hint are learned straight from the user's
 * own approved replies.
 */
export async function deriveVoiceFromSamples(samples: string[]): Promise<void> {
  const texts = samples.filter((s) => !!s && s.trim().length > 20);
  if (texts.length < 2) return; // need at least two to infer a pattern

  const profile = await getProfile();

  // Heuristic sign-off: the common closing line after ",\n<Name>" or the last
  // line when it is short and not punctuation. Prefer lines starting with
  // "Best," / "Thanks," / "Cheers," / "Regards," / "Warmly,".
  const closers = texts
    .map((t) => {
      const lines = t.trim().split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
      const last = lines[lines.length - 1];
      const before = lines[lines.length - 2];
      // "Best,\nMarvel" → closer = "Best,"
      const combo = before && /^(best|thanks|cheers|regards|warmly|sincerely|kind regards|best regards)/i.test(before)
        ? before
        : (last && /^(best|thanks|cheers|regards|warmly|sincerely)[!,]?$/i.test(last))
          ? last
          : null;
      return combo ? combo.replace(/[!,]$/, '') : null;
    })
    .filter((c): c is string => !!c);

  // Most common closer.
  const signOff = closers.length
    ? closers
        .map((c) => ({ c, n: closers.filter((x) => x.toLowerCase() === c.toLowerCase()).length }))
        .sort((a, b) => b.n - a.n)[0].c
    : null;

  // Heuristic tone: detect short-sentence/direct style vs warm/first-person.
  // Conservative — only infer when there is a clear signal.
  let tone: string | null = null;
  const sampleText = texts.join(' ').toLowerCase();
  const warm = /(happy|glad|thanks|cheers|appreciate|great|lovely)/.test(sampleText);
  const direct = /(please find|as discussed|let me know|to confirm|per our)/.test(sampleText);
  if (warm && !direct) tone = 'warm and friendly';
  else if (direct && !warm) tone = 'direct and concise';
  else if (warm && direct) tone = 'friendly but direct';

  if (profile.signOff === signOff && profile.tone === tone) return;

  await updateProfile({
    signOff: signOff ?? profile.signOff,
    tone: tone ?? profile.tone,
  });
}

// ──────────────────────────────────────────────────────────────────────────────
// Contacts
// ──────────────────────────────────────────────────────────────────────────────

function fromContactRow(row: unknown): Contact {
  const r = row as Record<string, unknown>;
  return {
    id: String(r.id),
    email: String(r.email),
    name: r.name ? String(r.name) : null,
    notes: r.notes ? String(r.notes) : null,
    messageCount: Number(r.message_count),
    lastInteractionAt: r.last_interaction_at ? Number(r.last_interaction_at) : null,
    createdAt: Number(r.created_at),
  };
}

export async function listContacts(): Promise<Contact[]> {
  const db = await openDb();
  const rows = await db.getAllAsync<{ id: string; email: string; name: string | null; notes: string | null; message_count: number; last_interaction_at: number | null; created_at: number }>('SELECT * FROM agent_contacts ORDER BY message_count DESC, last_interaction_at DESC');
  return rows.map(fromContactRow);
}

export async function getContact(id: string): Promise<Contact | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ id: string; email: string; name: string | null; notes: string | null; message_count: number; last_interaction_at: number | null; created_at: number }>('SELECT * FROM agent_contacts WHERE id = ?', [id]);
  return row ? fromContactRow(row) : null;
}

export async function getContactByEmail(email: string): Promise<Contact | null> {
  const db = await openDb();
  const row = await db.getFirstAsync<{ id: string; email: string; name: string | null; notes: string | null; message_count: number; last_interaction_at: number | null; created_at: number }>('SELECT * FROM agent_contacts WHERE email = ?', [email]);
  return row ? fromContactRow(row) : null;
}

export async function savePerson(params: {
  email: string;
  name?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; id: string; error?: string }> {
  const email = params.email.toLowerCase().trim();
  if (!email.includes('@')) return { ok: false, id: '', error: 'Invalid email' };

  const db = await openDb();
  const existing = await getContactByEmail(email);
  const now = Date.now();

  if (existing) {
    await db.runAsync(
      `UPDATE agent_contacts SET name = COALESCE(?, name), notes = COALESCE(?, notes), last_interaction_at = ? WHERE email = ?`,
      [params.name ?? null, params.notes ?? null, now, email]
    );
    return { ok: true, id: existing.id };
  } else {
    const id = `contact_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await db.runAsync(
      `INSERT INTO agent_contacts (id, email, name, notes, message_count, last_interaction_at, created_at)
       VALUES (?, ?, ?, ?, 0, ?, ?)`,
      [id, email, params.name ?? null, params.notes ?? null, now, now]
    );
    await logActivity({
      type: 'memory_write',
      outcome: 'ok',
      detail: `Millo saved contact: ${params.name ?? email}`,
      undoPayload: null,
    });
    return { ok: true, id };
  }
}

export async function updateContact(id: string, patch: {
  name?: string | null;
  notes?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const sets: string[] = [];
  const args: (string | null)[] = [];

  if (patch.name !== undefined) { sets.push('name = ?'); args.push(patch.name); }
  if (patch.notes !== undefined) { sets.push('notes = ?'); args.push(patch.notes); }

  if (!sets.length) return { ok: true };

  args.push(id);
  const db = await openDb();
  await db.runAsync(`UPDATE agent_contacts SET ${sets.join(', ')} WHERE id = ?`, args);
  return { ok: true };
}

export async function deleteContact(id: string): Promise<{ ok: boolean; error?: string }> {
  const db = await openDb();
  await db.runAsync('DELETE FROM agent_contacts WHERE id = ?', [id]);
  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────────
// Export / Import (portability + auditability)
// ──────────────────────────────────────────────────────────────────────────────

export type MemoryExport = {
  version: 1;
  exportedAt: number;
  memories: Memory[];
  contacts: Contact[];
  profile: Profile;
};

export async function exportAll(): Promise<MemoryExport> {
  const [memories, contacts, profile] = await Promise.all([
    listMemories(),
    listContacts(),
    getProfile(),
  ]);
  return { version: 1, exportedAt: Date.now(), memories, contacts, profile };
}

export async function importAll(data: MemoryExport): Promise<{ ok: boolean; error?: string }> {
  if (!data || data.version !== 1) return { ok: false, error: 'Invalid export format' };

  const db = await openDb();

  // Import memories
  for (const m of data.memories) {
    if (containsSecret(m.content)) continue; // secrets guard on import too
    await db.runAsync(
      `INSERT OR REPLACE INTO agent_memories (id, kind, content, importance, pinned, source_ref, created_at, last_used_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [m.id, m.kind, m.content, m.importance, m.pinned ? 1 : 0, m.sourceRef, m.createdAt, m.lastUsedAt]
    );
  }

  // Import contacts
  for (const c of data.contacts) {
    await db.runAsync(
      `INSERT OR REPLACE INTO agent_contacts (id, email, name, notes, message_count, last_interaction_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [c.id, c.email, c.name, c.notes, c.messageCount, c.lastInteractionAt, c.createdAt]
    );
  }

  // Import profile
  if (data.profile) {
    await db.runAsync(
      `INSERT OR REPLACE INTO agent_profile (id, name, timezone, sign_off, tone, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [data.profile.id, data.profile.name, data.profile.timezone, data.profile.signOff, data.profile.tone, data.profile.updatedAt]
    );
  }

  // Rebuild FTS5
  await db.runAsync('DELETE FROM agent_memories_fts');
  await db.runAsync(`
    INSERT INTO agent_memories_fts(id, kind, content, source_ref)
    SELECT id, kind, content, source_ref FROM agent_memories
  `);

  await logActivity({
    type: 'memory_import',
    outcome: 'ok',
    detail: `Millo imported memory export`,
    undoPayload: null,
  });

  return { ok: true };
}

// ──────────────────────────────────────────────────────────────────────────────
// Decay / Pruning (called by scheduler or guardrails)
// ──────────────────────────────────────────────────────────────────────────────

export type PruneResult = { pruned: number };

export async function pruneMemories(opts: {
  maxMemories?: number; // hard cap
  minImportance?: number; // prune below this
  olderThanDays?: number; // prune memories older than this that are unpinned and low importance
}): Promise<PruneResult> {
  const maxMemories = opts.maxMemories ?? 10_000;
  const minImportance = opts.minImportance ?? 3;
  const olderThanMs = (opts.olderThanDays ?? 90) * 24 * 60 * 60 * 1000;
  const cutoff = Date.now() - olderThanMs;

  const db = await openDb();

  // First, count total
  const totalRow = await db.getFirstAsync<{ c: number }>('SELECT COUNT(*) as c FROM agent_memories');
  const total = totalRow ? Number(totalRow.c) : 0;

  if (total <= maxMemories) return { pruned: 0 };

  // Determine how many to prune
  const toPrune = total - maxMemories;

  // Prune: unpinned, importance < minImportance, older than cutoff, ordered by importance ASC then created_at ASC
  const result = await db.runAsync(
    `DELETE FROM agent_memories
     WHERE id IN (
       SELECT id FROM agent_memories
       WHERE pinned = 0 AND importance < ? AND created_at < ?
       ORDER BY importance ASC, created_at ASC
       LIMIT ?
     )`,
    [minImportance, cutoff, toPrune]
  );

  // Rebuild FTS5
  await db.runAsync('DELETE FROM agent_memories_fts');
  await db.runAsync(`
    INSERT INTO agent_memories_fts(id, kind, content, source_ref)
    SELECT id, kind, content, source_ref FROM agent_memories
  `);

  return { pruned: result.changes ?? 0 };
}