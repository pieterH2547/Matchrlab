/**
 * Telt API-aanroepen per bron binnen één stap van een run, zonder overal een teller
 * door te geven. Werkt via AsyncLocalStorage: alles wat binnen withUsage() loopt, telt mee.
 */
import { AsyncLocalStorage } from "node:async_hooks";

type Usage = { calls: Record<string, number>; failures: string[]; timings: Record<string, { n: number; ms: number; max: number }> };
const store = new AsyncLocalStorage<Usage>();

export async function withUsage<T>(fn: () => Promise<T>): Promise<{ result: T; usage: Usage }> {
  const usage: Usage = { calls: {}, failures: [], timings: {} };
  const result = await store.run(usage, fn);
  return { result, usage };
}

/** Eén aanroep naar een bron registreren (bv. "serper", "openai", "google_jobs"). */
export function countCall(source: string, n = 1): void {
  const u = store.getStore();
  if (u) u.calls[source] = (u.calls[source] ?? 0) + n;
}

/** Een bron die faalde registreren; de run gaat verder met de andere bronnen. */
export function noteFailure(message: string): void {
  const u = store.getStore();
  if (u && !u.failures.includes(message)) u.failures.push(message);
}

/** Duur van één aanroep (HTTP per soort host, LLM per taak, zoekprovider). Enkel tijden, geen inhoud. */
export function recordTiming(key: string, ms: number): void {
  const u = store.getStore();
  if (!u) return;
  const t = (u.timings[key] ??= { n: 0, ms: 0, max: 0 });
  t.n += 1;
  t.ms += ms;
  t.max = Math.max(t.max, ms);
}

export function mergeTimings(
  a: Record<string, { n: number; ms: number; max: number }> = {},
  b: Record<string, { n: number; ms: number; max: number }> = {},
): Record<string, { n: number; ms: number; max: number }> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const o = out[k] ?? { n: 0, ms: 0, max: 0 };
    out[k] = { n: o.n + v.n, ms: o.ms + v.ms, max: Math.max(o.max, v.max) };
  }
  return out;
}

export function mergeCalls(a: Record<string, number> = {}, b: Record<string, number> = {}): Record<string, number> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] ?? 0) + v;
  return out;
}
