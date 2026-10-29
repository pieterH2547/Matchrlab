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
- candidate_name: de volledige naam van de kandidaat, meestal bovenaan het cv of in de e-mail-/LinkedIn-regel
  (bv. jan.peeters@... = Jan Peeters). Enkel leeg laten als er echt nergens een naam staat.
- Regio: de woonplaats (gemeente) uit het cv; de vrije tekst van de collega overschrijft het cv altijd.
  Staat er nergens een gemeente, geef dan een LEGE string. Nooit "Vlaanderen" of "België" invullen.
- Straal: standaard 30 km, pas aan als het cv of de opdracht iets anders zegt. Leid geen woonplaats af zonder bewijs in het cv.
- Uitsluitingen: wat de kandidaat of collega expliciet niet wil (ploegen, nachtwerk, interim, ...). Verzin er geen.
- Senioriteit: totaal aantal jaren relevante ervaring, afgerond.
- search_queries: 6 tot 8 concrete zoekqueries in het Nederlands zoals je ze op een jobboard zou intikken, elk met een functietitel en meestal een plaats of regio. Geen uitsluitingen in de query.
- Als de vrije tekst en het cv elkaar tegenspreken, volg de vrije tekst.
- Nooit velden verzinnen die niet uit cv of tekst volgen; gebruik dan een lege string of lege lijst.
- positioning: max 3 korte regels in natuurlijk Vlaams: (1) doelrol + senioriteit, (2) max 3 bewezen sterktes, (3) sector/overdraagbaarheid + regio/pendel.
- uncertainties: de 2-3 belangrijkste onzekerheden, telkens beginnend met "AANNAME:" of "ONBEKEND:" (bv. contracttype, beschikbaarheid, loonverwachting, mobiliteit, talen).
- open_questions: max 3 beslissende open vragen aan de kandidaat, informeel (je/jij, nooit "u"). Geen batterij intakevragen.
- consent: "bevestigd" enkel als cv of opdracht expliciet zegt dat de kandidaat akkoord is met voorstelling bij werkgevers; anders "onbekend".
- hard_requirements: diploma's, licenties en attesten die de kandidaat aantoonbaar heeft (bv. VCA, rijbewijs C, bachelor chemie).
- job_titles: de primaire titels en hun synoniemen zoals werkgevers ze echt gebruiken.
- related_titles: verwante functies waarvoor de kandidaat realistisch in aanmerking komt op basis van overdraagbare
  vaardigheden, zonder sprong in niveau of vak (een junior boekhouder is geen controller). Max 5.
- title_variants: dezelfde functie in het Engels en Frans zoals Belgische werkgevers ze schrijven. Max 6.
- skill_keywords: 3 tot 6 kerntaken of vaardigheden waarop vacatures beschreven worden, kort (bv. "btw-aangiften", "PLC", "storingsdienst").
- company_types: 4 tot 8 soorten bedrijven (ook kleine KMO's) die dit profiel aanwerven, kort zoals je ze in Google Maps intikt
  ("boekhoudkantoor", "chemiebedrijf", "voedingsbedrijf", "installateur HVAC"). Nooit uitzendkantoren of recruitmentbureaus.
- nearby_municipalities: max 10 gemeenten binnen de straal rond de regio, de regio zelf eerst, dichtstbij eerst.
- region_lat / region_lng: coördinaten van de regio (gemeente) als je ze kent, anders 0.`;

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
    region: p.region.trim(),
    radius_km: Math.min(150, Math.max(5, Math.round(p.radius_km || 30))),
    positioning: (p.positioning ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 3),
    uncertainties: (p.uncertainties ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 3),
    open_questions: (p.open_questions ?? []).map((x) => x.trim()).filter(Boolean).slice(0, 3),
    consent: p.consent ?? "onbekend",
    hard_requirements: dedupe(p.hard_requirements ?? []).slice(0, 6),
    related_titles: dedupe(p.related_titles ?? []).filter((t) => !(p.job_titles ?? []).some((j) => j.toLowerCase() === t.toLowerCase())).slice(0, 5),
    company_types: dedupe(p.company_types ?? []).slice(0, 8),
    title_variants: dedupe(p.title_variants ?? []).slice(0, 6),
    skill_keywords: dedupe(p.skill_keywords ?? []).slice(0, 6),
    nearby_municipalities: dedupe(p.nearby_municipalities ?? []).slice(0, 10),
    region_lat: Number.isFinite(p.region_lat) ? p.region_lat : 0,
    region_lng: Number.isFinite(p.region_lng) ? p.region_lng : 0,
  };
}

/** Korte samenvatting voor de zijbalk: "Procesoperator · Mechelen". */
/** Is de regio te vaag om op te zoeken (leeg, een gewest of het land)? */
export function isVagueRegion(region: string | null | undefined): boolean {
  const r = (region ?? "").trim().toLowerCase();
  return !r || /^(vlaanderen|vlaams gewest|flanders|belgi[eë]|belgium|wallonie|walloni[eë]|brussels gewest|onbekend|n\.?v\.?t\.?)$/.test(r);
}

export function profileSummary(p: Profile | null | undefined): string {
  if (!p) return "";
  return [p.job_titles[0], p.region].filter(Boolean).join(" · ");
}
