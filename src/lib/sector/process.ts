/**
 * Sectorbeheer, deel 2: registerinschrijvingen verrijken en in de bestaande motor stoppen.
 * - website zoeken via de bestaande zoekketen (Google Maps via Serper, dan webSearch);
 * - koppelen aan `companies` (sector, ondernemingsnummer, registerbron, importdatum);
 * - wachtrij: nieuwe werkgevers en periodieke hercontrole via de bestaande crawlDomain/upsertJobs.
 * Alles begrensd (aantal, gelijktijdigheid, time-outs) en zonder nieuwe providers.
 */
import { and, eq, inArray, isNull, lte, or, sql, desc, isNotNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { placesSearch, webSearch } from "@/lib/search";
import { BLOCKED_DOMAINS, registrableDomain, isAgencyDomain } from "@/lib/blocklist";
import { fetchPage } from "@/lib/fetch";
import { CostMeter } from "@/lib/llm";
import { crawlDomain } from "@/lib/pipeline/orchestrator";
import { geocode, distanceKm } from "@/lib/geo";
import { dedupeKey, dedupeRows, SECTORS, type RegistryRow } from "./registry";

const RECHECK_DAYS_OK = 7;
const RECHECK_DAYS_ERROR = 3;

/** Portalen en gidsen (geen eigen site van de werkgever). Enkel exacte domeinen, geen woordfragmenten:
 *  een makelaar met "consult" of "jobs" in zijn domeinnaam is gewoon een werkgever. */
const DIRECTORY = /(goudengids|pagesdor|goldenpages|infobel|cylex|trendstop|companyweb|bizzy|openthebox|kompass|europages|facebook|linkedin|instagram|google|yelp|fsma|kbo|staatsblad|wikipedia|mapcarta|1307|bestedeals|immoweb|assuralia|feprabel|bvvm|fvf)\./i;

export function isPortalDomain(domain: string): boolean {
  return BLOCKED_DOMAINS.has(domain) || DIRECTORY.test(`${domain}.`) || isAgencyDomain(domain);
}

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\b(nv|bv|bvba|sa|srl|sprl|cvba|vof|verzekeringen|verzekering|assurances|kantoor|makelaar|makelaars|insurance|groep|group|en|de|het|van|der)\b/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
}

/** Lijkt dit domein op de naam van de werkgever? (minstens één betekenisvol naamwoord in het domein) */
export function domainMatchesName(domain: string, name: string): boolean {
  const label = domain.split(".")[0].replace(/-/g, "");
  return nameTokens(name).some((t) => label.includes(t));
}

export type WebsiteGuess = { domain: string; confidence: "register" | "kbo" | "naam"; via: string } | null;

/**
 * Officiële website zoeken. Volgorde: website uit het register, Google Maps (naam + gemeente), webzoekopdracht.
 * Een kandidaat telt enkel als het domein op de naam lijkt of de homepage het ondernemingsnummer vermeldt.
 */
export async function findWebsite(row: Pick<RegistryRow, "name" | "municipality" | "website" | "enterpriseNumber">): Promise<WebsiteGuess> {
  if (row.website) {
    const d = registrableDomain(row.website);
    if (d && !isPortalDomain(d)) return { domain: d, confidence: "register", via: "register" };
  }
  const candidates: { domain: string; via: string }[] = [];
  const places = await placesSearch(`${row.name} ${row.municipality ?? ""}`.trim()).catch(() => null);
  for (const p of places ?? []) {
    const d = registrableDomain(p.website);
    if (d && !isPortalDomain(d) && nameTokens(p.name).some((t) => nameTokens(row.name).includes(t))) candidates.push({ domain: d, via: "google_maps" });
  }
  if (!candidates.length) {
    const results = await webSearch(`"${row.name}" ${row.municipality ?? ""}`.trim(), { count: 8 }).catch(() => null);
    for (const r of results ?? []) {
      const d = registrableDomain(r.url);
      if (d && !isPortalDomain(d)) candidates.push({ domain: d, via: "zoekmachine" });
    }
  }
  const unique = Array.from(new Map(candidates.map((c) => [c.domain, c])).values()).slice(0, 4);
  // Sterkste bewijs: ondernemingsnummer op de homepage (wettelijk verplicht op de site van een onderneming).
  if (row.enterpriseNumber) {
    const nr = row.enterpriseNumber;
    const pattern = new RegExp(`${nr.slice(0, 4)}[ .]?${nr.slice(4, 7)}[ .]?${nr.slice(7)}|${nr.slice(1, 4)}[ .]?${nr.slice(4, 7)}[ .]?${nr.slice(7)}`);
    for (const c of unique) {
      const page = await fetchPage(`https://${c.domain}/`).catch(() => null);
      if (page && pattern.test(page.text)) return { domain: c.domain, confidence: "kbo", via: c.via };
    }
  }
  const byName = unique.find((c) => domainMatchesName(c.domain, row.name));
  return byName ? { domain: byName.domain, confidence: "naam", via: byName.via } : null;
}

/** Registerrijen opslaan, ontdubbeld op ondernemingsnummer (of naam + gemeente). Bestaande rijen worden bijgewerkt. */
export async function importRows(sector: string, rows: RegistryRow[], source: string): Promise<{ received: number; unique: number; inserted: number; updated: number }> {
  const unique = dedupeRows(sector, rows);
  if (!unique.length) return { received: rows.length, unique: 0, inserted: 0, updated: 0 };
  const keys = unique.map((r) => dedupeKey(sector, r));
  const existing = new Set(
    (await db().select({ k: schema.registryEntries.dedupeKey }).from(schema.registryEntries).where(inArray(schema.registryEntries.dedupeKey, keys))).map((r) => r.k),
  );
  const now = new Date();
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    await db()
      .insert(schema.registryEntries)
      .values(
        chunk.map((r) => ({
          sector,
          dedupeKey: dedupeKey(sector, r),
          enterpriseNumber: r.enterpriseNumber,
          name: r.name.slice(0, 200),
          address: r.address?.slice(0, 300) ?? null,
          postcode: r.postcode,
          municipality: r.municipality?.slice(0, 100) ?? null,
          website: r.website?.slice(0, 300) ?? null,
          source,
          importedAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: schema.registryEntries.dedupeKey,
        set: {
          name: sql`excluded.name`,
          address: sql`coalesce(excluded.address, ${schema.registryEntries.address})`,
          postcode: sql`coalesce(excluded.postcode, ${schema.registryEntries.postcode})`,
          municipality: sql`coalesce(excluded.municipality, ${schema.registryEntries.municipality})`,
          website: sql`coalesce(excluded.website, ${schema.registryEntries.website})`,
          importedAt: now,
        },
      });
  }
  const inserted = keys.filter((k) => !existing.has(k)).length;
  return { received: rows.length, unique: unique.length, inserted, updated: unique.length - inserted };
}

/**
 * Proefimport zonder registerbestand: werkgevers van een sector in een regio via de bestaande Google Maps-zoeker.
 * Bron = "google_maps" (geen FSMA-bewijs, geen ondernemingsnummer), zodat dat in het overzicht zichtbaar blijft.
 */
export async function seedFromMaps(sector: string, region: string, radiusKm: number, limit: number): Promise<{ rows: number; queries: number }> {
  const cfg = SECTORS[sector];
  if (!cfg) throw new Error("Onbekende sector.");
  const center = geocode(region);
  const nearby = ["", "Berchem", "Deurne", "Merksem", "Wilrijk", "Mortsel", "Edegem", "Kontich", "Schoten", "Brasschaat"];
  const queries = cfg.mapsQueries.flatMap((q) => nearby.slice(0, 4).map((n) => `${q} ${n || region}`)).slice(0, 10);
  const rows: RegistryRow[] = [];
  const seen = new Set<string>();
  for (const q of queries) {
    if (rows.length >= limit) break;
    const places = await placesSearch(q).catch(() => null);
    for (const p of places ?? []) {
      const d = registrableDomain(p.website);
      if (!d || seen.has(d) || isPortalDomain(d)) continue;
      if (center && p.lat !== null && p.lng !== null && distanceKm(center, { lat: p.lat, lon: p.lng }) > radiusKm) continue;
      seen.add(d);
      const muni = p.address.match(/\b\d{4}\s+([^,]+)/)?.[1]?.trim() ?? region;
      rows.push({ name: p.name, enterpriseNumber: null, address: p.address, postcode: p.address.match(/\b(\d{4})\b/)?.[1] ?? null, municipality: muni, website: p.website, status: null, statute: null });
      if (rows.length >= limit) break;
    }
  }
  await importRows(sector, rows, "google_maps");
  return { rows: rows.length, queries: queries.length };
}

/** Nieuwe registerinschrijvingen aan een website en `companies` koppelen. Max `limit`, 4 tegelijk. */
export async function linkNewEntries(limit = 20, sector?: string): Promise<{ checked: number; linked: number; noWebsite: number; errors: number }> {
  const due = await db()
    .select()
    .from(schema.registryEntries)
    .where(and(eq(schema.registryEntries.status, "nieuw"), sector ? eq(schema.registryEntries.sector, sector) : undefined))
    .orderBy(schema.registryEntries.id)
    .limit(limit);
  const out = { checked: 0, linked: 0, noWebsite: 0, errors: 0 };
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, due.length) }, async () => {
      while (i < due.length) {
        const e = due[i++];
        out.checked++;
        try {
          const site = await withTimeout(findWebsite(e), 25_000);
          if (!site) {
            out.noWebsite++;
            await db().update(schema.registryEntries).set({ status: "geen_website", checkedAt: new Date() }).where(eq(schema.registryEntries.id, e.id));
            continue;
          }
          const company = (
            await db()
              .insert(schema.companies)
              .values({
                domain: site.domain,
                name: e.name,
                sector: e.sector,
                enterpriseNumber: e.enterpriseNumber,
                registrySource: e.source,
                importedAt: e.importedAt,
                address: e.address,
                discoveredVia: "register",
                crawlStatus: "queued",
                nextCheckAt: new Date(),
              })
              .onConflictDoUpdate({
                target: schema.companies.domain,
                set: {
                  sector: sql`coalesce(${schema.companies.sector}, excluded.sector)`,
                  enterpriseNumber: sql`coalesce(${schema.companies.enterpriseNumber}, excluded.enterprise_number)`,
                  registrySource: sql`coalesce(${schema.companies.registrySource}, excluded.registry_source)`,
                  importedAt: sql`coalesce(${schema.companies.importedAt}, excluded.imported_at)`,
                  name: sql`coalesce(${schema.companies.name}, excluded.name)`,
                  crawlStatus: sql`coalesce(${schema.companies.crawlStatus}, 'queued')`,
                  nextCheckAt: sql`coalesce(${schema.companies.nextCheckAt}, now())`,
                },
              })
              .returning({ id: schema.companies.id })
          )[0];
          await db()
            .update(schema.registryEntries)
            .set({ status: "gekoppeld", website: site.domain, companyId: company.id, checkedAt: new Date(), error: `website via ${site.via} (${site.confidence})` })
            .where(eq(schema.registryEntries.id, e.id));
          out.linked++;
        } catch (err) {
          out.errors++;
          await db()
            .update(schema.registryEntries)
            .set({ status: "fout", error: String(err instanceof Error ? err.message : err).slice(0, 200), checkedAt: new Date() })
            .where(eq(schema.registryEntries.id, e.id));
        }
      }
    }),
  );
  return out;
}

/**
 * Wachtrij: sectorwerkgevers die nieuw zijn of aan hercontrole toe zijn, via de bestaande crawlDomain
 * (findJobsPage, ATS-adapters, extractie, upsertJobs). Max `limit`, 4 tegelijk, 25 s per site.
 */
export async function crawlQueue(limit = 12, sector?: string): Promise<{ crawled: number; withJobs: number; jobs: number; errors: number; costEur: number }> {
  const due = await db()
    .select({ id: schema.companies.id, domain: schema.companies.domain })
    .from(schema.companies)
    .where(
      and(
        isNotNull(schema.companies.sector),
        sector ? eq(schema.companies.sector, sector) : undefined,
        or(eq(schema.companies.crawlStatus, "queued"), isNull(schema.companies.nextCheckAt), lte(schema.companies.nextCheckAt, new Date())),
      ),
    )
    .orderBy(schema.companies.nextCheckAt)
    .limit(limit);
  const meter = new CostMeter();
  const out = { crawled: 0, withJobs: 0, jobs: 0, errors: 0, costEur: 0 };
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, due.length) }, async () => {
      while (i < due.length) {
        const c = due[i++];
        out.crawled++;
        try {
          const r = await withTimeout(crawlDomain(c.domain, null, meter, false), 25_000);
          if (r.hadJobs) out.withJobs++;
          out.jobs += r.jobs.length;
          const row = (await db().select({ jobsUrl: schema.companies.jobsUrl }).from(schema.companies).where(eq(schema.companies.id, c.id)).limit(1))[0];
          await db()
            .update(schema.companies)
            .set({ crawlStatus: row?.jobsUrl ? "ok" : "geen_jobpagina", crawlError: null, nextCheckAt: new Date(Date.now() + RECHECK_DAYS_OK * 86400_000) })
            .where(eq(schema.companies.id, c.id));
        } catch (err) {
          out.errors++;
          await db()
            .update(schema.companies)
            .set({ crawlStatus: "fout", crawlError: String(err instanceof Error ? err.message : err).slice(0, 200), nextCheckAt: new Date(Date.now() + RECHECK_DAYS_ERROR * 86400_000) })
            .where(eq(schema.companies.id, c.id));
        }
      }
    }),
  );
  out.costEur = Math.round(meter.eur * 1000) / 1000;
  return out;
}

/** Overzicht per sector voor /admin. */
export async function sectorOverview() {
  const entries = await db()
    .select({ sector: schema.registryEntries.sector, status: schema.registryEntries.status, source: schema.registryEntries.source, n: sql<number>`count(*)` })
    .from(schema.registryEntries)
    .groupBy(schema.registryEntries.sector, schema.registryEntries.status, schema.registryEntries.source);
  const companies = await db()
    .select({ sector: schema.companies.sector, status: schema.companies.crawlStatus, n: sql<number>`count(*)`, open: sql<number>`coalesce(sum(${schema.companies.openJobsCount}),0)` })
    .from(schema.companies)
    .where(isNotNull(schema.companies.sector))
    .groupBy(schema.companies.sector, schema.companies.crawlStatus);
  const activeJobs = await db()
    .select({ sector: schema.companies.sector, n: sql<number>`count(*)` })
    .from(schema.jobs)
    .innerJoin(schema.companies, eq(schema.jobs.companyId, schema.companies.id))
    .where(and(isNotNull(schema.companies.sector), sql`coalesce(${schema.jobs.verificationStatus}, '') <> 'gesloten'`, sql`${schema.jobs.lastSeenAt} > now() - interval '14 days'`))
    .groupBy(schema.companies.sector);
  const errors = await db()
    .select({ name: schema.companies.name, domain: schema.companies.domain, error: schema.companies.crawlError, sector: schema.companies.sector })
    .from(schema.companies)
    .where(and(isNotNull(schema.companies.sector), eq(schema.companies.crawlStatus, "fout")))
    .orderBy(desc(schema.companies.nextCheckAt))
    .limit(10);
  const employers = await db()
    .select({ name: schema.companies.name, domain: schema.companies.domain, sector: schema.companies.sector, status: schema.companies.crawlStatus, open: schema.companies.openJobsCount, jobsUrl: schema.companies.jobsUrl, ats: schema.companies.ats, source: schema.companies.registrySource })
    .from(schema.companies)
    .where(isNotNull(schema.companies.sector))
    .orderBy(desc(schema.companies.openJobsCount))
    .limit(60);
  return {
    sectors: Object.entries(SECTORS).map(([key, s]) => ({ key, label: s.label })),
    entries: entries.map((e) => ({ ...e, n: Number(e.n) })),
    companies: companies.map((c) => ({ ...c, n: Number(c.n), open: Number(c.open) })),
    activeJobs: activeJobs.map((a) => ({ ...a, n: Number(a.n) })),
    errors,
    employers,
  };
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`time-out na ${Math.round(ms / 1000)} s`)), ms))]);
}
