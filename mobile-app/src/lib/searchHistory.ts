/**
 * Recent search history — a tiny SQLite store kept separate from the mail cache.
 *
 * Search terms can contain sensitive names or subjects, so they stay on-device
 * and are capped/clearable. A separate database avoids touching the message
 * cache schema.
 */
import * as SQLite from 'expo-sqlite';

const DB_NAME = 'threadmymail.search.db';
const MAX_RECENTS = 10;

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        PRAGMA journal_mode = WAL;
        CREATE TABLE IF NOT EXISTS recent_searches (
          query TEXT PRIMARY KEY NOT NULL,
          searched_at INTEGER NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}

export async function loadRecentSearches(): Promise<string[]> {
  const db = await openDb();
  const rows = await db.getAllAsync<{ query: string }>(
    'SELECT query FROM recent_searches ORDER BY searched_at DESC LIMIT $limit',
    { $limit: MAX_RECENTS },
  );
  return rows.map((row) => row.query);
}

export async function addRecentSearch(query: string): Promise<string[]> {
  const term = query.trim();
  if (term.length < 2) return loadRecentSearches();
  const db = await openDb();
  await db.runAsync(
    'INSERT OR REPLACE INTO recent_searches (query, searched_at) VALUES ($query, $at)',
    { $query: term, $at: Date.now() },
  );
  await db.runAsync(
    `DELETE FROM recent_searches
     WHERE query NOT IN (
       SELECT query FROM recent_searches ORDER BY searched_at DESC LIMIT $limit
     )`,
    { $limit: MAX_RECENTS },
  );
  return loadRecentSearches();
}

export async function clearRecentSearches(): Promise<void> {
  const db = await openDb();
  await db.runAsync('DELETE FROM recent_searches');
}
