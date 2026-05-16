#!/usr/bin/env npx tsx
/**
 * Verification script for the echecs memory store.
 *
 * Run after replay to verify the memory store captured chess knowledge.
 * Safe to run on an empty DB (will just show zeros).
 *
 * Usage: npx tsx scripts/verify.ts
 */

import BetterSqlite3 from 'better-sqlite3';

import { createMemory } from '../src/index.js';

const DB_PATH = './echecs-memory.db';

const memory = createMemory({
  path: DB_PATH,
  decayRate: 0.99,
  evictionThreshold: 0.05,
  typeStrength: {
    constraint: 0.7,
    decision: 0.7,
    entity: 0.5,
    pattern: 0.5,
    rule: 0.6,
    standard: 0.6,
  },
});

// --- 1. Stats ---

console.log('=== 1. store stats ===\n');

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
console.log(
  `avg strength: ${total > 0 ? (strengthSum / total).toFixed(4) : 'n/a'}`,
);
console.log('strength distribution:', buckets);

// --- 2. Search queries (chess domain) ---

console.log('\n=== 2. search queries ===');

const queries = [
  'Buchholz tiebreaker sum opponents scores',
  'FIDE Swiss pairing rules endorsement',
  'castling chess rule king rook',
  'PGN portable game notation format',
  'Elo rating calculation performance',
  'UCI universal chess interface protocol',
  'en passant capture pawn',
  'tournament tiebreaker sonneborn berger',
];

for (const query of queries) {
  console.log(`\n  "${query}"`);
  try {
    const results = await memory.search(query, { limit: 3 });
    if (results.length === 0) {
      console.log('    (no results)');
    } else {
      for (const r of results) {
        const preview = r.memory.content.slice(0, 120).replace(/\n/g, ' ');
        console.log(
          `    [${r.memory.type}] v${r.memory.version} strength=${r.memory.strength.toFixed(3)} score=${r.score.toFixed(4)}`,
        );
        console.log(`    ${preview}`);
      }
    }
  } catch (err) {
    console.log(`    error: ${err}`);
  }
}

// --- 3. Versioning (frequency signal) ---

console.log('\n=== 3. versioning (frequency signal) ===\n');

try {
  const db = new BetterSqlite3(DB_PATH, { readonly: true });

  const chains = db
    .prepare(
      `
      SELECT m.id, m.type, m.version, m.strength, substr(m.content, 1, 80) as preview
      FROM memories m
      WHERE m.current = 1 AND m.version > 1
      ORDER BY m.version DESC
      LIMIT 10
    `,
    )
    .all() as {
    id: string;
    preview: string;
    strength: number;
    type: string;
    version: number;
  }[];

  if (chains.length === 0) {
    console.log('no memories with version > 1 yet');
  } else {
    console.log(`top ${chains.length} most-reinforced memories:`);
    for (const c of chains) {
      console.log(
        `  [${c.type}] v${c.version} strength=${c.strength.toFixed(3)} — ${c.preview}`,
      );
    }
  }

  db.close();
} catch (err) {
  console.log(`error: ${err}`);
}

// --- 4. Links ---

console.log('\n=== 4. links ===\n');

try {
  const db = new BetterSqlite3(DB_PATH, { readonly: true });

  const totalLinks = (
    db.prepare('SELECT COUNT(*) as n FROM memory_links').get() as { n: number }
  ).n;

  const relations = db
    .prepare(
      'SELECT relation, COUNT(*) as n FROM memory_links GROUP BY relation ORDER BY n DESC',
    )
    .all() as { n: number; relation: string }[];

  console.log(`total links: ${totalLinks}`);
  if (relations.length > 0) {
    console.log(
      'by relation:',
      relations.map((r) => `${r.relation}(${r.n})`).join(', '),
    );
  }

  db.close();
} catch (err) {
  console.log(`error: ${err}`);
}

// --- 5. Decay simulation ---

console.log('\n=== 5. decay simulation ===\n');

try {
  const now = new Date();

  const simulate = (days: number): number => {
    const futureDate = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const sim = createMemory({
      path: DB_PATH,
      clock: () => futureDate,
      decayRate: 0.99,
      evictionThreshold: 0.05,
    });
    return sim.list().length;
  };

  const d30 = simulate(30);
  const d90 = simulate(90);
  const d180 = simulate(180);

  console.log(`memories now:     ${total}`);
  console.log(
    `surviving 30d:    ${d30} (${total > 0 ? Math.round((d30 / total) * 100) : 0}%)`,
  );
  console.log(
    `surviving 90d:    ${d90} (${total > 0 ? Math.round((d90 / total) * 100) : 0}%)`,
  );
  console.log(
    `surviving 180d:   ${d180} (${total > 0 ? Math.round((d180 / total) * 100) : 0}%)`,
  );
} catch (err) {
  console.log(`error: ${err}`);
}

console.log('\ndone.');
