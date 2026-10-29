/**
 * Eén zoekfunctie met een keten van providers. Elke provider met een key wordt in
 * volgorde geprobeerd; faalt hij (geen key, limiet op, fout), dan neemt de volgende over.
 *  - linkup  (gratis ±4.000/maand met professioneel e-mailadres)
 *  - tavily  (gratis 1.000 credits/maand)
 *  - exa     (gratis ±$10/maand)
 *  - brave   ($5 tegoed/maand, kaart nodig)
 *  - anthropic: ingebouwde web search van de Anthropic API (±$0,01 per zoekopdracht), laatste vangnet
 * SEARCH_PROVIDER = auto (standaard) volgt deze volgorde; een vaste keuze zet die provider vooraan.
 */
import Anthropic from "@anthropic-ai/sdk";
import { MODELS } from "@/lib/config";
import { recordSearches, reserveBraveQueries } from "@/lib/budget";
import { fetchJson, fetchRaw } from "@/lib/fetch";
import { getSetting } from "@/lib/settings";
import { resolveOpenAIModel } from "@/lib/openaiModels";

export type SearchResult = { url: string; title: string; description: string };
export type SearchProvider = "serper" | "linkup" | "tavily" | "exa" | "brave" | "openai" | "anthropic";
export type SearchOptions = { count?: number; freshness?: "pw" | "pm" | "py" };

const ORDER: SearchProvider[] = ["serper", "linkup", "tavily", "exa", "brave", "openai", "anthropic"];
const KEY: Record<SearchProvider, "SERPER_API_KEY" | "LINKUP_API_KEY" | "TAVILY_API_KEY" | "EXA_API_KEY" | "BRAVE_SEARCH_API_KEY" | "OPENAI_API_KEY" | "ANTHROPIC_API_KEY"> = {
  openai: "OPENAI_API_KEY",
  serper: "SERPER_API_KEY",
  linkup: "LINKUP_API_KEY",
  tavily: "TAVILY_API_KEY",
  exa: "EXA_API_KEY",
  brave: "BRAVE_SEARCH_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

/** Providers met een key, in de volgorde waarin we ze proberen. */
export async function providerChain(): Promise<SearchProvider[]> {
  const wanted = (await getSetting("SEARCH_PROVIDER")) ?? "auto";
  // Claude web search enkel als je hem uitdrukkelijk vooraan zet; standaard enkel de gratis zoekmachines (+ Brave).
  const base = wanted === "anthropic" ? ORDER : ORDER.filter((p) => p !== "anthropic");
  const order = base.includes(wanted as SearchProvider) ? [wanted as SearchProvider, ...base.filter((p) => p !== wanted)] : base;
  const out: SearchProvider[] = [];
  for (const p of order) if (await getSetting(KEY[p])) out.push(p);
  return out;
}

/** De provider die als eerste geprobeerd wordt (voor de UI en diagnose). */
export async function resolveProvider(): Promise<SearchProvider | "geen"> {
  return (await providerChain())[0] ?? "geen";
}

export function searchAvailable(): boolean {
  return true;
}

/** Providers die deze run al faalden (limiet, fout), zodat we ze niet blijven proberen. Per serverinstantie. */
const cooling = new Map<SearchProvider, number>();
const COOL_MS = 10 * 60 * 1000;

/**
 * Eén zoekopdracht. Geeft null als geen enkele provider kon antwoorden; de pijplijn
 * gaat dan verder zonder. Een leeg resultaat van een werkende provider is een geldig antwoord.
 */
export async function webSearch(query: string, opts: SearchOptions = {}): Promise<SearchResult[] | null> {
  for (const p of await providerChain()) {
    const until = cooling.get(p);
    if (until && until > Date.now()) continue;
    let r: SearchResult[] | null = null;
    try {
      r = await runProvider(p, query, opts);
    } catch (e) {
      console.warn(`[search] ${p} gooide een fout: ${e instanceof Error ? e.message : String(e)}`);
      r = null;
    }
    if (r !== null) {
      // Brave telt zichzelf al (maandlimiet); de rest tellen we hier.
      if (p !== "brave") await recordSearches(1).catch(() => undefined);
      return r.filter((x) => /^https?:\/\//.test(x.url)).slice(0, opts.count ?? 20);
    }
    cooling.set(p, Date.now() + COOL_MS);
    console.warn(`[search] ${p} faalde; volgende provider`);
  }
  return null;
}

/** Test één provider rechtstreeks, zonder keten of afkoeling. Voor de testknop in Instellingen. */
export async function testProvider(p: SearchProvider, query: string): Promise<{ ok: boolean; count: number; ms: number; sample: string[] }> {
  const t = Date.now();
  let r: SearchResult[] | null = null;
  try {
    r = await runProvider(p, query, { count: 5 });
  } catch {
    r = null;
  }
  if (r !== null) cooling.delete(p);
  return { ok: r !== null, count: r?.length ?? 0, ms: Date.now() - t, sample: (r ?? []).slice(0, 3).map((x) => x.url) };
}

export const SEARCH_PROVIDERS = ORDER;

async function runProvider(p: SearchProvider, query: string, opts: SearchOptions): Promise<SearchResult[] | null> {
  const key = await getSetting(KEY[p]);
  if (!key) return null;
  if (p === "serper") return serperSearch(key, query, opts);
  if (p === "linkup") return linkupSearch(key, query, opts);
  if (p === "tavily") return tavilySearch(key, query, opts);
  if (p === "exa") return exaSearch(key, query, opts);
  if (p === "brave") return braveSearch(key, query, opts);
  if (p === "openai") return openaiWebSearch(key, query, opts);
  return anthropicSearch(query, opts);
}

function sinceDate(f: SearchOptions["freshness"]): string | undefined {
  if (!f) return undefined;
  const days = f === "pw" ? 7 : f === "pm" ? 31 : 365;
  return new Date(Date.now() - days * 24 * 3600 * 1000).toISOString().slice(0, 10);
}

/** POST met JSON; geeft null bij elke niet-2xx (auth, limiet, storing) zodat de keten doorschakelt. */
async function postJson(url: string, body: unknown, headers: Record<string, string>): Promise<unknown | null> {
  const r = await fetchRaw(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json", ...headers }, body: JSON.stringify(body) });
  if (r.status < 200 || r.status >= 300) {
    console.warn(`[search] ${new URL(url).hostname} gaf HTTP ${r.status}`);
    return null;
  }
  try {
    return JSON.parse(r.body);
  } catch {
    return null;
  }
}

type AnyResult = { url?: string; link?: string; title?: string; name?: string; content?: string; snippet?: string; description?: string; text?: string };

function mapResults(list: unknown): SearchResult[] {
  if (!Array.isArray(list)) return [];
  return (list as AnyResult[])
    .map((r) => ({
      url: r.url ?? r.link ?? "",
      title: (r.title ?? r.name ?? "").trim(),
      description: (r.content ?? r.snippet ?? r.description ?? r.text ?? "").replace(/\s+/g, " ").trim().slice(0, 400),
    }))
    .filter((r) => r.url);
}

/** Serper: echte Google-resultaten voor België, in het Nederlands. */
async function serperSearch(key: string, query: string, opts: SearchOptions): Promise<SearchResult[] | null> {
  const body: Record<string, unknown> = { q: query, gl: "be", hl: "nl", num: Math.min(opts.count ?? 10, 20) };
  if (opts.freshness) body.tbs = opts.freshness === "pw" ? "qdr:w" : opts.freshness === "pm" ? "qdr:m" : "qdr:y";
  const data = (await postJson("https://google.serper.dev/search", body, { "x-api-key": key })) as { organic?: unknown } | null;
  return data ? mapResults(data.organic) : null;
}

export type PlaceResult = { name: string; website: string; address: string; category: string };

/**
 * Google Maps via Serper: lokale bedrijven met hun website, bv. "boekhoudkantoor Mechelen".
 * De beste bron om werkgevers in een regio te vinden. Geeft null zonder Serper-key.
 */
export async function placesSearch(query: string): Promise<PlaceResult[] | null> {
  const key = await getSetting("SERPER_API_KEY");
  if (!key) return null;
  const data = (await postJson("https://google.serper.dev/places", { q: query, gl: "be", hl: "nl" }, { "x-api-key": key })) as {
    places?: { title?: string; website?: string; address?: string; category?: string; type?: string }[];
  } | null;
  if (!data) return null;
  await recordSearches(1).catch(() => undefined);
  return (data.places ?? [])
    .filter((p) => p.website && /^https?:\/\//.test(p.website))
    .map((p) => ({ name: (p.title ?? "").trim(), website: p.website!, address: (p.address ?? "").trim(), category: (p.category ?? p.type ?? "").trim() }));
}

async function linkupSearch(key: string, query: string, opts: SearchOptions): Promise<SearchResult[] | null> {
  const body: Record<string, unknown> = { q: query, depth: "standard", outputType: "searchResults", includeImages: false };
  const from = sinceDate(opts.freshness);
  if (from) body.fromDate = from;
  const data = (await postJson("https://api.linkup.so/v1/search", body, { authorization: `Bearer ${key}` })) as { results?: unknown } | null;
  return data ? mapResults(data.results) : null;
}

async function tavilySearch(key: string, query: string, opts: SearchOptions): Promise<SearchResult[] | null> {
  const body: Record<string, unknown> = { query, search_depth: "basic", max_results: Math.min(opts.count ?? 10, 20), country: "belgium" };
  if (opts.freshness) body.time_range = opts.freshness === "pw" ? "week" : opts.freshness === "pm" ? "month" : "year";
  const data = (await postJson("https://api.tavily.com/search", body, { authorization: `Bearer ${key}` })) as { results?: unknown } | null;
  return data ? mapResults(data.results) : null;
}

async function exaSearch(key: string, query: string, opts: SearchOptions): Promise<SearchResult[] | null> {
  const body: Record<string, unknown> = { query, numResults: Math.min(opts.count ?? 10, 25), type: "auto", userLocation: "BE" };
  const from = sinceDate(opts.freshness);
  if (from) body.startPublishedDate = `${from}T00:00:00.000Z`;
  const data = (await postJson("https://api.exa.ai/search", body, { "x-api-key": key })) as { results?: unknown } | null;
  return data ? mapResults(data.results) : null;
}

type BraveResponse = { web?: { results?: { url: string; title: string; description?: string }[] } };

async function braveSearch(key: string, query: string, opts: SearchOptions): Promise<SearchResult[] | null> {
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
  if (!data) return null;
  return (data.web?.results ?? []).map((r) => ({ url: r.url, title: r.title, description: r.description ?? "" }));
}

/**
 * ChatGPT web search via de OpenAI Responses API, met dezelfde key als de AI.
 * Betalend (±een cent per zoekopdracht), daarom het laatste vangnet in de keten.
 */
async function openaiWebSearch(key: string, query: string, opts: SearchOptions): Promise<SearchResult[] | null> {
  const model = await resolveOpenAIModel("cheap");
  const freshness = opts.freshness === "pw" ? " (voorbije week)" : opts.freshness === "pm" ? " (voorbije maand)" : "";
  const data = (await postJson(
    "https://api.openai.com/v1/responses",
    {
      model,
      tools: [{ type: "web_search", user_location: { type: "approximate", country: "BE" } }],
      tool_choice: "required",
      include: ["web_search_call.action.sources"],
      input: `Zoek op het web naar: ${query}${freshness}. Antwoord enkel met de lijst van gevonden pagina's.`,
    },
    { authorization: `Bearer ${key}` },
  )) as { output?: { type?: string; action?: { sources?: { url?: string; title?: string }[] }; content?: { annotations?: { type?: string; url?: string; title?: string }[] }[] }[] } | null;
  if (!data) return null;
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  const add = (url?: string, title?: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, title: (title ?? "").trim(), description: "" });
  };
  for (const item of data.output ?? []) {
    for (const src of item.action?.sources ?? []) add(src.url, src.title);
    for (const c of item.content ?? []) for (const a of c.annotations ?? []) if (a.type === "url_citation") add(a.url, a.title);
  }
  return out.slice(0, opts.count ?? 20);
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
      system: "Je bent een zoekrobot. Je MOET de tool web_search aanroepen met de opgegeven zoekopdracht, letterlijk en onvertaald. Antwoord daarna enkel met het woord: ok",
      messages: [{ role: "user", content: `Zoek op het web naar: ${query}${freshness}` }],
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 1, user_location: { type: "approximate", country: "BE", timezone: "Europe/Brussels" } }],
      tool_choice: { type: "any" },
    });
  } catch (e) {
    console.warn(`[search] anthropic web search faalde: ${e instanceof Error ? e.message : String(e)}`);
    return null;
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
  if (out.length === 0) {
    const kinds = res.content.map((b) => (b.type === "web_search_tool_result" && !Array.isArray(b.content) ? `${b.type}:${b.content.error_code}` : b.type)).join(",");
    console.warn(`[search] anthropic web search gaf 0 resultaten voor "${query.slice(0, 60)}" (blokken: ${kinds}; stop=${res.stop_reason})`);
  }
  return out.slice(0, opts.count ?? 20);
}

