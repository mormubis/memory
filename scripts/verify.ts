#!/usr/bin/env npx tsx
/**
 * Verification script for the echecs memory store.
 *
 * Runs after consolidation to verify the memory store works correctly.
 * Safe to run on an empty DB (will just show zeros).
 *
 * Usage: npx tsx scripts/verify.ts
 */

import BetterSqlite3 from 'better-sqlite3';

import { createMemory } from '../src/index.js';

const DB_PATH = './echecs-memory.db';

// --- 1. Stats ---

console.log('=== 1. store stats ===\n');

const memory = createMemory({
  path: DB_PATH,
  similarityThreshold: 0.85,
});

const all = memory.list();
const total = all.length;

const byType: Record<string, number> = {};
const buckets = { '0-0.2': 0, '0.2-0.5': 0, '0.5-0.8': 0, '0.8-1.0': 0 };
let strengthSum = 0;

for (const m of all) {
  byType[m.type] = (byType[m.type] ?? 0) + 1;
  strengthSum += m.strength;

  if (m.strength < 0.2) buckets['0-0.2']++;
  else if (m.strength < 0.5) buckets['0.2-0.5']++;
  else if (m.strength < 0.8) buckets['0.5-0.8']++;
  else buckets['0.8-1.0']++;
}

console.log(`total current memories: ${total}`);
console.log('by type:', byType);
console.log(`avg strength: ${total > 0 ? (strengthSum / total).toFixed(4) : 'n/a'}`);
console.log('strength distribution:', buckets);

// --- 2. Search queries ---

console.log('\n=== 2. search queries ===');

const queries = [
  'tournament tiebreaker buchholz',
  'PGN parser notation',
  'Elo rating calculation',
  'UCI chess engine protocol',
  'FIDE Swiss pairing endorsement',
];

for (const query of queries) {
  console.log(`\n  query: "${query}"`);
  try {
    const results = await memory.search(query, { limit: 3 });
    if (results.length === 0) {
      console.log('    (no results)');
    } else {
      for (const r of results) {
        const preview = r.memory.content.slice(0, 100).replace(/\n/g, ' ');
        console.log(
          `    [${r.memory.type}] score=${r.score.toFixed(4)} strength=${r.memory.strength.toFixed(3)} — ${preview}`,
        );
      }
    }
  } catch (err) {
    console.log(`    error: ${err}`);
  }
}

// --- 3. Versioning check ---

console.log('\n=== 3. versioning ===\n');

try {
  const db = new BetterSqlite3(DB_PATH, { readonly: true });

  const versionedRows = db
    .prepare("SELECT id FROM memories WHERE version > 1 AND current = 1")
    .all() as { id: string }[];

  const chainCount = versionedRows.length;
  const totalVersioned = (
    db.prepare("SELECT COUNT(*) as n FROM memories WHERE version > 1").get() as { n: number }
  ).n;

  console.log(`chains with version > 1 (current heads): ${chainCount}`);
  console.log(`total non-v1 rows (all versions): ${totalVersioned}`);

  db.close();
} catch (err) {
  console.log(`error reading versioning info: ${err}`);
}

// --- 4. Links ---

console.log('\n=== 4. links ===\n');

try {
  const db = new BetterSqlite3(DB_PATH, { readonly: true });

  const totalLinks = (
    db.prepare('SELECT COUNT(*) as n FROM memory_links').get() as { n: number }
  ).n;

  const relationRows = db
    .prepare('SELECT DISTINCT relation FROM memory_links ORDER BY relation')
    .all() as { relation: string }[];

  console.log(`total links: ${totalLinks}`);
  console.log(
    'relation types:',
    relationRows.length > 0 ? relationRows.map((r) => r.relation).join(', ') : '(none)',
  );

  db.close();
} catch (err) {
  console.log(`error reading links: ${err}`);
}

// --- 5. Decay simulation ---

console.log('\n=== 5. decay simulation (60 days) ===\n');

try {
  const futureDate = new Date();
  futureDate.setDate(futureDate.getDate() + 60);

  const memoryCopy = createMemory({
    path: DB_PATH,
    similarityThreshold: 0.85,
    clock: () => futureDate,
    evictionThreshold: 0.15,
  });

  const futureAll = memoryCopy.list();
  const survive = futureAll.length;
  const evicted = total - survive;

  console.log(`memories now: ${total}`);
  console.log(`memories surviving +60 days: ${survive}`);
  console.log(`evicted: ${evicted > 0 ? evicted : 0}`);
} catch (err) {
  console.log(`error running decay simulation: ${err}`);
}

console.log('\ndone.');
