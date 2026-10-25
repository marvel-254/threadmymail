/**
 * Conversation Store — minimal on-device persistence for Millo conversations.
 * Uses expo-sqlite (already a dependency). No backend, no sync.
 *
 * Schema:
 * - conversations: id, title, created_at, updated_at, wallpaper_override
 * - messages: id, conversation_id, role, text, references, created_at
 *
 * Migrations are additive only; no destructive schema changes.
 */
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'threadmymail.db';

let db: SQLite.SQLiteDatabase | null = null;

export async function getConversationDb(): Promise<SQLite.SQLiteDatabase> {
  if (db) return db;
  db = await SQLite.openDatabaseAsync(DB_NAME);
  await initSchema(db);
  return db;
}

async function initSchema(db: SQLite.SQLiteDatabase) {
  // Conversations table
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT 'New Chat',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      wallpaper_override TEXT
    );
  `);

  // Messages table
  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL, -- 'user' | 'agent' | 'tool' | 'escalation' | 'notice'
      text TEXT NOT NULL,
      references TEXT, -- JSON string for tool args, email refs, etc.
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
  `);

  // Index for faster message queries
  await db.execAsync(`
    CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id, created_at);
  `);
}

export type Conversation = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  wallpaperOverride: string | null;
};

export type Message = {
  id: string;
  conversationId: string;
  role: 'user' | 'agent' | 'tool' | 'escalation' | 'notice';
  text: string;
  references: string | null;
  createdAt: number;
};

export type EmailRef = { threadId: string; subject: string };

export type StreamItem =
  | { type: 'agent'; id: string; text: string; streaming?: boolean; emailRefs?: EmailRef[] }
  | { type: 'user'; id: string; text: string; emailRefs?: EmailRef[] }
  | { type: 'tool'; id: string; name: string; args: string; latencyMs: number; ok: boolean; text?: string }
  | { type: 'escalation'; id: string; question: string }
  | { type: 'notice'; id: string; text: string; retryText?: string };

export async function createConversation(title = 'New Chat'): Promise<Conversation> {
  const db = await getConversationDb();
  const id = `conv_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = Date.now();
  await db.runAsync(
    'INSERT INTO conversations (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)',
    [id, title, now, now]
  );
  return { id, title, createdAt: now, updatedAt: now, wallpaperOverride: null };
}

export async function getConversations(): Promise<Conversation[]> {
  const db = await getConversationDb();
  const rows = await db.getAllAsync<Conversation>(
    'SELECT id, title, created_at as createdAt, updated_at as updatedAt, wallpaper_override as wallpaperOverride FROM conversations ORDER BY updated_at DESC'
  );
  return rows;
}

export async function getConversation(id: string): Promise<Conversation | null> {
  const db = await getConversationDb();
  const row = await db.getFirstAsync<Conversation>(
    'SELECT id, title, created_at as createdAt, updated_at as updatedAt, wallpaper_override as wallpaperOverride FROM conversations WHERE id = ?',
    [id]
  );
  return row ?? null;
}

export async function updateConversationTitle(id: string, title: string): Promise<void> {
  const db = await getConversationDb();
  await db.runAsync(
    'UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?',
    [title, Date.now(), id]
  );
}

export async function updateConversationWallpaper(id: string, wallpaperOverride: string | null): Promise<void> {
  const db = await getConversationDb();
  await db.runAsync(
    'UPDATE conversations SET wallpaper_override = ?, updated_at = ? WHERE id = ?',
    [wallpaperOverride, Date.now(), id]
  );
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getConversationDb();
  await db.runAsync('DELETE FROM conversations WHERE id = ?', [id]);
  // Messages are deleted via CASCADE
}

export async function saveMessage(message: Omit<Message, 'createdAt'> & { createdAt?: number }): Promise<void> {
  const db = await getConversationDb();
  const createdAt = message.createdAt ?? Date.now();
  await db.runAsync(
    'INSERT OR REPLACE INTO messages (id, conversation_id, role, text, references, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    [message.id, message.conversationId, message.role, message.text, message.references, createdAt]
  );
  // Update conversation's updated_at
  await db.runAsync('UPDATE conversations SET updated_at = ? WHERE id = ?', [createdAt, message.conversationId]);
}

export async function saveMessages(messages: (Omit<Message, 'createdAt'> & { createdAt?: number })[]): Promise<void> {
  const db = await getConversationDb();
  await db.withTransactionAsync(async () => {
    for (const msg of messages) {
      const createdAt = msg.createdAt ?? Date.now();
      await db.runAsync(
        'INSERT OR REPLACE INTO messages (id, conversation_id, role, text, references, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        [msg.id, msg.conversationId, msg.role, msg.text, msg.references, createdAt]
      );
    }
    if (messages.length > 0) {
      const latest = Math.max(...messages.map(m => m.createdAt ?? Date.now()));
      await db.runAsync('UPDATE conversations SET updated_at = ? WHERE id = ?', [latest, messages[0].conversationId]);
    }
  });
}

export async function getMessages(conversationId: string): Promise<Message[]> {
  const db = await getConversationDb();
  const rows = await db.getAllAsync<Message>(
    'SELECT id, conversation_id as conversationId, role, text, references, created_at as createdAt FROM messages WHERE conversation_id = ? ORDER BY created_at ASC',
    [conversationId]
  );
  return rows;
}

export async function deleteMessages(conversationId: string): Promise<void> {
  const db = await getConversationDb();
  await db.runAsync('DELETE FROM messages WHERE conversation_id = ?', [conversationId]);
}

// Convert StreamItem to Message format for storage
export function streamItemToMessage(item: StreamItem, conversationId: string): Omit<Message, 'createdAt'> & { createdAt?: number } {
  let role: Message['role'];
  let text: string;
  let references: string | null = null;

  switch (item.type) {
    case 'user':
      role = 'user';
      text = item.text;
      if (item.emailRefs?.length) references = JSON.stringify({ emailRefs: item.emailRefs });
      break;
    case 'agent':
      role = 'agent';
      text = item.text;
      if (item.emailRefs?.length) references = JSON.stringify({ emailRefs: item.emailRefs });
      break;
    case 'tool':
      role = 'tool';
      text = item.name;
      references = JSON.stringify({ args: item.args, latencyMs: item.latencyMs, ok: item.ok });
      break;
    case 'escalation':
      role = 'escalation';
      text = item.question;
      break;
    case 'notice':
      role = 'notice';
      text = item.text;
      break;
  }

  return {
    id: item.id,
    conversationId,
    role: role!,
    text: text!,
    references,
  };
}

// Convert Message to StreamItem for UI
export function messageToStreamItem(msg: Message): StreamItem {
  let parsedRefs: { emailRefs?: EmailRef[] } = {};
  if (msg.references) {
    try {
      const parsed: unknown = JSON.parse(msg.references);
      if (parsed && typeof parsed === 'object' && 'emailRefs' in parsed) {
        parsedRefs = parsed as { emailRefs?: EmailRef[] };
      }
    } catch {
      // Malformed references — treat as absent.
    }
  }
  switch (msg.role) {
    case 'user':
      return { type: 'user', id: msg.id, text: msg.text, emailRefs: parsedRefs.emailRefs };
    case 'agent':
      return { type: 'agent', id: msg.id, text: msg.text, streaming: false, emailRefs: parsedRefs.emailRefs };
    case 'tool': {
      const refs = msg.references ? JSON.parse(msg.references) : {};
      return { type: 'tool', id: msg.id, name: msg.text, args: refs.args ?? '', latencyMs: refs.latencyMs ?? 0, ok: refs.ok ?? true };
    }
    case 'escalation':
      return { type: 'escalation', id: msg.id, question: msg.text };
    case 'notice':
      return { type: 'notice', id: msg.id, text: msg.text };
    default:
      return { type: 'notice', id: msg.id, text: msg.text };
  }
}