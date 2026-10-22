/**
 * Stap 1: cv-tekst + vrije tekst -> profiel (JSON) met zoekqueries.
 */
import { llmJson, type CostMeter } from "@/lib/llm";
import { ProfileSchema, type Profile } from "./types";

export type ProfileInput = { cvText: string; freeText: string; previousProfile?: Profile | null };

const SYSTEM = `Je bent een ervaren Vlaamse recruiter. Je leest een cv en een korte opdracht van een collega
en maakt daar een zoekprofiel van voor een vacaturezoektocht in België.

Regels:
- Functietitels: 3 tot 5 Nederlandstalige titels en synoniemen die werkgevers echt gebruiken (bv. "procesoperator", "productieoperator", "operator chemie").
- Regio: leid de woonplaats af uit het cv; de vrije tekst van de collega overschrijft het cv altijd.
- Straal: standaard 25 km, pas aan als het cv of de opdracht iets anders zegt.
- Uitsluitingen: wat de kandidaat of collega expliciet niet wil (ploegen, nachtwerk, interim, ...). Verzin er geen.
- Senioriteit: totaal aantal jaren relevante ervaring, afgerond.
- search_queries: 6 tot 8 concrete zoekqueries in het Nederlands zoals je ze op een jobboard zou intikken, elk met een functietitel en meestal een plaats of regio. Geen uitsluitingen in de query.
- Als de vrije tekst en het cv elkaar tegenspreken, volg de vrije tekst.
- Nooit velden verzinnen die niet uit cv of tekst volgen; gebruik dan een lege string of lege lijst.`;

export async function buildProfile(input: ProfileInput, meter: CostMeter): Promise<Profile> {
  const previous = input.previousProfile
    ? `\n\nEerder profiel in deze thread (behoud wat niet tegengesproken wordt):\n${JSON.stringify(input.previousProfile)}`
    : "";
  const user = `## Opdracht van de collega\n${input.freeText.trim() || "(geen extra tekst)"}\n\n## Cv\n${input.cvText.trim() || "(geen cv)"}${previous}`;
  const profile = await llmJson({ system: SYSTEM, user, schema: ProfileSchema, meter, effort: "low", maxTokens: 2048 });
  return normalizeProfile(profile);
}

export function normalizeProfile(p: Profile): Profile {
  const dedupe = (xs: string[]) => Array.from(new Set(xs.map((x) => x.trim()).filter(Boolean)));
  return {
    ...p,
    candidate_name: p.candidate_name.trim(),
    job_titles: dedupe(p.job_titles).slice(0, 6),
    skills: dedupe(p.skills).slice(0, 20),
    sectors: dedupe(p.sectors).slice(0, 6),
    exclusions: dedupe(p.exclusions).slice(0, 10),
    search_queries: dedupe(p.search_queries).slice(0, 8),
    region: p.region.trim() || "Vlaanderen",
    radius_km: Math.min(150, Math.max(5, Math.round(p.radius_km || 25))),
  };
}

/** Korte samenvatting voor de zijbalk: "Procesoperator · Mechelen". */
export function profileSummary(p: Profile | null | undefined): string {
  if (!p) return "";
  return [p.job_titles[0], p.region].filter(Boolean).join(" · ");
}
