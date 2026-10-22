/**
 * Stap 3: bedrijfsontdekking. Haiku bedenkt zoekopdrachten, Brave zoekt,
 * resultaten worden unieke bedrijfsdomeinen (max 80), zonder jobboards e.d.
 */
import { llmJson, type CostMeter } from "@/lib/llm";
import { braveSearch, braveAvailable } from "@/lib/brave";
import { isBlockedDomain, registrableDomain } from "@/lib/blocklist";
import { LIMITS } from "@/lib/config";
import { DiscoveryQueriesSchema, type Profile } from "./types";

const SYSTEM = `Je helpt een recruiter bedrijven te vinden die een bepaald profiel zouden kunnen aanwerven.
Bedenk zoekopdrachten voor een webzoekmachine die lijsten of websites van concrete werkgevers opleveren,
niet van jobboards of interimkantoren.

Goede voorbeelden: "maakbedrijven ploegenwerk regio Mechelen", "chemiebedrijf Willebroek productie",
"verzekeringsmakelaar Oost-Vlaanderen 20-200 medewerkers", "voedingsbedrijf Puurs vacatures productie".
Slechte voorbeelden: "vacature procesoperator" (geeft jobboards), "jobs Mechelen".

Regels: 5 tot 8 queries, in het Nederlands, elk met een regio of plaats uit of rond de opgegeven regio,
gevarieerd in sector en deelgemeenten. Geen namen van jobboards of interimkantoren in de query.`;

export type DiscoveryResult = {
  domains: string[];
  queries: string[];
  braveQueries: number;
  note?: string;
};

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
  if (!braveAvailable()) {
    return { domains: [], queries: [], braveQueries: 0, note: "Brave Search niet geconfigureerd; bedrijfsontdekking overgeslagen." };
  }
  const queries = (await generateDiscoveryQueries(profile, meter)).slice(0, opts.maxQueries ?? 8);
  const urls: string[] = [];
  let braveQueries = 0;
  let limitHit = false;
  for (const q of queries) {
    const results = await braveSearch(q);
    if (results === null) {
      limitHit = true;
      break;
    }
    braveQueries += 1;
    for (const r of results) urls.push(r.url);
  }
  const domains = domainsFromResults(urls, opts.exclude);
  return { domains, queries, braveQueries, note: limitHit ? "Brave-maandlimiet bereikt; minder bedrijven ontdekt." : undefined };
}
