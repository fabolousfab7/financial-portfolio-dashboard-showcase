/**
 * Numeric helpers. Financial amounts are carried as IEEE doubles and rounded
 * only at presentation or persistence boundaries; comparisons use an explicit
 * tolerance instead of `===`.
 */

export const EPSILON = 1e-9;

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  // Math.round is asymmetric for negatives; round half away from zero instead.
  return (Math.sign(value) * Math.round(Math.abs(value) * f + Number.EPSILON)) / f;
}

export function nearlyEqual(a: number, b: number, tolerance = 0.005): boolean {
  return Math.abs(a - b) <= tolerance;
}

export function sum(values: readonly number[]): number {
  // Neumaier compensated summation: keeps long ledgers stable.
  let total = 0;
  let compensation = 0;
  for (const v of values) {
    const t = total + v;
    compensation += Math.abs(total) >= Math.abs(v) ? total - t + v : v - t + total;
    total = t;
  }
  return total + compensation;
}

export function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}
