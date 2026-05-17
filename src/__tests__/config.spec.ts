import { describe, expect, it } from 'vitest';

import { DEFAULTS, resolveConfig } from '../config.js';

async function customEmbed(_text: string): Promise<number[]> {
  return [1, 2, 3];
}

describe('resolveConfig', () => {
  it('returns defaults when called with no arguments', () => {
    const config = resolveConfig();
    expect(config.decayRate).toBe(DEFAULTS.decayRate);
    expect(config.defaultStrength).toBe(DEFAULTS.defaultStrength);
    expect(config.evictionThreshold).toBe(DEFAULTS.evictionThreshold);
    expect(config.path).toBe(DEFAULTS.path);
    expect(config.similarityThreshold).toBe(DEFAULTS.similarityThreshold);
    expect(config.embed).toBeUndefined();
  });

  it('overrides specific values', () => {
    const config = resolveConfig({ decayRate: 0.9, path: ':memory:' });
    expect(config.decayRate).toBe(0.9);
    expect(config.path).toBe(':memory:');
    expect(config.defaultStrength).toBe(DEFAULTS.defaultStrength);
  });

  it('overrides nested search weights', () => {
    const config = resolveConfig({ searchWeights: { bm25: 0.5 } });
    expect(config.searchWeights.bm25).toBe(0.5);
    expect(config.searchWeights.vector).toBe(DEFAULTS.searchWeights.vector);
  });

  it('accepts a custom clock', () => {
    const fixedDate = new Date('2026-01-01');
    const config = resolveConfig({ clock: () => fixedDate });
    expect(config.clock()).toBe(fixedDate);
  });

  it('accepts a custom embed function', () => {
    const config = resolveConfig({ embed: customEmbed });
    expect(config.embed).toBe(customEmbed);
  });

  it('returns empty typeStrength when not provided', () => {
    const config = resolveConfig();
    expect(config.typeStrength).toEqual({});
  });

  it('accepts a typeStrength map', () => {
    const config = resolveConfig({
      typeStrength: { rule: 0.6, entity: 0.5 },
    });
    expect(config.typeStrength['rule']).toBe(0.6);
    expect(config.typeStrength['entity']).toBe(0.5);
  });
});
