import type Database from 'better-sqlite3';

function createSchema(database: Database.Database): void {
  database.exec('PRAGMA journal_mode = WAL');
  database.exec('PRAGMA foreign_keys = ON');

  database.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 0.5,
      version INTEGER NOT NULL DEFAULT 1,
      parent_id TEXT,
      current INTEGER NOT NULL DEFAULT 1,
      created TEXT NOT NULL,
      updated TEXT NOT NULL
    )
  `);

  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_memories_current ON memories (current)',
  );
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_memories_type_current ON memories (type, current)',
  );
  database.exec(
    'CREATE INDEX IF NOT EXISTS idx_memories_parent_id ON memories (parent_id)',
  );

  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_vectors (
      memory_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL
    )
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS memory_links (
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      created TEXT NOT NULL,
      updated TEXT NOT NULL,
      PRIMARY KEY (source_id, target_id, relation)
    )
  `);

  database.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
    USING fts5(content, content_rowid='rowid')
  `);
}

export { createSchema };
