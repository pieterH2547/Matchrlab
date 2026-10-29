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

const JOB_WORDS = /(vacature|vacatures|jobs|job|career|careers|werken\s*bij|werkenbij|join|solliciteer|opportun|talent|loopbaan|emploi|offres)/i;

const PICK_SYSTEM = `Je krijgt de links van de homepage van een bedrijf. Kies de link die naar de vacaturepagina of
"werken bij"-pagina van dat bedrijf leidt. Geef de volledige URL terug. Als er geen is, geef een lege string.
Kies nooit een link naar een extern jobboard, sociale media of een pdf.`;

function companyNameFromTitle(title: string, domain: string): string {
  const cleaned = title.split(/[|–-]/)[0]?.trim();
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
  for (const url of candidates) {
    if (tried.has(url)) continue;
    tried.add(url);
    const page = await fetchPage(url, { allowJina: true });
    if (page.status >= 200 && page.status < 300 && isUsefulText(page.text) && JOB_WORDS.test(page.text.slice(0, 3000))) {
      return { kind: "page", jobsUrl: url, text: page.text, links: page.links, companyName, how: "standard-path" };
    }
  }

  // c. Haiku kiest uit de homepage-links
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
