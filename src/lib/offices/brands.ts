/**
 * Kantorenkaart, bron merksites: banken die per kantoor een eigen pagina hebben die in hun sitemap staat
 * (robots.txt laat die toe). We lezen de sitemap, dan elke kantoorpagina (via page_cache), en halen naam, adres,
 * telefoon en mailadres eruit. Geen coördinaten op die pagina's: de ligging komt van het postcodemiddelpunt en wordt
 * exact zodra Google Maps of OpenStreetMap hetzelfde kantoor kent (samenvoegen op naam + postcode).
 */
import { fetchPage, fetchRaw } from "@/lib/fetch";
import { parseListingFromHtml, parseListingFromText } from "./classify";
import type { OfficeSector } from "./classify";

export type BrandSite = { key: string; brand: string; sector: OfficeSector; sitemaps: string[]; pattern: RegExp };

export const BRAND_SITES: BrandSite[] = [
  { key: "argenta", brand: "Argenta", sector: "bank", sitemaps: ["https://www.argenta.be/nl.sitemap.xml"], pattern: /^https:\/\/www\.argenta\.be\/nl\/kantoren\/[^/]+\.html$/ },
  { key: "crelan", brand: "Crelan", sector: "bank", sitemaps: ["https://www.crelan.be/sitemap.xml"], pattern: /^https:\/\/www\.crelan\.be\/nl\/particulieren\/kantoor\/[^/]+\/?$/ },
];

/** Alle <loc>-URL's uit een sitemap, sitemap-indexen één niveau diep gevolgd. */
export async function sitemapUrls(url: string, depth = 0): Promise<string[]> {
  const r = await fetchRaw(url, undefined, 30_000);
  if (r.status < 200 || r.status >= 300) return [];
  const locs = [...r.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"));
  if (/<sitemapindex/i.test(r.body) && depth < 1) {
    const out: string[] = [];
    for (const child of locs.slice(0, 20)) out.push(...(await sitemapUrls(child, depth + 1)));
    return out;
  }
  return locs;
}

export type BrandPage = { url: string; name: string; address: string | null; postcode: string | null; municipality: string | null; phone: string | null; email: string | null; website: string | null };

/** Kantoorpagina's van één merk lezen: `offset` en `limit` maken het hervatbaar; gelezen pagina's zitten in page_cache. */
export async function readBrandPages(site: BrandSite, offset: number, limit: number): Promise<{ total: number; pages: BrandPage[]; next: number | null }> {
  const all = (await Promise.all(site.sitemaps.map((s) => sitemapUrls(s)))).flat().filter((u) => site.pattern.test(u));
  const unique = Array.from(new Set(all)).sort();
  const slice = unique.slice(offset, offset + limit);
  const pages: BrandPage[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, slice.length) }, async () => {
      while (next < slice.length) {
        const url = slice[next++];
        const page = await fetchPage(url).catch(() => null);
        if (!page || page.status >= 400) continue;
        const title = page.html?.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "";
        const parsed = page.html ? parseListingFromHtml(page.html, title) : parseListingFromText(page.text, title);
        if (!parsed) continue;
        const email = (page.html ?? page.text).match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ?? null;
        pages.push({ url, name: cleanName(parsed.name, site.brand), address: parsed.address, postcode: parsed.postcode, municipality: parsed.municipality, phone: parsed.phone, email: email && !/example|sentry|wixpress/.test(email) ? email : null, website: url });
      }
    }),
  );
  return { total: unique.length, pages, next: offset + limit < unique.length ? offset + limit : null };
}

/** Paginatitels zoals "Kantoor De Feyter bvba | Argenta" worden "Argenta De Feyter bvba". */
export function cleanName(title: string, brand: string): string {
  const base = title
    .split(/\s*[|–—-]\s*(?=[^|–—-]*$)/)[0]
    .replace(new RegExp(`\\b${brand}\\b`, "i"), "")
    .replace(/\b(kantoor|kantoorzoeker|zelfstandig bankagent|bankagent|agentschap)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  return base ? `${brand} ${base}` : brand;
}
