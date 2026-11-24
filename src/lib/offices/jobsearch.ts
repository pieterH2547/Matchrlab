/**
 * Kantorenkaart, vacaturezoektocht: bank- en verzekeringsvacatures via de bekende API's (Adzuna, Jooble,
 * Google Jobs via SerpApi) en de zoekketen (Google/LinkedIn/Indeed/VDAB-zoekresultaten), per regio, met vaste
 * sectortitels. Gevonden vacatures gaan in de gewone `jobs`-tabel (gemarkeerd met raw.sweep = sector) en worden
 * daarna aan kantoren gekoppeld op werkgeversnaam of merk + gemeente/postcode.
 */
import { and, gt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Job } from "@/lib/db/schema";
import { searchAdzuna, searchGoogleJobs, searchJooble, searchTargetedWeb } from "@/lib/pipeline/jobboards";
import { upsertJobs } from "@/lib/pipeline/jobstore";
import type { NormalizedJob, Profile } from "@/lib/pipeline/types";
import { extractPostcode, findPlaceName, municipalitiesWithin, strictlyWithinRadius, type GeoPoint } from "@/lib/geo";
import { nameTokens, type OfficeSector } from "./classify";

/** Functietitels waarop werkgevers in de sector aanwerven; in groepjes van drie (zoveel titels bevraagt elke bron per keer). */
export const SECTOR_TITLES: Record<OfficeSector, string[]> = {
  bank: ["bankbediende", "kredietadviseur", "relatiebeheerder bank", "commercieel adviseur bank", "financieel adviseur", "zelfstandig bankagent", "private banker", "kantoordirecteur bank", "medewerker bankkantoor"],
  verzekeringen: ["verzekeringsadviseur", "schadebeheerder", "dossierbeheerder verzekeringen", "commercieel medewerker verzekeringen", "accountmanager verzekeringen", "underwriter", "verzekeringsmakelaar", "klantenadviseur verzekeringen", "productiebeheerder verzekeringen"],
};

/** Synthetisch profiel voor de jobboard-functies: enkel wat ze lezen (titels, regio, straal, uitsluitingen). */
export function sectorProfile(sector: OfficeSector, titles: string[], region: string, radiusKm: number, center: GeoPoint): Profile {
  return {
    candidate_name: "",
    job_titles: titles,
    skills: [],
    years_experience: 0,
    sectors: [sector === "bank" ? "bank" : "verzekeringen"],
    region,
    radius_km: Math.max(5, Math.min(150, radiusKm)),
    exclusions: ["interim", "freelance"],
    employer_type: sector === "bank" ? "bankkantoor" : "verzekeringskantoor",
    search_queries: titles,
    positioning: [],
    uncertainties: [],
    open_questions: [],
    consent: "onbekend",
    hard_requirements: [],
    related_titles: [],
    title_variants: [],
    skill_keywords: [],
    company_types: [sector === "bank" ? "bankkantoor" : "verzekeringskantoor"],
    nearby_municipalities: municipalitiesWithin(center, radiusKm, 8).map((m) => m.name),
    region_lat: center.lat,
    region_lng: center.lon,
  };
}

export type SweepResult = {
  region: string;
  sectors: OfficeSector[];
  perSource: Record<string, { queries: number; raw: number; kept: number; error?: string; skipped?: string }>;
  found: number;
  inRegion: number;
  stored: number;
};

/**
 * Eén regio afzoeken: per sector en per groepje van drie titels elke bron. `useGoogleJobs` (SerpApi, beperkt gratis)
 * staat standaard uit. Vacatures buiten de straal (volgens hun locatietekst) vallen weg.
 */
export async function sweepJobs(center: GeoPoint, region: string, radiusKm: number, sectors: OfficeSector[], opts: { useGoogleJobs?: boolean; webBudget?: number } = {}): Promise<SweepResult> {
  const perSource: SweepResult["perSource"] = {};
  const add = (key: string, r: { queries: number; raw: number; jobs: NormalizedJob[]; error?: string; skipped?: string }) => {
    const cur = (perSource[key] ??= { queries: 0, raw: 0, kept: 0 });
    cur.queries += r.queries;
    cur.raw += r.raw;
    cur.kept += r.jobs.length;
    if (r.error) cur.error = r.error;
    if (r.skipped) cur.skipped = r.skipped;
  };
  const all: NormalizedJob[] = [];
  for (const sector of sectors) {
    const titles = SECTOR_TITLES[sector];
    for (let i = 0; i < titles.length; i += 3) {
      const profile = sectorProfile(sector, titles.slice(i, i + 3), region, radiusKm, center);
      const tasks: Promise<void>[] = [
        searchAdzuna(profile).then((r) => {
          add("adzuna", r);
          all.push(...tag(r.jobs, sector));
        }),
        searchJooble(profile).then((r) => {
          add("jooble", r);
          all.push(...tag(r.jobs, sector));
        }),
      ];
      // Zoekketen (Google/LinkedIn/Indeed/VDAB-resultaten): enkel voor het eerste groepje titels, budget beperkt.
      if (i === 0 && (opts.webBudget ?? 6) > 0)
        tasks.push(
          searchTargetedWeb(profile, { budget: opts.webBudget ?? 6 }).then((r) => {
            add("web", r);
            all.push(...tag(r.jobs, sector));
          }),
        );
      if (opts.useGoogleJobs && i === 0)
        tasks.push(
          searchGoogleJobs(profile).then((r) => {
            add("google_jobs", r);
            all.push(...tag(r.jobs, sector));
          }),
        );
      await Promise.all(tasks.map((t) => t.catch(() => undefined)));
    }
  }
  // Enkel binnen de straal (locatietekst beslisbaar) en geen interim/uitzend.
  const inRegion = all.filter((j) => !/interim|uitzend|freelance|tijdelijk/i.test(`${j.title} ${j.descriptionText ?? ""}`.slice(0, 400)) && (strictlyWithinRadius(j.location, region, radiusKm) || isSameRegionText(j.location, region)));
  const stored = inRegion.length ? await upsertJobs(inRegion) : [];
  return { region, sectors, perSource, found: all.length, inRegion: inRegion.length, stored: stored.length };
}

function isSameRegionText(location: string | null | undefined, region: string): boolean {
  return Boolean(location && location.toLowerCase().includes(region.toLowerCase()));
}

function tag(jobs: NormalizedJob[], sector: OfficeSector): NormalizedJob[] {
  return jobs.map((j) => ({ ...j, raw: { ...((j.raw ?? {}) as Record<string, unknown>), sweep: sector, sweptAt: new Date().toISOString() } }));
}

export type OfficeJob = { title: string; url: string; source: string; company: string | null; location: string | null; email: string | null };

/** Vacatures uit de zoektocht van de laatste `days` dagen. */
export async function recentSweepJobs(days = 30): Promise<Job[]> {
  const since = new Date(Date.now() - days * 86400_000);
  return db()
    .select()
    .from(schema.jobs)
    .where(and(gt(schema.jobs.lastSeenAt, since), sql`${schema.jobs.raw}->>'sweep' is not null`, sql`coalesce(${schema.jobs.verificationStatus}, '') <> 'gesloten'`))
    .limit(5000);
}

const GENERIC = new Set(["bank", "verzekeringen", "verzekering", "insurance", "assurances", "kantoor", "group", "groep", "belgium", "belgie", "nv", "sa", "bv"]);

/**
 * Vacatures aan kantoren koppelen: werkgeversnaam ↔ merk of naam van het kantoor, én dezelfde gemeente of postcode
 * (uit de locatietekst). Een merkvacature in Mechelen hoort bij de KBC-kantoren in Mechelen, niet bij die in Gent.
 * Een vacature zonder herkenbare plaats blijft los.
 */
export function matchJobsToOffices<T extends { id: number; name: string; brand: string | null; postcode: string | null; municipality: string | null }>(
  offices: T[],
  jobs: Pick<Job, "id" | "title" | "url" | "source" | "location" | "raw" | "descriptionText">[],
): Map<number, OfficeJob[]> {
  const out = new Map<number, OfficeJob[]>();
  const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const officeKeys = offices.map((o) => ({
    o,
    brand: o.brand ? norm(o.brand) : null,
    tokens: nameTokens(o.name).filter((t) => !GENERIC.has(t)),
    muni: o.municipality ? norm(o.municipality) : null,
  }));
  for (const j of jobs) {
    const company = String(((j.raw ?? {}) as { companyName?: string }).companyName ?? "").trim();
    if (!company) continue;
    const c = norm(company);
    const cTokens = nameTokens(company).filter((t) => !GENERIC.has(t));
    const pc = extractPostcode(j.location);
    const place = findPlaceName(j.location);
    const muni = place ? norm(place) : null;
    if (!pc && !muni) continue;
    for (const k of officeKeys) {
      const samePlace = (pc && k.o.postcode === pc) || (muni && k.muni && (k.muni === muni || k.muni.startsWith(muni) || muni.startsWith(k.muni)));
      if (!samePlace) continue;
      const byBrand = k.brand && (c.includes(k.brand) || k.brand.includes(c));
      const byName = cTokens.length > 0 && k.tokens.length > 0 && cTokens.some((t) => k.tokens.includes(t));
      if (!byBrand && !byName) continue;
      const list = out.get(k.o.id) ?? [];
      if (list.length < 8) list.push({ title: j.title, url: j.url, source: j.source, company, location: j.location, email: (j.descriptionText ?? "").match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ?? null });
      out.set(k.o.id, list);
    }
  }
  return out;
}
