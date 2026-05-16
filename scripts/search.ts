#!/usr/bin/env npx tsx
/**
 * Quick search against the echecs memory store.
 * Usage: npx tsx scripts/search.ts "your query here"
 */

import { createMemory } from '../src/index.js';

const query = process.argv[2];
if (!query) {
  console.log('usage: npx tsx scripts/search.ts "query"');
  process.exit(1);
}

const memory = createMemory({
  path: './echecs-memory.db',
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

const results = await memory.search(query, { limit: 5 });

if (results.length === 0) {
  console.log('(no results)');
} else {
  for (const r of results) {
    console.log(
      `[${r.memory.type}] v${r.memory.version} strength=${r.memory.strength.toFixed(3)} score=${r.score.toFixed(4)}`,
    );
    console.log(`  ${r.memory.content.slice(0, 250)}`);
    console.log();
  }
}
