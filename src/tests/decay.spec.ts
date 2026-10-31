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
  it('applies boost inversely proportional to current strength', () => {
    // boost * (1 - strength) = 0.1 * (1 - 0.5) = 0.05
    // result = 0.5 + 0.05 = 0.55
    expect(reinforce(0.5, 0.1)).toBeCloseTo(0.55);
  });

  it('gives larger boost to weaker memories', () => {
    // boost * (1 - 0.2) = 0.1 * 0.8 = 0.08
    // result = 0.2 + 0.08 = 0.28
    expect(reinforce(0.2, 0.1)).toBeCloseTo(0.28);
  });

  it('gives smaller boost to stronger memories', () => {
    // boost * (1 - 0.9) = 0.1 * 0.1 = 0.01
    // result = 0.9 + 0.01 = 0.91
    expect(reinforce(0.9, 0.1)).toBeCloseTo(0.91);
  });

  it('gives zero boost at maximum strength', () => {
    // boost * (1 - 1.0) = 0
    expect(reinforce(1, 0.1)).toBe(1);
  });

  it('never exceeds 1.0', () => {
    // Even with a large boost, result should cap at 1.0
    expect(reinforce(0.5, 0.8)).toBeLessThanOrEqual(1);
  });
});
