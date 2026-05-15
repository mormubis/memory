import type Database from 'better-sqlite3';

function createSchema(db: Database.Database): void {
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
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

  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_memories_current ON memories (current)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_memories_type_current ON memories (type, current)',
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_memories_parent_id ON memories (parent_id)',
  );

  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_vectors (
      memory_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL
    )
  `);

  db.exec(`
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

  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts
    USING fts5(content, content_rowid='rowid')
  `);
}

export { createSchema };
