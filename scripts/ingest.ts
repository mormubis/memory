#!/usr/bin/env npx tsx
/**
 * Ingest echecs-related opencode sessions into the memory store.
 *
 * Reads ALL sessions matching chess/echecs keywords from the opencode SQLite
 * database and stores each message as a weak observation.
 *
 * Usage: npx tsx scripts/ingest.ts
 */

import BetterSqlite3 from 'better-sqlite3';
import { createMemory } from '../src/index.js';

// --- opencode database ---

const OPENCODE_DB_PATH = `${process.env.HOME}/.local/share/opencode/opencode.db`;

const ocDb = new BetterSqlite3(OPENCODE_DB_PATH, { readonly: true });

interface SessionRow {
  id: string;
  title: string;
}

interface PartRow {
  role: string;
  session_id: string;
  session_title: string;
  text: string;
  time_created: number;
}

const KEYWORDS = [
  'echecs',
  'chess',
  'elo',
  'pgn',
  'uci',
  'blunder',
  'tournament',
  'endorsement',
  'trf',
  'position',
  'fen',
  'san',
  'swiss',
  'buchholz',
  'koya',
  'game',
  'rating',
];

function loadEchecsSessions(): SessionRow[] {
  const likeConditions = KEYWORDS.map(() => "title LIKE '%' || ? || '%'").join(' OR ');
  const sql = `
    SELECT id, title
    FROM session
    WHERE ${likeConditions}
    ORDER BY time_updated DESC
  `;
  return ocDb.prepare(sql).all(...KEYWORDS) as SessionRow[];
}

function loadSessionMessages(sessionId: string): PartRow[] {
  return ocDb.prepare(`
    SELECT
      json_extract(p.data, '$.text') as text,
      json_extract(m.data, '$.role') as role,
      m.session_id,
      s.title as session_title,
      p.time_created
    FROM part p
    JOIN message m ON p.message_id = m.id
    JOIN session s ON m.session_id = s.id
    WHERE m.session_id = ?
      AND json_extract(p.data, '$.type') = 'text'
      AND json_extract(p.data, '$.text') IS NOT NULL
      AND length(json_extract(p.data, '$.text')) > 30
    ORDER BY p.time_created
  `).all(sessionId) as PartRow[];
}

// --- memory store ---
// No embed override — uses @xenova/transformers all-MiniLM-L6-v2 by default.
// First run will download ~80MB model.

const memory = createMemory({
  path: './echecs-memory.db',
  similarityThreshold: 0.98,
});

// --- ingest ---

async function ingest(): Promise<void> {
  const startTime = Date.now();

  const sessions = loadEchecsSessions();
  console.log(`found ${sessions.length} echecs-related sessions`);

  let totalStored = 0;
  let countByType: Record<string, number> = {};

  for (const session of sessions) {
    let messages: PartRow[];
    try {
      messages = loadSessionMessages(session.id);
    } catch (err) {
      console.log(`  error loading session ${session.id}: ${err}`);
      continue;
    }

    if (messages.length === 0) continue;

    console.log(`\n[${session.title}] ${messages.length} messages`);

    for (const msg of messages) {
      const type = msg.role === 'user' ? 'prompt' : 'response';
      const truncated = msg.text.length > 800 ? msg.text.slice(0, 800) : msg.text;
      const content = `[session: "${msg.session_title}"] [${msg.role}] ${truncated}`;

      try {
        await memory.remember(type, content, 0.2);
        totalStored++;
        countByType[type] = (countByType[type] ?? 0) + 1;
      } catch (err) {
        console.log(`  error storing message: ${err}`);
        continue;
      }

      if (totalStored % 100 === 0) {
        const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`  progress: ${totalStored} stored (${elapsed}s)`);
      }
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log('\n--- stats ---');
  console.log(`total stored: ${totalStored}`);
  console.log('by type:', countByType);
  console.log(`total time: ${elapsed}s`);

  ocDb.close();
}

ingest().catch(console.error);
