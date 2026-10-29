/**
 * Stap 6: dedupliceren, Haiku-voorselectie over alles, top-30 naar Sonnet
 * voor score 0-100 + één zin reden. +5 voor company_site.
 */
import { llmJson, type CostMeter } from "@/lib/llm";
import { COMPANY_SITE_BONUS, LIMITS } from "@/lib/config";
import type { Job } from "@/lib/db/schema";
import { PreselectSchema, ScoringSchema, type Profile } from "./types";

const PRESELECT_SYSTEM = `Je bent een recruiter. Je krijgt een kandidaatprofiel en een genummerde lijst vacatures
(titel, bedrijf, plaats, snippet). Geef de id's terug van de vacatures die plausibel passen bij de functietitels
en het ervaringsniveau. Regio is strikt: een plaats buiten de opgegeven straal is NIET relevant, ook niet bij twijfel.
Bij functie-inhoud mag je ruim zijn: twijfel = meenemen. Laat enkel weg wat duidelijk niet past
(andere functiefamilie, andere regio zonder verhuis, expliciete uitsluiting in de titel).
Laat ook vacatures weg die door een tussenpersoon geplaatst zijn (interimkantoor, recruitmentbureau,
consultancy- of detacheringsbedrijf dat "voor een klant" zoekt): we willen enkel rechtstreekse werkgevers.`;

const SCORE_SYSTEM = `Je bent een senior recruiter bij een Vlaams recruitmentbureau. Je krijgt een kandidaatprofiel en een
genummerde lijst vacatures. Geef per vacature een score van 0 tot 100 en één zin in het Nederlands waarom dit
past of niet. Beoordeel op: functie-inhoud, vereiste ervaring vs. senioriteit, regio en straal, uitsluitingen,
type werkgever. Regio is hard: buiten de straal = score maximaal 15, en zeg dat in de reden. Een vacature van een tussenpersoon (interim, recruitmentbureau, consultancy "voor een klant") scoort
maximaal 20 en de reden vermeldt dat. Vacatures die rechtstreeks van de bedrijfssite komen zijn vaak actueler; dat is al in een bonus verrekend,
weeg dat niet opnieuw. Schrijf de reden informeel (je/jij), zonder "u", concreet en kort.

Geef ook:
- intro: één zin voor de collega, bv. "Ik vond 14 vacatures rond Mechelen; de beste drie zitten in de chemie."
- followups: 2 tot 4 korte vervolgvragen als klikbare pillen, bv. "Zoek verder in Limburg", "Laat ploegenwerk weg", "Waarom scoort X laag?".`;

export type ScoredJob = { job: Job; score: number; reason: string };

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
  // Bedrijfssites eerst, dan boards; zo gaat de interessantste top-30 naar Sonnet.
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
    const bonus = job.source === "company_site" ? COMPANY_SITE_BONUS : 0;
    scored.push({ job, score: Math.max(0, Math.min(100, s.score + bonus)), reason: s.reason.trim() });
  }
  scored.sort((a, b) => b.score - a.score);
  return { scored, intro: r.intro.trim(), followups: r.followups.map((f) => f.trim()).filter(Boolean).slice(0, 4) };
}
