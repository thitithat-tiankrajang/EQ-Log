// Small, standard statistics — nothing fitted, nothing tuned.

/** Wilson score interval for k successes in n (95% by default). */
export function wilson(k, n, z = 1.96) {
  if (n === 0) return [0, 1];
  const p = k / n;
  const denominator = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denominator;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denominator;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/**
 * Newcombe's hybrid score interval (method 10) for p1 − p2, from the two
 * Wilson intervals. Used for "is Strong really ahead of Weak?".
 */
export function differenceInterval(k1, n1, k2, n2, z = 1.96) {
  const p1 = k1 / n1;
  const p2 = k2 / n2;
  const [l1, u1] = wilson(k1, n1, z);
  const [l2, u2] = wilson(k2, n2, z);
  const d = p1 - p2;
  return [
    d - Math.sqrt((p1 - l1) ** 2 + (u2 - p2) ** 2),
    d + Math.sqrt((u1 - p1) ** 2 + (p2 - l2) ** 2),
  ];
}

export function percentile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
}

export const mean = (values) =>
  values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
export const r1 = (value) => (value == null ? null : Math.round(value * 10) / 10);
export const r3 = (value) => (value == null ? null : Math.round(value * 1000) / 1000);
