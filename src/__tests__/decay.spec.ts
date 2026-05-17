import { describe, expect, it } from 'vitest';

import { effectiveStrength, reinforce } from '../decay.js';

describe('effectiveStrength', () => {
  it('returns stored strength when zero days have passed', () => {
    expect(effectiveStrength(0.8, 0, 0.95)).toBe(0.8);
  });

  it('decays over 1 day', () => {
    expect(effectiveStrength(0.8, 1, 0.95)).toBeCloseTo(0.76);
  });

  it('decays over 10 days', () => {
    expect(effectiveStrength(0.8, 10, 0.95)).toBeCloseTo(0.4784);
  });

  it('decays over 30 days', () => {
    const result = effectiveStrength(0.8, 30, 0.95);
    expect(result).toBeCloseTo(0.1732);
  });

  it('returns near-zero for very old memories', () => {
    const result = effectiveStrength(0.5, 100, 0.95);
    expect(result).toBeLessThan(0.01);
  });

  it('never goes below zero', () => {
    expect(effectiveStrength(0.1, 1000, 0.95)).toBeGreaterThanOrEqual(0);
  });
});

describe('reinforce', () => {
  it('boosts effective strength by boost amount', () => {
    expect(reinforce(0.5, 0.1)).toBeCloseTo(0.6);
  });

  it('caps at 1.0', () => {
    expect(reinforce(0.95, 0.1)).toBe(1);
  });

  it('caps at 1.0 even with large boost', () => {
    expect(reinforce(0.5, 0.8)).toBe(1);
  });
});
