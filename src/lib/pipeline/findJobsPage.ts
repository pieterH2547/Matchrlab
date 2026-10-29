/**
 * Stap 4: jobpagina vinden per domein, goedkoop-eerst:
 *   a. ATS-detectie op de homepage -> publieke feed
 *   b. standaardpaden (/jobs, /vacatures, ...)
 *   c. Haiku kiest uit homepage-links
 *   d. Brave: site:<domein> vacature
 * Stoppen bij de eerste die werkt.
 */
import { looksLikeIntermediary } from "@/lib/blocklist";
import { fetchPage, isUsefulText, type LinkInfo } from "@/lib/fetch";
import { detectAts, type AtsDetection } from "@/lib/ats";
import { llmJson, type CostMeter } from "@/lib/llm";
import { webSearch } from "@/lib/search";
import { STANDARD_JOB_PATHS } from "@/lib/config";
import { JobsPagePickSchema } from "./types";

export type JobsPageResult =
  | { kind: "ats"; detection: AtsDetection; jobsUrl: string; companyName: string }
  | { kind: "page"; jobsUrl: string; text: string; links: LinkInfo[]; companyName: string; how: "standard-path" | "homepage-nav" | "brave" }
  | { kind: "none"; companyName: string; reason: string; braveUsed: boolean };

const JOB_WORDS = /(vacature|vacatures|jobs|job|career|careers|werken\s*bij|werkenbij|join|solliciteer|opportun|talent|loopbaan|emploi|offres|carri[eè]re|kom ons team|team versterken)/i;
/** Pad van een jobpagina in een sitemap (geen blogpost of nieuws). */
const JOB_PATH = /\/(vacatures?|jobs?|careers?|werken-bij[a-z-]*|join[a-z-]*|emplois?|carrieres?|carriere)(\/|$)/i;

/** Jobpagina uit /sitemap.xml halen: één goedkope fetch, helpt bij sites zonder link in het menu. */
export function jobsPageFromSitemap(xml: string, domain: string): string | null {
  let locs = Array.from(xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)).map((m) => m[1]);
  // Uit de cache komt enkel tekst: dan de losse url's.
  if (!locs.length) locs = Array.from(xml.matchAll(/https?:\/\/[^\s<>"']+/gi)).map((m) => m[0]);
  const hits = locs.filter((u) => {
    try {
      const url = new URL(u);
      return url.hostname.replace(/^www\./, "").endsWith(domain) && JOB_PATH.test(url.pathname);
    } catch {
      return false;
    }
  });
  // Liefst de overzichtspagina (kortste pad), niet één vacature.
  return hits.sort((a, b) => new URL(a).pathname.split("/").length - new URL(b).pathname.split("/").length)[0] ?? null;
}

const PICK_SYSTEM = `Je krijgt de links van de homepage van een bedrijf. Kies de link die naar de vacaturepagina of
"werken bij"-pagina van dat bedrijf leidt. Geef de volledige URL terug. Als er geen is, geef een lege string.
Kies nooit een link naar een extern jobboard, sociale media of een pdf.`;

function decodeEntities(s: string): string {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function companyNameFromTitle(title: string, domain: string): string {
  const cleaned = decodeEntities(title).split(/[|–—-]/)[0]?.trim();
  if (cleaned && cleaned.length <= 60 && !/home|welkom|welcome/i.test(cleaned)) return cleaned;
  return domain.split(".")[0].replace(/-/g, " ");
}

export async function findJobsPage(domain: string, meter: CostMeter, opts: { allowBrave?: boolean } = {}): Promise<JobsPageResult> {
  const homeUrl = `https://${domain}/`;
  const home = await fetchPage(homeUrl, { noCache: true });
  const linkUrls = home.links.map((l) => l.href);
  const titleMatch = home.html?.match(/<title[^>]*>([^<]*)<\/title>/i);
  const companyName = companyNameFromTitle(titleMatch?.[1]?.trim() ?? "", domain);

  if (home.status === 0 || (home.status >= 400 && home.status !== 403)) {
    return { kind: "none", companyName, reason: `homepage gaf status ${home.status}`, braveUsed: false };
  }

  // Tussenpersonen (recruitment, interim, consultancy, detachering) zijn geen werkgevers: overslaan.
  const intermediary = looksLikeIntermediary(titleMatch?.[1] ?? "", home.text);
  if (intermediary.yes) {
    return { kind: "none", companyName, reason: `tussenpersoon (${intermediary.reason})`, braveUsed: false };
  }

  // a. ATS-detectie
  const detection = home.html ? detectAts(home.html, linkUrls) : null;
  if (detection) {
    return { kind: "ats", detection, jobsUrl: detection.adapter.listingUrl(detection.slug), companyName };
  }

  // Links op de homepage die op een jobpagina lijken, intern eerst.
  const sameSite = (href: string) => {
    try {
      return new URL(href).hostname.replace(/^www\./, "").endsWith(domain);
    } catch {
      return false;
    }
  };
  const candidateLinks = home.links.filter((l) => JOB_WORDS.test(`${l.href} ${l.text}`) && sameSite(l.href));

  // b. standaardpaden (plus de interne joblinks die we al zagen; die zijn even goedkoop)
  const tried = new Set<string>();
  const candidates = [...candidateLinks.slice(0, 3).map((l) => l.href), ...STANDARD_JOB_PATHS.map((p) => `https://${domain}${p}`)];
  // Alle kandidaten tegelijk, zonder Jina: een trage of dode site houdt zo niet alles op.
  const unique = candidates.filter((u) => (tried.has(u) ? false : (tried.add(u), true))).slice(0, 18);
  const probes = await Promise.all(unique.map((url) => fetchPage(url, { allowJina: false }).then((page) => ({ url, page })).catch(() => null)));
  const okProbes = probes.filter((p): p is NonNullable<typeof p> => Boolean(p && p.page.status >= 200 && p.page.status < 300));
  const direct = okProbes.find((p) => isUsefulText(p.page.text) && JOB_WORDS.test(p.page.text.slice(0, 3000)));
  if (direct) return { kind: "page", jobsUrl: direct.url, text: direct.page.text, links: direct.page.links, companyName, how: "standard-path" };
  // JavaScript-sites: de pagina bestaat (200) maar is leeg; enkel dan Jina, op max twee kandidaten.
  for (const p of okProbes.filter((x) => !isUsefulText(x.page.text)).slice(0, 2)) {
    const page = await fetchPage(p.url, { allowJina: true, noCache: true });
    if (isUsefulText(page.text) && JOB_WORDS.test(page.text.slice(0, 3000))) {
      return { kind: "page", jobsUrl: p.url, text: page.text, links: page.links, companyName, how: "standard-path" };
    }
  }

  // b2. Sitemap: veel KMO-sites hebben een vacaturepagina die niet in het menu staat.
  const sitemap = await fetchPage(`https://${domain}/sitemap.xml`, { allowJina: false }).catch(() => null);
  const fromMap = sitemap && sitemap.status === 200 ? jobsPageFromSitemap(sitemap.html ?? sitemap.text, domain) : null;
  if (fromMap && !tried.has(fromMap)) {
    tried.add(fromMap);
    const page = await fetchPage(fromMap, { allowJina: true });
    if (page.status >= 200 && page.status < 300 && isUsefulText(page.text)) {
      return { kind: "page", jobsUrl: fromMap, text: page.text, links: page.links, companyName, how: "standard-path" };
    }
  }

  // c. Het lichte model kiest uit de homepage-links
  if (home.links.length > 0) {
    const list = home.links
      .filter((l) => sameSite(l.href))
      .slice(0, 120)
      .map((l) => `${l.href} — ${l.text}`)
      .join("\n");
    const pick = await llmJson({ system: PICK_SYSTEM, user: `Bedrijf: ${companyName} (${domain})\n\nLinks:\n${list}`, schema: JobsPagePickSchema, meter, effort: "low", maxTokens: 300 }).catch(
      () => ({ url: "" }),
    );
    if (pick.url && !tried.has(pick.url)) {
      tried.add(pick.url);
      const page = await fetchPage(pick.url, { allowJina: true });
      if (page.status >= 200 && page.status < 300 && isUsefulText(page.text)) {
        return { kind: "page", jobsUrl: pick.url, text: page.text, links: page.links, companyName, how: "homepage-nav" };
      }
    }
  }

  // d. Brave
  if (opts.allowBrave) {
    const results = await webSearch(`site:${domain} vacature OR vacatures OR jobs`, { count: 5 });
    if (results && results.length) {
      for (const r of results.slice(0, 2)) {
        if (tried.has(r.url)) continue;
        tried.add(r.url);
        const page = await fetchPage(r.url, { allowJina: true });
        if (page.status >= 200 && page.status < 300 && isUsefulText(page.text)) {
          return { kind: "page", jobsUrl: r.url, text: page.text, links: page.links, companyName, how: "brave" };
        }
      }
    }
    return { kind: "none", companyName, reason: "geen jobpagina gevonden", braveUsed: results !== null };
  }
  return { kind: "none", companyName, reason: "geen jobpagina gevonden", braveUsed: false };
}
