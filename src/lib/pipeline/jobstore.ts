/**
 * Vacatures wegschrijven en dedupliceren. Alle bronnen komen hier langs.
 */
import { inArray, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Job } from "@/lib/db/schema";
import type { NormalizedJob, Profile } from "./types";
import { regionCenter, withinProfileRadius } from "@/lib/geo";
import { isIntermediaryCompany } from "@/lib/blocklist";

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of Array.from(u.searchParams.keys())) {
      if (/^(utm_|fbclid|gclid|ref$|source$)/i.test(k)) u.searchParams.delete(k);
    }
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith("/") && u.pathname !== "/") s = s.slice(0, -1);
    return s;
  } catch {
    return url.trim();
  }
}

/** Functietitel normaliseren: geslachtsvermelding, uren, contractvorm en leestekens weg. */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .replace(/\((m|h|v)\s*\/\s*(v|f)\s*(\/\s*(x|d))?\)|\b(m|h)\s*\/\s*(v|f)(\s*\/\s*(x|d))?\b/g, " ")
    .replace(/\b(voltijds?|deeltijds?|full[- ]?time|part[- ]?time|vast contract|onbepaalde duur|\d+\s*u(ren)?)\b/g, " ")
    .replace(/[^a-z0-9à-ÿ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Bedrijfsnaam normaliseren: rechtsvormen en algemene woorden weg. */
export function normalizeCompany(s: string | null | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .replace(/&#?\w+;/g, " ")
    .replace(/\b(nv|bv|bvba|sa|srl|sprl|cvba|cv|vzw|asbl|ltd|gmbh|group|groep|belgium|belgi[eë]|benelux)\b/g, " ")
    .replace(/[^a-z0-9à-ÿ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function titleKey(title: string, company?: string | null): string {
  return `${normalizeTitle(title)}|${normalizeCompany(company)}`;
}

/**
 * Bronvoorrang bij dubbels: de oorspronkelijke pagina van de eindwerkgever wint,
 * dan publieke ATS-pagina's, dan Google Jobs, VDAB, Jooble, Adzuna en losse webresultaten.
 */
export function sourcePriority(j: { source?: string; raw?: unknown }): number {
  const via = ((j.raw ?? {}) as { via?: string }).via;
  if (j.source === "company_site") return 0;
  if (j.source === "web" && via === "ats") return 1;
  return { google_jobs: 2, vdab: 3, jooble: 4, adzuna: 5, web: 6, openai_web: 6, brave: 7 }[j.source ?? ""] ?? 8;
}

/**
 * Eén vacature per (genormaliseerde) url, ATS-id, titel+werkgever, of titel+plaats als de werkgever ontbreekt.
 * Deterministisch, zonder AI; bij dubbels wint de bron met de hoogste voorrang.
 */
export function dedupeJobs<T extends { url: string; title: string; companyName?: string; source?: string; externalId?: string | null; location?: string | null; raw?: unknown }>(
  jobsIn: T[],
): T[] {
  const ordered = jobsIn.map((j, i) => ({ j, i })).sort((a, b) => sourcePriority(a.j) - sourcePriority(b.j) || a.i - b.i);
  const seen = new Set<string>();
  const out: T[] = [];
  for (const { j } of ordered) {
    const u = normalizeUrl(j.url);
    const keys = [`u:${u}`];
    if (j.externalId) keys.push(`x:${j.source}:${j.externalId}`);
    const company = normalizeCompany(j.companyName);
    const title = normalizeTitle(j.title);
    if (company) keys.push(`t:${title}|${company}`);
    else if (j.location) keys.push(`l:${title}|${(j.location ?? "").toLowerCase().trim()}`);
    if (keys.some((k) => seen.has(k))) continue;
    keys.forEach((k) => seen.add(k));
    out.push({ ...j, url: u });
  }
  return out;
}

export type PrefilterReasons = { regio: number; tussenpersoon: number; uitsluiting: number };

/** Zoals prefilterJobs, maar telt per reden hoeveel vacatures wegvallen (voor de diagnose). */
export function prefilterWithReasons<
  T extends { title: string; location?: string | null; descriptionText?: string | null; companyName?: string | null; url?: string | null; source?: string },
>(jobsIn: T[], profile: Profile): { kept: T[]; dropped: PrefilterReasons } {
  const dropped: PrefilterReasons = { regio: 0, tussenpersoon: 0, uitsluiting: 0 };
  const kept: T[] = [];
  for (const j of jobsIn) {
    const reason = prefilterReason(j, profile);
    if (reason) dropped[reason] += 1;
    else kept.push(j);
  }
  return { kept, dropped };
}

/** Filter op regio en uitsluitingen, vóór enige LLM-call. */
export function prefilterJobs<
  T extends { title: string; location?: string | null; descriptionText?: string | null; companyName?: string | null; url?: string | null; source?: string },
>(jobsIn: T[], profile: Profile): T[] {
  return prefilterWithReasons(jobsIn, profile).kept;
}

/** Waarom valt deze vacature weg vóór de AI? null = houden. Onbekend is niet hetzelfde als uitgesloten. */
export function prefilterReason(
  j: { title: string; location?: string | null; descriptionText?: string | null; companyName?: string | null; url?: string | null; source?: string },
  profile: Profile,
): keyof PrefilterReasons | null {
  // Enkel bevestigde tussenpersonen (naam of domein); een onbekende werkgever blijft.
  if (isIntermediaryCompany(j.companyName, j.url)) return "tussenpersoon";
  const verdict = withinProfileRadius(j.location, profile);
  if (verdict === false) return "regio";
  // Jobboards zonder bruikbare plaats (leeg of enkel 'België'/'Vlaanderen') vallen weg; een onbekende
  // gemeente houden we, de afstandsschatting bij de scoring beslist dan.
  const loc = (j.location ?? "").trim();
  const vague = !loc || /^(belgi[eë]|belgium|vlaanderen|flanders|wallonie|walloni[eë])$/i.test(loc);
  if (j.source !== "company_site" && regionCenter(profile) !== null && verdict === null && vague) return "regio";
  const exclusions = profile.exclusions.map((e) => e.toLowerCase()).filter((e) => e.length >= 3);
  const hay = `${j.title} ${j.descriptionText ?? ""}`.toLowerCase();
  // Enkel uitsluiten als de uitsluiting letterlijk in de titel staat.
  if (exclusions.some((e) => j.title.toLowerCase().includes(e) && hay.includes(e))) return "uitsluiting";
  return null;
}

/** Upsert op url; geeft de rijen (met id) terug in dezelfde volgorde. */
export async function upsertJobs(jobsIn: NormalizedJob[]): Promise<Job[]> {
  if (jobsIn.length === 0) return [];
  const unique = dedupeJobs(jobsIn);
  const rows = unique.map((j) => ({
    companyId: j.companyId ?? null,
    source: j.source,
    externalId: j.externalId ?? null,
    url: j.url,
    title: j.title.slice(0, 300),
    location: (j.location ?? "").slice(0, 200) || null,
    descriptionText: (j.descriptionText ?? "").slice(0, 4000) || null,
    // Bedrijfsnaam altijd bewaren, ook als de bron eigen gegevens meegeeft (anders viel ze later weg).
    raw: { ...((j.raw as Record<string, unknown> | null) ?? {}), companyName: j.companyName ?? null } as unknown,
    lastSeenAt: new Date(),
  }));
  const inserted = await db()
    .insert(schema.jobs)
    .values(rows)
    .onConflictDoUpdate({
      target: schema.jobs.url,
      set: {
        lastSeenAt: new Date(),
        title: sql`excluded.title`,
        location: sql`coalesce(excluded.location, ${schema.jobs.location})`,
        descriptionText: sql`coalesce(excluded.description_text, ${schema.jobs.descriptionText})`,
        companyId: sql`coalesce(excluded.company_id, ${schema.jobs.companyId})`,
        // Anders blijft een oude rij zonder bedrijfsnaam staan en valt de vacature later weg.
        raw: sql`excluded.raw`,
      },
    })
    .returning();
  return inserted;
}

export async function loadJobs(ids: number[]): Promise<Job[]> {
  if (ids.length === 0) return [];
  return db().select().from(schema.jobs).where(inArray(schema.jobs.id, ids));
}

export async function jobsForCompany(companyId: number): Promise<Job[]> {
  return db().select().from(schema.jobs).where(eq(schema.jobs.companyId, companyId));
}
