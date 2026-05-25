function effectiveStrength(
  strength: number,
  daysSince: number,
  decayRate: number,
): number {
  return strength * decayRate ** daysSince;
}

function reinforce(currentStrength: number, boost: number): number {
  return Math.min(1, currentStrength + boost * (1 - currentStrength));
}

function daysBetween(a: Date, b: Date): number {
  return Math.abs(b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24);
}

export { daysBetween, effectiveStrength, reinforce };
