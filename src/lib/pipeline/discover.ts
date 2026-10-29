/**
 * Stap 3, spoor B: werkgevers ontdekken. Eerst Google Maps (soort bedrijf × gemeente, met vestiging
 * en coördinaten; buiten de straal = weg), dan aanvullende webzoekopdrachten. Geen tussenpersonen.
 */
import { llmJson, type CostMeter } from "@/lib/llm";
import { webSearch, searchAvailable, resolveProvider, placesSearch } from "@/lib/search";
import { getSetting } from "@/lib/settings";
import { isBlockedDomain, isIntermediaryCompany, registrableDomain } from "@/lib/blocklist";
import { distanceFromCenter, regionCenter } from "@/lib/geo";
import { LIMITS } from "@/lib/config";
import { DiscoveryQueriesSchema, type Profile } from "./types";

const SYSTEM = `Je helpt een recruiter bedrijven te vinden die een bepaald profiel zouden kunnen aanwerven.
Bedenk zoekopdrachten voor een webzoekmachine die lijsten of websites van concrete werkgevers opleveren,
niet van jobboards of interimkantoren.

Schrijf ze zo dat ze ook in Google Maps werken: een soort bedrijf + een gemeente, bv. "boekhoudkantoor Mechelen".
Goede voorbeelden: "maakbedrijven ploegenwerk regio Mechelen", "chemiebedrijf Willebroek productie",
"verzekeringsmakelaar Oost-Vlaanderen 20-200 medewerkers", "voedingsbedrijf Puurs vacatures productie".
Slechte voorbeelden: "vacature procesoperator" (geeft jobboards), "jobs Mechelen".

Regels: 5 tot 8 queries, in het Nederlands, elk met een plaats die BINNEN de opgegeven straal rond de regio ligt
(gebruik de regio zelf en buurgemeenten binnen die straal; nooit steden verder weg), gevarieerd in sector. Geen namen van jobboards of interimkantoren in de query.

Belangrijk: we zoeken uitsluitend EINDWERKGEVERS die mensen aanwerven voor hun eigen werking.
Nooit zoeken naar recruitmentbureaus, selectiekantoren, interim-, consultancy-, detacherings-,
outsourcing- of HR-dienstverleners — ook niet als het profiel zelf een recruiter of consultant is.
Voor zo'n profiel zoek je naar bedrijven met een eigen HR-afdeling of interne dienst
(bv. "productiebedrijf Mechelen 200 medewerkers HR-afdeling", "ziekenhuis Antwerpen interne dienst").`;

export type DiscoveredCompany = {
  domain: string;
  name?: string;
  address?: string;
  category?: string;
  lat?: number | null;
  lng?: number | null;
  distanceKm?: number | null;
  via: "maps" | "web";
};

export type DiscoveryResult = {
  domains: string[];
  companies: DiscoveredCompany[];
  queries: string[];
  braveQueries: number;
  outOfRadius: number;
  note?: string;
};

/** Google Maps-categorieën van tussenpersonen: nooit als werkgever meenemen. */
const AGENCY_CATEGORY = /(uitzend|interim|recruit|werving|selectie|headhunt|employment agency|staffing|personeelsdienst|outsourcing|consult)/i;

/**
 * Zoekopdrachten voor Google Maps: soort bedrijf × gemeente, de regio eerst.
 * Deterministisch (geen AI-call), begrensd op LIMITS.maxMapsQueries.
 */
export function mapsQueries(profile: Profile): string[] {
  const types = (profile.company_types ?? []).slice(0, 4);
  const places = [profile.region, ...(profile.nearby_municipalities ?? []).filter((m) => m.toLowerCase() !== profile.region.toLowerCase())].slice(0, 3);
  if (!types.length || !places[0]) return [];
  const combos: string[] = [];
  // Eerst elk type in de regio zelf, dan de buurgemeenten.
  for (const place of places) for (const t of types) combos.push(`${t} ${place}`);
  return Array.from(new Set(combos)).slice(0, LIMITS.maxMapsQueries);
}

export async function generateDiscoveryQueries(profile: Profile, meter: CostMeter): Promise<string[]> {
  const user = `Profiel:\n${JSON.stringify(
    {
      functietitels: profile.job_titles,
      sectoren: profile.sectors,
      regio: profile.region,
      straal_km: profile.radius_km,
      type_werkgever: profile.employer_type,
      skills: profile.skills.slice(0, 10),
    },
    null,
    1,
  )}`;
  const r = await llmJson({ system: SYSTEM, user, schema: DiscoveryQueriesSchema, meter, effort: "low", maxTokens: 800 });
  return r.queries.map((q) => q.trim()).filter(Boolean);
}

/** Domeinen uit zoekresultaten halen, met blocklist en limiet. */
export function domainsFromResults(urls: string[], exclude: Set<string> = new Set(), max: number = LIMITS.maxDomainsPerRun): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const url of urls) {
    const d = registrableDomain(url);
    if (!d || seen.has(d) || exclude.has(d)) continue;
    if (isBlockedDomain(url)) continue;
    // Enkel echte bedrijfssites: geen pdf's, geen diepe sociale links.
    if (/\.(pdf|docx?|xlsx?)$/i.test(url)) continue;
    seen.add(d);
    out.push(d);
    if (out.length >= max) break;
  }
  return out;
}

export async function discoverCompanies(profile: Profile, meter: CostMeter, opts: { exclude?: Set<string>; maxQueries?: number } = {}): Promise<DiscoveryResult> {
  const hasMaps = Boolean(await getSetting("SERPER_API_KEY"));
  const hasWeb = (await resolveProvider()) !== "geen";
  if (!searchAvailable() || (!hasMaps && !hasWeb)) {
    return { domains: [], companies: [], queries: [], braveQueries: 0, outOfRadius: 0, note: "Geen zoekmachine ingesteld; werkgevers ontdekken overgeslagen. Vul Serper in via Instellingen." };
  }
  const center = regionCenter(profile);
  const exclude = opts.exclude ?? new Set<string>();
  const found = new Map<string, DiscoveredCompany>();
  let braveQueries = 0;
  let outOfRadius = 0;

  // 1. Google Maps: lokale werkgevers met website en exacte vestiging.
  const mq = hasMaps ? mapsQueries(profile) : [];
  const placeHits = await Promise.all(mq.map((q) => placesSearch(q).catch(() => null)));
  braveQueries += placeHits.filter((h) => h !== null).length;
  for (const hits of placeHits) {
    for (const p of hits ?? []) {
      const d = registrableDomain(p.website);
      if (!d || exclude.has(d) || found.has(d) || isBlockedDomain(p.website)) continue;
      if (AGENCY_CATEGORY.test(p.category) || isIntermediaryCompany(p.name, p.website)) continue;
      const dist = p.lat !== null && p.lng !== null ? distanceFromCenter(center, { lat: p.lat, lon: p.lng }) : null;
      if (dist !== null && dist > profile.radius_km) {
        outOfRadius += 1;
        continue;
      }
      found.set(d, { domain: d, name: p.name, address: p.address, category: p.category, lat: p.lat, lng: p.lng, distanceKm: dist, via: "maps" });
    }
  }

  // 2. Webzoekopdrachten vullen aan (meer als er geen Maps is). De AI bedenkt ze.
  const webBudget = hasMaps ? Math.min(3, opts.maxQueries ?? 3) : opts.maxQueries ?? 8;
  const queries = hasWeb && webBudget > 0 ? (await generateDiscoveryQueries(profile, meter)).slice(0, webBudget) : [];
  let limitHit = false;
  const webResults = await Promise.all(queries.map((q) => webSearch(q)));
  for (const results of webResults) {
    if (results === null) {
      limitHit = true;
      continue;
    }
    braveQueries += 1;
    for (const d of domainsFromResults(results.map((r) => r.url), exclude)) {
      if (!found.has(d)) found.set(d, { domain: d, via: "web" });
    }
  }

  // Maps eerst (dichtstbij eerst), dan web; max LIMITS.maxDomainsPerRun.
  const companies = Array.from(found.values())
    .sort((a, b) => (a.via === b.via ? (a.distanceKm ?? 999) - (b.distanceKm ?? 999) : a.via === "maps" ? -1 : 1))
    .slice(0, LIMITS.maxDomainsPerRun);
  const provider = await resolveProvider();
  let note: string | undefined;
  if (limitHit) note = `Zoeklimiet van ${provider} bereikt; minder bedrijven ontdekt.`;
  else if (!hasMaps) note = "Zonder Serper geen Google Maps; enkel webzoekopdrachten.";
  return { domains: companies.map((c) => c.domain), companies, queries: [...mq, ...queries], braveQueries, outOfRadius, note };
}
