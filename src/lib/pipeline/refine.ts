/**
 * Zoekvelden aanpassen in gewone taal ("ook in Gent, max 40 km, geen ploegenwerk, voeg teamleider toe").
 * Eén lichte AI-call zet de opdracht om naar nieuwe veldwaarden; daarna controleren we alles deterministisch.
 * De velden blijven daarna gewoon met de hand aanpasbaar; de zoektocht start pas na "Start zoektocht".
 */
import { z } from "zod";
import { llmJson, type CostMeter } from "@/lib/llm";

export type SearchFieldValues = {
  job_titles: string[];
  related_titles: string[];
  title_variants: string[];
  region: string;
  radius_km: number;
  years_experience: number;
  skills: string[];
  skill_keywords: string[];
  sectors: string[];
  company_types: string[];
  exclusions: string[];
};

export const LIMITS: Record<Exclude<keyof SearchFieldValues, "region" | "radius_km" | "years_experience">, number> = {
  job_titles: 6,
  related_titles: 5,
  title_variants: 6,
  skills: 20,
  skill_keywords: 6,
  sectors: 6,
  company_types: 8,
  exclusions: 10,
};

const RefineSchema = z.object({
  job_titles: z.array(z.string()).describe("Functietitels waarop gezocht wordt"),
  related_titles: z.array(z.string()),
  title_variants: z.array(z.string()).describe("Dezelfde functie in het Engels en Frans"),
  region: z.string().describe("Eén Belgische gemeente als middelpunt"),
  radius_km: z.number(),
  years_experience: z.number(),
  skills: z.array(z.string()),
  skill_keywords: z.array(z.string()),
  sectors: z.array(z.string()),
  company_types: z.array(z.string()).describe("Soorten werkgevers zoals je ze in Google Maps intikt"),
  exclusions: z.array(z.string()).describe("Wat de kandidaat niet wil (bv. 'ploegenwerk', 'interim')"),
  changes: z.array(z.string()).max(6).describe("Kort per aanpassing wat je veranderde, in het Nederlands"),
  not_understood: z.string().describe("Wat je niet kon omzetten naar een zoekveld, of lege string"),
});

const SYSTEM = `Je past de zoekvelden van een vacaturezoektocht in België aan volgens de opdracht van een recruiter.
Je krijgt de huidige velden en een opdracht in gewone taal (vaak kort, met tikfouten of spreektaal).
Regels:
- Verander ENKEL wat de opdracht vraagt; alle andere velden geef je ongewijzigd terug.
- "ook", "erbij", "voeg toe" = toevoegen; "niet", "zonder", "geen" = verwijderen of als uitsluiting toevoegen;
  "enkel", "alleen", "in plaats van" = vervangen.
- Een nieuwe functietitel: zet hem in job_titles en voeg de Engelse/Franse vorm toe aan title_variants.
- Een plaats als middelpunt ("in Gent", "rond Hasselt") vervangt region; "ook in X" binnen pendelafstand mag de straal
  vergroten zodat X erin valt. Afstanden in km of minuten (30 min ≈ 25 km) zet je om naar radius_km (5-150).
- Wensen zoals "geen ploegenwerk", "geen interim", "niet in de haven" horen in exclusions.
- Senioriteit ("medior", "5 jaar") gaat naar years_experience.
- Verzin geen vaardigheden of sectoren die de opdracht niet noemt.
- Schrijf in changes per aanpassing één korte regel ("Gent toegevoegd als regio", "straal 25 → 40 km").`;

export async function refineFields(current: SearchFieldValues, instruction: string, meter: CostMeter) {
  const user = `Huidige velden:\n${JSON.stringify(current, null, 1)}\n\nOpdracht van de recruiter:\n${instruction.slice(0, 600)}`;
  const r = await llmJson({ system: SYSTEM, user, schema: RefineSchema, meter, effort: "low", maxTokens: 1500 });
  const { changes, not_understood, ...fields } = r;
  return { fields: sanitizeFields(fields, current), changes: changes.map((c) => c.slice(0, 120)), notUnderstood: not_understood.trim() };
}

/** Deterministische controle: lengtes, dubbels, grenzen. Lege of ongeldige waarden vallen terug op de huidige. */
export function sanitizeFields(next: Partial<SearchFieldValues>, current: SearchFieldValues): SearchFieldValues {
  const out = { ...current };
  for (const [k, max] of Object.entries(LIMITS) as [keyof typeof LIMITS, number][]) {
    const v = next[k];
    if (!Array.isArray(v)) continue;
    const seen = new Set<string>();
    const clean = v
      .map((x) => String(x).replace(/\s+/g, " ").trim().slice(0, 80))
      .filter((x) => x && !seen.has(x.toLowerCase()) && seen.add(x.toLowerCase()))
      .slice(0, max);
    // Functietitels nooit leeg maken: zonder titel kan er niet gezocht worden.
    if (k === "job_titles" && !clean.length) continue;
    out[k] = clean;
  }
  const region = typeof next.region === "string" ? next.region.trim().slice(0, 80) : "";
  if (region) out.region = region;
  if (Number.isFinite(next.radius_km)) out.radius_km = Math.min(150, Math.max(5, Math.round(Number(next.radius_km))));
  if (Number.isFinite(next.years_experience)) out.years_experience = Math.min(50, Math.max(0, Math.round(Number(next.years_experience))));
  return out;
}

/** Wat er effectief veranderde, als terugval wanneer het model geen changes meegeeft. */
export function diffFields(before: SearchFieldValues, after: SearchFieldValues): string[] {
  const out: string[] = [];
  for (const k of Object.keys(LIMITS) as (keyof typeof LIMITS)[]) {
    const b = new Set(before[k].map((x) => x.toLowerCase()));
    const a = new Set(after[k].map((x) => x.toLowerCase()));
    const added = after[k].filter((x) => !b.has(x.toLowerCase()));
    const removed = before[k].filter((x) => !a.has(x.toLowerCase()));
    if (added.length) out.push(`+ ${added.join(", ")}`);
    if (removed.length) out.push(`− ${removed.join(", ")}`);
  }
  if (before.region !== after.region) out.push(`regio ${before.region} → ${after.region}`);
  if (before.radius_km !== after.radius_km) out.push(`straal ${before.radius_km} → ${after.radius_km} km`);
  if (before.years_experience !== after.years_experience) out.push(`ervaring ${before.years_experience} → ${after.years_experience} jaar`);
  return out;
}
