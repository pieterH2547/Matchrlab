/**
 * Pagina's ophalen met cache (7 dagen), tekstextractie en Jina Reader als
 * fallback voor JS-shells. Nooit twee keer dezelfde URL binnen de TTL.
 */
import * as cheerio from "cheerio";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getSetting } from "@/lib/settings";
import { LIMITS } from "@/lib/config";

const UA = "Mozilla/5.0 (compatible; MatchrBot/0.1; +https://recruitrlab.be) Chrome/120 Safari/537.36";

export type FetchedPage = {
  url: string;
  finalUrl: string;
  status: number;
  /** Ruwe HTML (enkel bij een live fetch, niet uit cache). */
  html?: string;
  /** Leesbare tekst. */
  text: string;
  /** Absolute links (enkel bij een live fetch). */
  links: { href: string; text: string }[];
  fromCache: boolean;
};

export type LinkInfo = { href: string; text: string };

export function htmlToText(html: string, baseUrl: string): { text: string; links: LinkInfo[]; title: string } {
  const $ = cheerio.load(html);
  $("script, style, noscript, svg, iframe, template").remove();
  const title = $("title").first().text().trim();
  const links: LinkInfo[] = [];
  const seen = new Set<string>();
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href");
    if (!href) return;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:/.test(abs)) return;
    abs = abs.split("#")[0];
    if (seen.has(abs)) return;
    seen.add(abs);
    const t = $(el).text().replace(/\s+/g, " ").trim().slice(0, 120);
    links.push({ href: abs, text: t });
  });
  // Blokelementen scheiden met newlines zodat lijsten leesbaar blijven.
  $("br").replaceWith("\n");
  $("p, div, li, h1, h2, h3, h4, h5, h6, tr, section, article, header, footer, nav").each((_, el) => {
    $(el).prepend("\n").append("\n");
  });
  const text = $("body").text().replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();
  return { text, links, title };
}

async function timedFetch(url: string, init?: RequestInit, timeoutMs: number = LIMITS.fetchTimeoutMs): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8", "accept-language": "nl-BE,nl;q=0.9,en;q=0.5", ...(init?.headers ?? {}) },
    });
  } finally {
    clearTimeout(t);
  }
}

async function readBody(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      total += value.byteLength;
      if (total > LIMITS.fetchMaxBytes) {
        await reader.cancel();
        break;
      }
    }
  }
  const buf = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    buf.set(c.subarray(0, Math.min(c.byteLength, total - off)), off);
    off += c.byteLength;
    if (off >= total) break;
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(buf);
}

/** Ruwe fetch zonder cache: voor API's en ATS-feeds. Trage API's (AI-zoeken, Google Jobs) geven een ruimere timeout mee. */
export async function fetchRaw(url: string, init?: RequestInit, timeoutMs?: number): Promise<{ status: number; body: string; finalUrl: string }> {
  try {
    const res = await timedFetch(url, init, timeoutMs);
    const body = await readBody(res);
    return { status: res.status, body, finalUrl: res.url || url };
  } catch {
    return { status: 0, body: "", finalUrl: url };
  }
}

export async function fetchJson<T = unknown>(url: string, init?: RequestInit, timeoutMs?: number): Promise<T | null> {
  const r = await fetchRaw(url, init, timeoutMs);
  if (r.status < 200 || r.status >= 300) return null;
  try {
    return JSON.parse(r.body) as T;
  } catch {
    return null;
  }
}

function cacheIsFresh(fetchedAt: Date): boolean {
  return Date.now() - fetchedAt.getTime() < LIMITS.cacheTtlDays * 24 * 3600 * 1000;
}

async function readCache(url: string) {
  const rows = await db().select().from(schema.pageCache).where(eq(schema.pageCache.url, url)).limit(1);
  const row = rows[0];
  if (row && cacheIsFresh(row.fetchedAt)) return row;
  return null;
}

async function writeCache(url: string, status: number, text: string) {
  const contentText = text.slice(0, 60_000);
  await db()
    .insert(schema.pageCache)
    .values({ url, statusCode: status, contentText, fetchedAt: new Date() })
    .onConflictDoUpdate({
      target: schema.pageCache.url,
      set: { statusCode: status, contentText, fetchedAt: new Date() },
    });
}

/** Jina Reader: haalt een JS-shell op als leesbare tekst. Gratis tier werkt zonder key; key geeft hogere limieten. */
export async function fetchViaJina(url: string): Promise<string | null> {
  const headers: Record<string, string> = { accept: "text/plain", "x-return-format": "text" };
  const jina = await getSetting("JINA_API_KEY");
  if (jina) headers.authorization = `Bearer ${jina}`;
  const r = await fetchRaw(`https://r.jina.ai/${url}`, { headers });
  if (r.status !== 200 || r.body.length < LIMITS.minUsefulChars) return null;
  return r.body;
}

/** Firecrawl: rendert zware JS-sites tot markdown. Enkel als er een key is en Jina faalde. */
export async function fetchViaFirecrawl(url: string): Promise<string | null> {
  const key = await getSetting("FIRECRAWL_API_KEY");
  if (!key) return null;
  const init = {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
  };
  for (const endpoint of ["https://api.firecrawl.dev/v2/scrape", "https://api.firecrawl.dev/v1/scrape"]) {
    const data = await fetchJson<{ success?: boolean; data?: { markdown?: string } }>(endpoint, init, 25_000);
    const md = data?.data?.markdown;
    if (md && md.length >= LIMITS.minUsefulChars) return md;
    if (data) return null;
  }
  return null;
}

export function isUsefulText(text: string): boolean {
  return text.replace(/\s+/g, " ").trim().length >= LIMITS.minUsefulChars;
}

/**
 * Pagina ophalen als tekst, met cache. Bij een live fetch komen ook html en links mee.
 * `allowJina` schakelt de Reader-fallback in voor pagina's met weinig inhoud.
 */
export async function fetchPage(url: string, opts: { allowJina?: boolean; noCache?: boolean } = {}): Promise<FetchedPage> {
  if (!opts.noCache) {
    const cached = await readCache(url);
    if (cached) {
      return { url, finalUrl: url, status: cached.statusCode, text: cached.contentText ?? "", links: [], fromCache: true };
    }
  }
  const r = await fetchRaw(url);
  let text = "";
  let links: LinkInfo[] = [];
  let html: string | undefined;
  if (r.status >= 200 && r.status < 300 && r.body) {
    const looksHtml = /<\s*(html|body|div|a)\b/i.test(r.body.slice(0, 5000)) || r.body.trimStart().startsWith("<");
    if (looksHtml) {
      html = r.body;
      const parsed = htmlToText(r.body, r.finalUrl);
      text = parsed.text;
      links = parsed.links;
    } else {
      text = r.body;
    }
  }
  if (opts.allowJina && r.status !== 404 && !isUsefulText(text)) {
    const jina = await fetchViaJina(url);
    if (jina) text = jina;
    if (!isUsefulText(text)) {
      const fc = await fetchViaFirecrawl(url);
      if (fc) text = fc;
    }
  }
  await writeCache(url, r.status, text).catch(() => undefined);
  return { url, finalUrl: r.finalUrl, status: r.status, html, text, links, fromCache: false };
}

/** Beperkt paginatekst tot wat we aan het model durven geven. */
export function clampText(text: string, max: number = LIMITS.maxPageChars): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n[...afgekapt...]`;
}
