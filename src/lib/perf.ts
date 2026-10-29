/** p50/p95 per fase over recente runs. Enkel tijden, geen kandidaatgegevens. */
export function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

export function summarizeTimings(list: Record<string, number>[]): { phase: string; n: number; p50: number; p95: number }[] {
  const by = new Map<string, number[]>();
  for (const t of list) for (const [k, v] of Object.entries(t)) if (typeof v === "number" && v > 0) by.set(k, [...(by.get(k) ?? []), v]);
  return Array.from(by.entries()).map(([phase, v]) => ({ phase, n: v.length, p50: percentile(v, 50), p95: percentile(v, 95) }));
}
