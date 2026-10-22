/**
 * Brave Search API (gratis tier). Elke query wordt geteld in usage_counters.
 */
import { env, hasEnv } from "@/lib/env";
import { reserveBraveQueries } from "@/lib/budget";
import { fetchJson } from "@/lib/fetch";

export type BraveResult = { url: string; title: string; description: string };

type BraveResponse = {
  web?: { results?: { url: string; title: string; description?: string }[] };
};

export function braveAvailable(): boolean {
  return hasEnv("BRAVE_SEARCH_API_KEY");
}

/**
 * Eén zoekopdracht, max 20 resultaten. Geeft null als Brave niet geconfigureerd
 * is of de maandlimiet bereikt is; de pijplijn gaat dan verder zonder.
 */
export async function braveSearch(query: string, opts: { count?: number; freshness?: "pw" | "pm" | "py" } = {}): Promise<BraveResult[] | null> {
  if (!braveAvailable()) return null;
  const ok = await reserveBraveQueries(1);
  if (!ok) return null;
  const params = new URLSearchParams({
    q: query,
    country: "BE",
    search_lang: "nl",
    count: String(opts.count ?? 20),
    text_decorations: "0",
    safesearch: "off",
  });
  if (opts.freshness) params.set("freshness", opts.freshness);
  const data = await fetchJson<BraveResponse>(`https://api.search.brave.com/res/v1/web/search?${params}`, {
    headers: { accept: "application/json", "x-subscription-token": env.BRAVE_SEARCH_API_KEY ?? "" },
  });
  if (!data) return [];
  return (data.web?.results ?? []).map((r) => ({ url: r.url, title: r.title, description: r.description ?? "" }));
}
