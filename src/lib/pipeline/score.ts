/**
 * Stap 6: dedupliceren, voorselectie over alles, top-30 naar het lichte model
 * voor een score op 10 volgens de RecruitrLAB-verdeling, met argument en risico.
 */
import { llmJson, type CostMeter } from "@/lib/llm";
import { LIMITS } from "@/lib/config";
import type { Job } from "@/lib/db/schema";
import { PreselectSchema, ScoringSchema, type Profile } from "./types";

const PRESELECT_SYSTEM = `Je bent een recruiter. Je krijgt een kandidaatprofiel en een genummerde lijst vacatures
(titel, bedrijf, plaats, snippet). Geef de id's terug van de vacatures die plausibel passen bij de functietitels
en het ervaringsniveau. Regio is strikt: een plaats buiten de opgegeven straal is NIET relevant, ook niet bij twijfel.
Bij functie-inhoud mag je ruim zijn: twijfel = meenemen. Laat enkel weg wat duidelijk niet past
(andere functiefamilie, andere regio zonder verhuis, expliciete uitsluiting in de titel).
Laat ook vacatures weg die door een tussenpersoon geplaatst zijn (interimkantoor, recruitmentbureau,
consultancy- of detacheringsbedrijf dat "voor een klant" zoekt): we willen enkel rechtstreekse werkgevers.`;

const SCORE_SYSTEM = `Je bent een senior recruiter bij RecruitrLAB (Vlaanderen). Je krijgt een kandidaatprofiel en een
genummerde lijst vacatures. Scoor elke vacature zonder schijnzekerheid volgens deze verdeling (totaal 10):
- kerntaken 0-3: komen de kerntaken overeen met wat de kandidaat aantoonbaar deed?
- vaardigheden 0-3: vaardigheden, opleiding, talen, attesten.
- senioriteit 0-2: vereiste ervaring vs. die van de kandidaat.
- sector 0-1: zelfde sector of duidelijk overdraagbaar.
- mobiliteit 0-1: realistische pendel binnen de opgegeven straal. Buiten de straal = 0.
Bij een onbekende harde vereiste geef je geen automatische positieve punten.

Vul ook in:
- contract: vast / tijdelijk / interim / freelance / onbekend, enkel op basis van wat in de vacature staat.
- distance_km: geschatte afstand in km tussen de regio van de kandidaat en de werkplek (gebruik je kennis van
  Belgische gemeenten); -1 enkel als de werkplek echt niet te bepalen is. "Vlaanderen" of "België" als werkplek = -1.
- employer_identifiable: false als de eindwerkgever niet bij naam bekend is (bureau, "voor onze klant", anoniem).
- hard_blocker: een bewezen harde eis (licentie, diploma, attest, taal) die de kandidaat aantoonbaar niet heeft; anders lege string.
- argument: één concreet matchargument; risk: één concreet risico. Kort, informeel (je/jij), geen "u".

Een search snippet is geen bewijs van een open vacature of van een vast contract: twijfel = "onbekend".

Geef ook:
- intro: één zin voor de recruiter over de vacatures die 6/10 of meer halen, niet over de rest
  (bv. "6 vacatures die echt passen, de beste twee in de chemie rond Willebroek").
- followups: 2 tot 4 korte vervolgvragen als klikbare pillen, bv. "Zoek verder in Limburg", "Laat ploegenwerk weg".`;

export type ScoredJob = {
  job: Job;
  /** 0-100 = score op 10 × 10, zodat de bestaande kolom en ondergrens werken. */
  score: number;
  reason: string;
  argument: string;
  risk: string;
  contract: "vast" | "tijdelijk" | "interim" | "freelance" | "onbekend";
  distanceKm: number;
  employerIdentifiable: boolean;
  hardBlocker: string;
};

export type ScoreResult = { scored: ScoredJob[]; intro: string; followups: string[] };

function describeJob(j: Job, companyName: string): string {
  const snippet = (j.descriptionText ?? "").replace(/\s+/g, " ").slice(0, 280);
  return `[${j.id}] ${j.title} — ${companyName || "onbekend bedrijf"} — ${j.location || "plaats onbekend"} — bron: ${j.source}\n   ${snippet}`;
}

function profileBlock(profile: Profile): string {
  return JSON.stringify(
    {
      functietitels: profile.job_titles,
      skills: profile.skills,
      jaren_ervaring: profile.years_experience,
      sectoren: profile.sectors,
      regio: profile.region,
      straal_km: profile.radius_km,
      uitsluitingen: profile.exclusions,
      type_werkgever: profile.employer_type,
      harde_kwalificaties: profile.hard_requirements ?? [],
    },
    null,
    1,
  );
}

export async function preselect(profile: Profile, jobsIn: Job[], names: Map<number, string>, meter: CostMeter): Promise<Job[]> {
  if (jobsIn.length <= LIMITS.maxJobsToScore) return jobsIn;
  const keep = new Set<number>();
  const batchSize = 40;
  for (let i = 0; i < jobsIn.length; i += batchSize) {
    const batch = jobsIn.slice(i, i + batchSize);
    const user = `## Profiel\n${profileBlock(profile)}\n\n## Vacatures\n${batch.map((j) => describeJob(j, names.get(j.id) ?? "")).join("\n")}`;
    const r = await llmJson({ system: PRESELECT_SYSTEM, user, schema: PreselectSchema, meter, effort: "low", maxTokens: 1000 }).catch(() => ({ relevant_ids: batch.map((j) => j.id) }));
    for (const id of r.relevant_ids) keep.add(id);
  }
  const kept = jobsIn.filter((j) => keep.has(j.id));
  // Bedrijfssites eerst, dan boards; zo gaat de interessantste top-30 naar de eindscoring.
  kept.sort((a, b) => Number(b.source === "company_site") - Number(a.source === "company_site"));
  return kept.slice(0, LIMITS.maxJobsToScore);
}

export async function scoreJobs(profile: Profile, jobsIn: Job[], names: Map<number, string>, meter: CostMeter): Promise<ScoreResult> {
  if (jobsIn.length === 0) {
    return { scored: [], intro: "Ik vond geen vacatures die bij dit profiel passen. Pas de regio of functietitel aan en probeer opnieuw.", followups: ["Zoek in een grotere straal", "Zoek met een andere functietitel"] };
  }
  const user = `## Profiel\n${profileBlock(profile)}\n\n## Vacatures\n${jobsIn.map((j) => describeJob(j, names.get(j.id) ?? "")).join("\n")}`;
  const r = await llmJson({ model: "scoring", system: SCORE_SYSTEM, user, schema: ScoringSchema, meter, effort: "medium", maxTokens: 6000 });
  const byId = new Map(jobsIn.map((j) => [j.id, j]));
  const scored: ScoredJob[] = [];
  for (const s of r.scores) {
    const job = byId.get(s.id);
    if (!job) continue;
    const total = s.kerntaken + s.vaardigheden + s.senioriteit + s.sector + s.mobiliteit;
    scored.push({
      job,
      score: Math.max(0, Math.min(10, total)) * 10,
      reason: s.argument.trim(),
      argument: s.argument.trim(),
      risk: s.risk.trim(),
      contract: s.contract,
      distanceKm: s.distance_km,
      employerIdentifiable: s.employer_identifiable,
      hardBlocker: s.hard_blocker.trim(),
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return { scored, intro: r.intro.trim(), followups: r.followups.map((f) => f.trim()).filter(Boolean).slice(0, 4) };
}
