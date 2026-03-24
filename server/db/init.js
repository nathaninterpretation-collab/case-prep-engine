import Database from 'better-sqlite3';

export function initDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      api_key_encrypted TEXT,
      api_key_iv TEXT,
      api_key_tag TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS cases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      case_type TEXT,
      case_subtype TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      profile_json TEXT,
      analysis_json TEXT,
      documents_meta TEXT
    );

    CREATE TABLE IF NOT EXISTS quiz_scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      case_id TEXT NOT NULL,
      mode TEXT NOT NULL,
      score REAL,
      total INTEGER,
      details TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (case_id) REFERENCES cases(id)
    );
  `);

  // Add user_id columns if missing (migration for existing DBs)
  try { db.exec('ALTER TABLE cases ADD COLUMN user_id TEXT REFERENCES users(id)'); } catch {}
  try { db.exec('ALTER TABLE quiz_scores ADD COLUMN user_id TEXT REFERENCES users(id)'); } catch {}
  // Add podcast_json column for cached podcast scripts
  try { db.exec('ALTER TABLE cases ADD COLUMN podcast_json TEXT'); } catch {}
  // Add notes column for case annotations
  try { db.exec('ALTER TABLE cases ADD COLUMN notes TEXT'); } catch {}
  // Add tags column for case organization
  try { db.exec('ALTER TABLE cases ADD COLUMN tags TEXT'); } catch {}
  // Add sort_order column for drag-to-reorder
  try { db.exec('ALTER TABLE cases ADD COLUMN sort_order INTEGER DEFAULT 0'); } catch {}
  // Add hearing_date column for calendar integration
  try { db.exec('ALTER TABLE cases ADD COLUMN hearing_date TEXT'); } catch {}
  // Add preferences column to users for dark mode, language, etc.
  try { db.exec('ALTER TABLE users ADD COLUMN preferences TEXT'); } catch {}

  return db;
}
