/**
 * Eén zoekfunctie, drie providers. Keuze via instelling SEARCH_PROVIDER:
 *  - brave: Brave Search API (gratis tier, maandteller in usage_counters)
 *  - google: Google Custom Search JSON API (100 queries/dag gratis)
 *  - anthropic: de ingebouwde web search van de Anthropic API (zelfde key als de modellen, ±$0,01 per zoekopdracht)
 *  - duckduckgo: HTML-endpoint van DuckDuckGo, geen key nodig, maar blokkeert Vercel-servers
 *  - auto (standaard): brave als er een key is, anders google, anders anthropic, anders duckduckgo
 */
import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "@/lib/config";
import * as cheerio from "cheerio";
import { reserveBraveQueries } from "@/lib/budget";
import { fetchJson, fetchRaw } from "@/lib/fetch";
import { getSetting } from "@/lib/settings";

export type SearchResult = { url: string; title: string; description: string };
export type SearchProvider = "brave" | "google" | "anthropic" | "duckduckgo";
export type SearchOptions = { count?: number; freshness?: "pw" | "pm" | "py" };

export async function resolveProvider(): Promise<SearchProvider> {
  const wanted = (await getSetting("SEARCH_PROVIDER")) ?? "auto";
  const brave = await getSetting("BRAVE_SEARCH_API_KEY");
  const google = (await getSetting("GOOGLE_API_KEY")) && (await getSetting("GOOGLE_CSE_ID"));
  const anthropic = await getSetting("ANTHROPIC_API_KEY");
  if (wanted === "brave" && brave) return "brave";
  if (wanted === "google" && google) return "google";
  if (wanted === "anthropic" && anthropic) return "anthropic";
  if (wanted === "duckduckgo") return "duckduckgo";
  if (brave) return "brave";
  if (google) return "google";
  if (anthropic) return "anthropic";
  return "duckduckgo";
}

/** Er is altijd een provider (DuckDuckGo heeft geen key nodig). */
export function searchAvailable(): boolean {
  return true;
}

/**
 * Eén zoekopdracht. Geeft null als de gekozen provider zijn limiet bereikt
 * heeft; de pijplijn gaat dan verder zonder.
 */
export async function webSearch(query: string, opts: SearchOptions = {}): Promise<SearchResult[] | null> {
  const provider = await resolveProvider();
  if (provider === "brave") return braveSearch(query, opts);
  if (provider === "google") return googleSearch(query, opts);
  if (provider === "anthropic") return anthropicSearch(query, opts);
  return duckduckgoSearch(query, opts);
}

type BraveResponse = { web?: { results?: { url: string; title: string; description?: string }[] } };

async function braveSearch(query: string, opts: SearchOptions): Promise<SearchResult[] | null> {
  const key = await getSetting("BRAVE_SEARCH_API_KEY");
  if (!key) return null;
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
    headers: { accept: "application/json", "x-subscription-token": key },
  });
  if (!data) return [];
  return (data.web?.results ?? []).map((r) => ({ url: r.url, title: r.title, description: r.description ?? "" }));
}

type GoogleResponse = { items?: { link: string; title: string; snippet?: string }[]; error?: { code?: number } };

async function googleSearch(query: string, opts: SearchOptions): Promise<SearchResult[] | null> {
  const key = await getSetting("GOOGLE_API_KEY");
  const cx = await getSetting("GOOGLE_CSE_ID");
  if (!key || !cx) return null;
  const dateRestrict = opts.freshness === "pw" ? "w1" : opts.freshness === "pm" ? "m1" : opts.freshness === "py" ? "y1" : undefined;
  const want = Math.min(opts.count ?? 10, 20);
  const out: SearchResult[] = [];
  // Google geeft max 10 per aanroep; voor 20 doen we twee pagina's.
  for (let start = 1; start <= want; start += 10) {
    const params = new URLSearchParams({ key, cx, q: query, num: String(Math.min(10, want - start + 1)), start: String(start), gl: "be", hl: "nl" });
    if (dateRestrict) params.set("dateRestrict", dateRestrict);
    const data = await fetchJson<GoogleResponse>(`https://www.googleapis.com/customsearch/v1?${params}`);
    if (!data) break;
    if (data.error?.code === 429) return out.length ? out : null;
    const items = data.items ?? [];
    for (const it of items) out.push({ url: it.link, title: it.title, description: it.snippet ?? "" });
    if (items.length < 10) break;
  }
  return out;
}

/**
 * Web search via de Anthropic API: het model doet precies één zoekopdracht en we
 * lezen de resultaten uit het tool-resultaat. Het antwoord zelf gooien we weg.
 */
async function anthropicSearch(query: string, opts: SearchOptions): Promise<SearchResult[] | null> {
  const key = await getSetting("ANTHROPIC_API_KEY");
  if (!key) return null;
  const client = new Anthropic({ apiKey: key, maxRetries: 1, timeout: 45_000 });
  const freshness = opts.freshness === "pw" ? " (enkel resultaten van de voorbije week)" : opts.freshness === "pm" ? " (enkel resultaten van de voorbije maand)" : "";
  let res;
  try {
    res = await client.messages.create({
      model: MODELS.cheap,
      max_tokens: 200,
      system: "Je bent een zoekrobot. Voer exact één web_search uit met de opgegeven zoekopdracht, letterlijk, en antwoord daarna enkel met het woord: ok",
      messages: [{ role: "user", content: `Zoekopdracht: ${query}${freshness}` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1, user_location: { type: "approximate", country: "BE", timezone: "Europe/Brussels" } }],
    });
  } catch (e) {
    const status = (e as { status?: number }).status;
    if (status === 429) return null;
    console.warn(`[search] anthropic web search faalde: ${e instanceof Error ? e.message : String(e)}`);
    return [];
  }
  const out: SearchResult[] = [];
  for (const block of res.content) {
    if (block.type !== "web_search_tool_result") continue;
    if (!Array.isArray(block.content)) continue;
    for (const r of block.content) {
      if (r.type !== "web_search_result") continue;
      out.push({ url: r.url, title: r.title, description: r.page_age ? `(${r.page_age})` : "" });
    }
  }
  return out.slice(0, opts.count ?? 20);
}

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

function unwrapDdg(href: string): string | null {
  // DDG wikkelt links in een redirect: //duckduckgo.com/l/?uddg=<url>&rut=...
  const m = href.match(/[?&]uddg=([^&]+)/);
  if (m) href = decodeURIComponent(m[1]);
  if (href.startsWith("//")) href = `https:${href}`;
  return /^https?:\/\//.test(href) ? href : null;
}

/** Geen key nodig. Het html-endpoint geeft af en toe een lege 202 (bot-check); dan proberen we het lite-endpoint. */
export async function duckduckgoSearch(query: string, opts: SearchOptions = {}): Promise<SearchResult[] | null> {
  const params = new URLSearchParams({ q: query, kl: "be-nl" });
  if (opts.freshness) params.set("df", opts.freshness === "pw" ? "w" : opts.freshness === "pm" ? "m" : "y");
  const headers = { "user-agent": UA, accept: "text/html", "accept-language": "nl-BE,nl;q=0.9" };
  const max = opts.count ?? 20;

  const html = await fetchRaw(`https://html.duckduckgo.com/html/?${params}`, { headers });
  if (html.status === 200) {
    const $ = cheerio.load(html.body);
    const out: SearchResult[] = [];
    $(".result").each((_, el) => {
      const a = $(el).find("a.result__a").first();
      const url = unwrapDdg(a.attr("href") ?? "");
      if (!url) return;
      out.push({ url, title: a.text().trim(), description: $(el).find(".result__snippet").text().trim() });
    });
    if (out.length) return out.slice(0, max);
  }

  const lite = await fetchRaw(`https://lite.duckduckgo.com/lite/?${params}`, { headers });
  if (lite.status !== 200) {
    console.warn(`[search] duckduckgo gaf html=${html.status} lite=${lite.status} voor "${query.slice(0, 60)}"`);
    return [];
  }
  const $ = cheerio.load(lite.body);
  const out: SearchResult[] = [];
  $("a.result-link").each((_, a) => {
    const url = unwrapDdg($(a).attr("href") ?? "");
    if (!url) return;
    const snippet = $(a).closest("tr").next("tr").find(".result-snippet").text().trim();
    out.push({ url, title: $(a).text().trim(), description: snippet });
  });
  return out.slice(0, max);
}
