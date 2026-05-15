import { defaultClock } from './clock.js';

import type { Clock } from './clock.js';
import type { EmbedFunction } from './types.js';

interface MemoryConfig {
  clock?: Clock;
  decayRate?: number;
  defaultStrength?: number;
  embed?: EmbedFunction;
  evictionThreshold?: number;
  linkExpansionHops?: number;
  path?: string;
  reinforcementBoost?: number;
  rrfK?: number;
  searchWeights?: {
    bm25?: number;
    vector?: number;
  };
  similarityThreshold?: number;
}

interface ResolvedConfig {
  clock: Clock;
  decayRate: number;
  defaultStrength: number;
  embed: EmbedFunction | null;
  evictionThreshold: number;
  linkExpansionHops: number;
  path: string;
  reinforcementBoost: number;
  rrfK: number;
  searchWeights: {
    bm25: number;
    vector: number;
  };
  similarityThreshold: number;
}

const DEFAULTS: ResolvedConfig = {
  clock: defaultClock,
  decayRate: 0.95,
  defaultStrength: 0.5,
  embed: null,
  evictionThreshold: 0.15,
  linkExpansionHops: 1,
  path: './memory.db',
  reinforcementBoost: 0.1,
  rrfK: 60,
  searchWeights: {
    bm25: 0.4,
    vector: 0.6,
  },
  similarityThreshold: 0.85,
};

function resolveConfig(input?: MemoryConfig): ResolvedConfig {
  return {
    clock: input?.clock ?? DEFAULTS.clock,
    decayRate: input?.decayRate ?? DEFAULTS.decayRate,
    defaultStrength: input?.defaultStrength ?? DEFAULTS.defaultStrength,
    embed: input?.embed ?? DEFAULTS.embed,
    evictionThreshold: input?.evictionThreshold ?? DEFAULTS.evictionThreshold,
    linkExpansionHops: input?.linkExpansionHops ?? DEFAULTS.linkExpansionHops,
    path: input?.path ?? DEFAULTS.path,
    reinforcementBoost:
      input?.reinforcementBoost ?? DEFAULTS.reinforcementBoost,
    rrfK: input?.rrfK ?? DEFAULTS.rrfK,
    searchWeights: {
      bm25: input?.searchWeights?.bm25 ?? DEFAULTS.searchWeights.bm25,
      vector: input?.searchWeights?.vector ?? DEFAULTS.searchWeights.vector,
    },
    similarityThreshold:
      input?.similarityThreshold ?? DEFAULTS.similarityThreshold,
  };
}

export { DEFAULTS, resolveConfig };
export type { MemoryConfig, ResolvedConfig };
