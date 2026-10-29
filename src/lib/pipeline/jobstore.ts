/**
 * Vacatures wegschrijven en dedupliceren. Alle bronnen komen hier langs.
 */
import { inArray, eq, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Job } from "@/lib/db/schema";
import type { NormalizedJob, Profile } from "./types";
import { strictlyWithinRadius, withinRadius } from "@/lib/geo";
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

export function titleKey(title: string, company?: string | null): string {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\(m\/v\/x\)|\(m\/f\/x\)|\(h\/f\/x\)|m\/v\/x|m\/f\/d/g, "")
      .replace(/[^a-z0-9à-ÿ]+/g, " ")
      .trim();
  return `${norm(title)}|${norm(company ?? "")}`;
}

/** Dedupliceer op URL en op (titel+bedrijf). Eerste wint. */
export function dedupeJobs<T extends { url: string; title: string; companyName?: string }>(jobsIn: T[]): T[] {
  const seenUrl = new Set<string>();
  const seenKey = new Set<string>();
  const out: T[] = [];
  for (const j of jobsIn) {
    const u = normalizeUrl(j.url);
    const k = titleKey(j.title, j.companyName);
    if (seenUrl.has(u) || seenKey.has(k)) continue;
    seenUrl.add(u);
    seenKey.add(k);
    out.push({ ...j, url: u });
  }
  return out;
}

/** Filter op regio en uitsluitingen, vóór enige LLM-call. */
export function prefilterJobs<T extends { title: string; location?: string | null; descriptionText?: string | null; companyName?: string | null; url?: string | null; source?: string }>(
  jobsIn: T[],
  profile: Profile,
): T[] {
  const exclusions = profile.exclusions.map((e) => e.toLowerCase()).filter((e) => e.length >= 3);
  return jobsIn.filter((j) => {
    // Tussenpersonen nooit: interim, recruitment, consultancy, detachering.
    if (isIntermediaryCompany(j.companyName, j.url)) return false;
    // Regio strikt: jobboards vermelden altijd een plaats; buiten de straal of onherkenbaar = weg.
    // Vacatures van bedrijfssites zonder plaats houden we (het bedrijf is al op regio gevonden).
    const strict = j.source !== "company_site";
    const inRegion = strict ? strictlyWithinRadius(j.location, profile.region, profile.radius_km) : withinRadius(j.location, profile.region, profile.radius_km) !== false;
    if (!inRegion) return false;
    const hay = `${j.title} ${j.descriptionText ?? ""}`.toLowerCase();
    // Enkel uitsluiten als de uitsluiting letterlijk in de titel staat; beschrijvingen
    // vermelden ploegen vaak als optie, dat oordeel laten we aan de scoring.
    return !exclusions.some((e) => j.title.toLowerCase().includes(e) && hay.includes(e));
  });
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
    raw: (j.raw ?? { companyName: j.companyName ?? null }) as unknown,
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
