/**
 * Universele Boolean X-ray-zoekmotor. Geen vaste sectorlijsten of zoekstrings: de AI leidt per cv een zoekplan af
 * (functies, synoniemen NL/FR/EN, aansluitende rollen, regio, kanalen). Eén lichte AI-call, die NIET op het kritieke
 * pad van Fast Search ligt; de zoekopdrachten zelf gaan via de bestaande zoekketen (Serper eerst).
 *
 * Elke zoekopdracht wordt deterministisch gecontroleerd: geen LinkedIn-profielen (enkel /jobs), regio aanwezig,
 * uitsluiting van bureaus, geen sites van tussenpersonen, lengte begrensd, geen dubbels.
 */
import { z } from "zod";
import { llmJson, type CostMeter } from "@/lib/llm";
import { isAgencyDomain } from "@/lib/blocklist";
import type { Profile } from "./types";

export const XrayPlanSchema = z.object({
  queries: z
    .array(
      z.object({
        query: z.string().describe("Boolean X-ray zoekopdracht voor Google: OR-groepen, aanhalingstekens, site:, -uitsluitingen"),
        intent: z.enum(["exact", "synoniem", "aansluitend", "lokaal", "meertalig", "verborgen"]),
        channel: z.enum(["linkedin", "indeed", "vdab", "ats", "bedrijf", "sector", "algemeen"]),
      }),
    )
    .max(14),
});
export type XrayItem = z.infer<typeof XrayPlanSchema>["queries"][number];
export type XrayQuery = { q: string; kind: "vdab" | "indeed" | "linkedin" | "ats" | "site"; intent: XrayItem["intent"] };

const SYSTEM = `Je bent een Belgische sourcing-specialist. Je maakt een zoekplan van Boolean X-ray-zoekopdrachten voor Google
waarmee een recruiter OPEN VACATURES vindt voor één kandidaat, in elke sector of elk beroep. Leid alles af uit het profiel;
er bestaan geen vaste lijsten.

Maak 10 tot 14 zoekopdrachten, gevarieerd over:
- intent: exact (huidige titel), synoniem (alternatieve titels zoals werkgevers ze schrijven), aansluitend (realistische
  verwante rol of volgende stap op basis van competenties, niet hoger dan haalbaar), lokaal (werkgevers in de regio en
  buurgemeenten), meertalig (Franse en Engelse titels), verborgen (vacatures buiten de grote jobboards: "werken bij",
  "vacatures", "join our team" op eigen sites).
- channel: linkedin (site:linkedin.com/jobs; NOOIT /in/ of profielen), indeed (site:be.indeed.com), vdab
  (site:vdab.be/vindeenjob/vacatures), ats (site:recruitee.com OR site:teamtailor.com OR site:jobs.lever.co OR
  site:boards.greenhouse.io OR site:jobtoolz.com OR site:jobs.smartrecruiters.com OR site:jobs.personio.com),
  bedrijf (eigen sites van werkgevers), sector (vacaturesites die specifiek zijn voor deze sector in België, enkel als je
  zeker bent dat ze bestaan), algemeen.
Regels: titels tussen aanhalingstekens in OR-groepen; altijd een plaats (regio of buurgemeente, eventueel met OR);
uitsluitingen zoals -interim -uitzend -stage waar zinvol; geen sites van uitzend- of selectiekantoren; max ±200 tekens.`;

export async function buildXrayPlan(profile: Profile, meter: CostMeter): Promise<XrayItem[]> {
  const user = `Profiel:\n${JSON.stringify(
    {
      functies: profile.job_titles,
      verwante_functies: profile.related_titles ?? [],
      synoniemen_en_fr: profile.title_variants ?? [],
      kerntaken: profile.skill_keywords ?? [],
      vaardigheden: profile.skills.slice(0, 12),
      jaren_ervaring: profile.years_experience,
      sectoren: profile.sectors,
      regio: profile.region,
      straal_km: profile.radius_km,
      buurgemeenten: (profile.nearby_municipalities ?? []).slice(0, 6),
      soorten_werkgevers: profile.company_types ?? [],
      uitsluitingen: profile.exclusions,
    },
    null,
    1,
  )}`;
  const r = await llmJson({ system: SYSTEM, user, schema: XrayPlanSchema, meter, effort: "low", maxTokens: 2500 });
  return r.queries;
}

const KIND: Record<XrayItem["channel"], XrayQuery["kind"]> = {
  linkedin: "linkedin",
  indeed: "indeed",
  vdab: "vdab",
  ats: "ats",
  bedrijf: "site",
  sector: "site",
  algemeen: "site",
};

/** Deterministische controle van het AI-zoekplan. Ongeldige of riskante zoekopdrachten vallen weg. */
export function normalizeXray(items: XrayItem[], profile: Profile): XrayQuery[] {
  const places = [profile.region, ...(profile.nearby_municipalities ?? [])].map((p) => p.toLowerCase()).filter(Boolean);
  const out: XrayQuery[] = [];
  const seen = new Set<string>();
  for (const it of items) {
    let q = it.query.replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
    if (!q || q.length < 8) continue;
    // Nooit LinkedIn-profielen of -personen zoeken; enkel vacatures.
    if (/linkedin\.com\/(in|pub|company)\b/i.test(q)) continue;
    if (it.channel === "linkedin" && !/site:linkedin\.com\/jobs/i.test(q)) q = `site:linkedin.com/jobs ${q.replace(/site:linkedin\.com\S*/gi, "").trim()}`;
    // Geen sites van tussenpersonen.
    const sites = Array.from(q.matchAll(/site:([^\s)]+)/gi)).map((m) => m[1]);
    if (sites.some((s) => isAgencyDomain(s))) continue;
    // Altijd een plaats.
    if (places.length && !places.some((p) => q.toLowerCase().includes(p))) q = `${q} ${profile.region}`;
    // Eigen sites en algemene zoekopdrachten: bureaus en jobboards uitsluiten (die komen via hun eigen kanaal).
    if ((it.channel === "bedrijf" || it.channel === "algemeen") && !/-interim/i.test(q)) q = `${q} -interim -uitzend`;
    if (q.length > 260) q = q.slice(0, 260).replace(/\s+\S*$/, "");
    const key = q.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ q, kind: KIND[it.channel], intent: it.intent });
  }
  return out;
}

/**
 * Adaptief: intenties die in een eerdere ronde vacatures opleverden eerst, dan de nog niet geprobeerde,
 * en wat niets opleverde achteraan. Zo slimmer verder zoeken zonder extra AI-calls.
 */
export function orderByYield(queries: XrayQuery[], yieldByIntent: Record<string, number>, budget: number): XrayQuery[] {
  const score = (q: XrayQuery) => {
    const y = yieldByIntent[q.intent];
    return y === undefined ? 1 : y > 0 ? 2 + Math.min(y, 10) / 10 : 0;
  };
  return queries
    .map((q, i) => ({ q, i, s: score(q) }))
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .slice(0, budget)
    .map((x) => x.q);
}
