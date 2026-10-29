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

Beoordeel de werkelijke inhoud van de functie, niet de titel: kandidaten passen ook bij functies met een andere naam
(zie verwante functies in het profiel). Weeg overdraagbare vaardigheden, relevante ervaring, het vereiste niveau,
realistische doorgroei, sectorervaring en harde vereisten uit de vacature. Geen oppervlakkige keywordmatching.
Ontbrekend bewijs voor een vereiste vaardigheid is GEEN aanwezige ervaring: dan geen punten en noem het als risico.

Vul ook in:
- contract: vast / tijdelijk / interim / freelance / onbekend, enkel op basis van wat in de vacature staat.
- distance_km: geschatte afstand in km tussen de regio van de kandidaat en de werkplek (gebruik je kennis van
  Belgische gemeenten); -1 enkel als de werkplek echt niet te bepalen is. "Vlaanderen" of "België" als werkplek = -1.
- employer_status: "rechtstreeks" als de eindwerkgever zelf plaatst; "tussenpersoon" enkel als de vacature duidelijk
  van een bureau komt ("voor onze klant", uitzend-, selectie- of recruitmentkantoor); "onbekend" als je het niet weet.
  Onbekend is niet hetzelfde als tussenpersoon.
- contract: "onbekend" als de vacature er niets over zegt. Onbekend is niet hetzelfde als tijdelijk.
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
  employerStatus: "rechtstreeks" | "tussenpersoon" | "onbekend";
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
      verwante_functies: profile.related_titles ?? [],
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

/** Eenvoudige titelgelijkenis met het profiel (0-1), zonder AI. Voor aanvulling en rangschikking. */
export function titleSimilarity(profile: Profile, title: string): number {
  const words = (t: string) => t.toLowerCase().replace(/[^a-z0-9à-ÿ ]+/g, " ").split(/\s+/).filter((w) => w.length >= 4);
  const target = new Set([...profile.job_titles, ...(profile.related_titles ?? [])].flatMap(words));
  const w = words(title);
  if (!w.length || !target.size) return 0;
  // Ook deelwoorden: "procesoperator" ~ "operator".
  const hit = w.filter((x) => Array.from(target).some((t) => t.includes(x) || x.includes(t))).length;
  return hit / w.length;
}

export type PreselectInfo = { input: number; aiKept: number; filled: number; output: number; aiFailed: boolean };

/**
 * Voorselectie als er meer vacatures zijn dan we willen scoren. De AI mag ruim schrappen, maar:
 * - enkel id's uit de batch tellen (verzonnen of verkeerde id's worden genegeerd);
 * - laat de AI (bijna) niets over, dan vullen we aan op titelgelijkenis tot LIMITS.minPreselectKeep;
 * - faalt de AI, dan houden we de batch.
 */
export async function preselect(
  profile: Profile,
  jobsIn: Job[],
  names: Map<number, string>,
  meter: CostMeter,
  info?: PreselectInfo,
  ask: (batch: Job[]) => Promise<number[]> = async (batch) => {
    const user = `## Profiel\n${profileBlock(profile)}\n\n## Vacatures\n${batch.map((j) => describeJob(j, names.get(j.id) ?? "")).join("\n")}`;
    const r = await llmJson({ system: PRESELECT_SYSTEM, user, schema: PreselectSchema, meter, effort: "low", maxTokens: 1000 });
    return r.relevant_ids;
  },
): Promise<Job[]> {
  const rec = info ?? { input: 0, aiKept: 0, filled: 0, output: 0, aiFailed: false };
  rec.input = jobsIn.length;
  if (jobsIn.length <= LIMITS.maxJobsToScore) {
    rec.aiKept = rec.output = jobsIn.length;
    return jobsIn;
  }
  const keep = new Set<number>();
  const batchSize = 40;
  for (let i = 0; i < jobsIn.length; i += batchSize) {
    const batch = jobsIn.slice(i, i + batchSize);
    const valid = new Set(batch.map((j) => j.id));
    const ids = await ask(batch).catch(() => {
      rec.aiFailed = true;
      return batch.map((j) => j.id);
    });
    for (const id of ids) if (valid.has(Number(id))) keep.add(Number(id));
  }
  rec.aiKept = keep.size;
  const sim = new Map(jobsIn.map((j) => [j.id, titleSimilarity(profile, j.title)]));
  const rank = (a: Job, b: Job) => Number(b.source === "company_site") - Number(a.source === "company_site") || (sim.get(b.id) ?? 0) - (sim.get(a.id) ?? 0);
  const kept = jobsIn.filter((j) => keep.has(j.id)).sort(rank);
  const minKeep = Math.min(LIMITS.minPreselectKeep, jobsIn.length);
  if (kept.length < minKeep) {
    const extra = jobsIn.filter((j) => !keep.has(j.id)).sort((a, b) => (sim.get(b.id) ?? 0) - (sim.get(a.id) ?? 0)).slice(0, minKeep - kept.length);
    rec.filled = extra.length;
    kept.push(...extra);
  }
  const out = kept.slice(0, LIMITS.maxJobsToScore);
  rec.output = out.length;
  return out;
}

export type ScoreInfo = { requested: number; scored: number; missing: number; batches: number; failedBatches: number };

type ScoringOut = { intro: string; followups: string[]; scores: { id: number; kerntaken: number; vaardigheden: number; senioriteit: number; sector: number; mobiliteit: number; contract: ScoredJob["contract"]; distance_km: number; employer_status: ScoredJob["employerStatus"]; hard_blocker: string; argument: string; risk: string }[] };

/**
 * Eindscoring in kleine batches (parallel), zodat één te lang of afgekapt antwoord niet alles kost.
 * Vacatures waarvoor het model geen (geldige) score gaf, vragen we één keer opnieuw; blijven ze
 * ontbreken, dan tellen ze in de diagnose als 'niet gescoord' in plaats van stil te verdwijnen.
 */
export async function scoreJobs(
  profile: Profile,
  jobsIn: Job[],
  names: Map<number, string>,
  meter: CostMeter,
  info?: ScoreInfo,
  ask: (batch: Job[]) => Promise<ScoringOut> = (batch) => {
    const user = `## Profiel\n${profileBlock(profile)}\n\n## Vacatures\n${batch.map((j) => describeJob(j, names.get(j.id) ?? "")).join("\n")}`;
    return llmJson({ model: "scoring", system: SCORE_SYSTEM, user, schema: ScoringSchema, meter, effort: "medium", maxTokens: 6000 });
  },
): Promise<ScoreResult> {
  const rec = info ?? { requested: 0, scored: 0, missing: 0, batches: 0, failedBatches: 0 };
  rec.requested = jobsIn.length;
  if (jobsIn.length === 0) {
    return { scored: [], intro: "Ik vond geen vacatures die bij dit profiel passen. Pas de regio of functietitel aan en probeer opnieuw.", followups: ["Zoek in een grotere straal", "Zoek met een andere functietitel"] };
  }
  const byId = new Map(jobsIn.map((j) => [j.id, j]));
  const got = new Map<number, ScoringOut["scores"][number]>();
  let intro = "";
  let followups: string[] = [];
  let lastError: unknown = null;
  const runBatches = async (list: Job[]) => {
    const batches: Job[][] = [];
    for (let i = 0; i < list.length; i += LIMITS.scoreBatchSize) batches.push(list.slice(i, i + LIMITS.scoreBatchSize));
    rec.batches += batches.length;
    const outs = await Promise.all(
      batches.map((b) =>
        ask(b).catch((e: unknown) => {
          rec.failedBatches += 1;
          lastError = e;
          return null;
        }),
      ),
    );
    for (const [i, o] of outs.entries()) {
      if (!o) continue;
      const allowed = new Set(batches[i].map((j) => j.id));
      for (const s of o.scores) if (allowed.has(s.id) && !got.has(s.id)) got.set(s.id, s);
      if (!intro && o.intro) intro = o.intro;
      if (!followups.length && o.followups?.length) followups = o.followups;
    }
  };
  await runBatches(jobsIn);
  const missing = jobsIn.filter((j) => !got.has(j.id));
  if (missing.length) await runBatches(missing);
  rec.missing = jobsIn.filter((j) => !got.has(j.id)).length;
  // Faalde de AI volledig (key, tegoed, storing), dan is dat een echte fout en geen "geen matches".
  if (got.size === 0 && lastError) throw lastError;
  const r = { intro, followups, scores: Array.from(got.values()) };
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
      employerStatus: s.employer_status,
      hardBlocker: s.hard_blocker.trim(),
    });
  }
  rec.scored = scored.length;
  scored.sort((a, b) => b.score - a.score);
  return { scored, intro: r.intro.trim(), followups: r.followups.map((f) => f.trim()).filter(Boolean).slice(0, 4) };
}
