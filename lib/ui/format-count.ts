// Compact tally for public counters (post view/impression count) — 1-3
// significant digits plus a magnitude letter, trimming a trailing ".0"
// (1000 -> "1K", 1500 -> "1.5K", not "1.0K"). Counts below 1000 show exact.
export function formatCompactCount(n: number): string {
  if (n < 1000) return String(n);
  const units: [number, string][] = [
    [1_000_000_000, 'B'],
    [1_000_000, 'M'],
    [1_000, 'K'],
  ];
  const [divisor, suffix] = units.find(([d]) => n >= d)!;
  const value = n / divisor;
  const rounded = value < 10 ? Math.round(value * 10) / 10 : Math.round(value);
  return `${rounded}${suffix}`;
}
