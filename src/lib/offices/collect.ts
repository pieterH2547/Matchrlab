/**
 * Kantorenkaart, deel 2: kantoren verzamelen, verrijken en opvragen.
 *
 * Bronnen, in deze volgorde van vertrouwen:
 *  - google_maps  elke bank- en verzekeringsvestiging per gemeente binnen de straal (Serper, 14 dagen cache);
 *  - fvf          vindeenverzekeringsmakelaar.be (de makelaarsgids van FVF): profielpagina's via de zoekketen
 *                 (site:-zoekopdracht per gemeente) of een geüpload CSV-bestand;
 *  - fsma         het FSMA-register van verzekeringstussenpersonen, zoals al geïmporteerd in `registry_entries`.
 * Elke bron voegt zichzelf toe aan `sources`; een kantoor met twee bronnen is bevestigd.
 * Alles begrensd: zoekbudget per aanroep, 4 tegelijk, time-outs. Herhalen is goedkoop dankzij de caches.
 */
import { and, between, eq, inArray, like, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Office } from "@/lib/db/schema";
import { cachedPlaceQueries, placesSearchFull, unwrapGoogleUrl, webSearch } from "@/lib/search";
import { isBlockedDomain } from "@/lib/blocklist";
import { crawlQueue } from "@/lib/sector/process";
import { BE_ZIP_NAMES } from "@/lib/geo-be";
import { fetchOverpassDetailed, FLANDERS_CHUNKS, osmToOffice, overpassQuery } from "./osm";
import { BRAND_SITES, readBrandPages } from "./brands";
import { fetchPage } from "@/lib/fetch";
import { registrableDomain } from "@/lib/blocklist";
import { distanceKm, municipalitiesWithin, type GeoPoint } from "@/lib/geo";
import { parseRegistry } from "@/lib/sector/registry";
import {
  classify,
  detectBrand,
  isFlemishPostcode,
  MAPS_QUERIES,
  officeKey,
  parseListingFromHtml,
  parseListingFromText,
  postcodeCenter,
  postcodeName,
  sameOffice,
  splitAddress,
  type OfficeKind,
  type OfficeSector,
} from "./classify";

export type OfficeInput = {
  sector: OfficeSector;
  kind: OfficeKind;
  dedupeKey: string;
  name: string;
  brand: string | null;
  address: string | null;
  postcode: string | null;
  municipality: string | null;
  lat: number | null;
  lng: number | null;
  geoPrecision: "exact" | "postcode";
  website: string | null;
  domain: string | null;
  phone: string | null;
  email?: string | null;
  enterpriseNumber: string | null;
  rating: number | null;
  ratingCount: number | null;
  category: string | null;
  source: string;
};

/**
 * Zelfde vestiging onder een andere sleutel (Google-cid, OSM-id, naam + postcode)? Zelfde sector én
 * (binnen 60 m met een naam- of merkovereenkomst, of dezelfde naam op dezelfde postcode).
 */
export function sameSpot(a: { sector: string; name: string; brand: string | null; postcode: string | null; lat: number | null; lng: number | null }, b: typeof a): boolean {
  if (a.sector !== b.sector) return false;
  const byName = sameOffice({ name: a.name, postcode: a.postcode }, { name: b.name, postcode: b.postcode });
  if (a.lat !== null && a.lng !== null && b.lat !== null && b.lng !== null) {
    const m = distanceKm({ lat: a.lat, lon: a.lng }, { lat: b.lat, lon: b.lng }) * 1000;
    if (m <= 60 && (byName || (a.brand && a.brand === b.brand))) return true;
  }
  return byName && Boolean(a.postcode) && a.postcode === b.postcode;
}

/**
 * Nieuwe kantoren tegen de bestaande leggen: een vestiging die er al is (via een andere bron) krijgt de
 * bron erbij in plaats van een tweede rij. Ook binnen de nieuwe lijst zelf wordt ontdubbeld.
 */
export async function mergeIntoKnown(items: OfficeInput[]): Promise<{ items: OfficeInput[]; merged: number }> {
  const withGeo = items.filter((i) => i.lat !== null && i.lng !== null);
  if (!withGeo.length) return { items, merged: 0 };
  const lats = withGeo.map((i) => i.lat!);
  const lngs = withGeo.map((i) => i.lng!);
  const known = await db()
    .select()
    .from(schema.offices)
    .where(and(between(schema.offices.lat, Math.min(...lats) - 0.002, Math.max(...lats) + 0.002), between(schema.offices.lng, Math.min(...lngs) - 0.003, Math.max(...lngs) + 0.003)));
  const keys = new Set(items.map((i) => i.dedupeKey));
  const out: OfficeInput[] = [];
  let merged = 0;
  for (const it of items) {
    const hit = known.find((k) => k.dedupeKey !== it.dedupeKey && !keys.has(k.dedupeKey) && sameSpot(it, k)) ?? out.find((o) => o.dedupeKey !== it.dedupeKey && sameSpot(it, o));
    if (!hit) {
      out.push(it);
      continue;
    }
    merged++;
    // Overnemen onder de bestaande sleutel; coalesce in de upsert houdt wat er al stond en vult aan.
    out.push({ ...it, dedupeKey: hit.dedupeKey, lat: null, lng: null, geoPrecision: "postcode" });
  }
  return { items: out, merged };
}

/** Kantoren opslaan: nieuw = invoegen; bestaand = bron toevoegen en lege velden aanvullen. */
export async function upsertOffices(items: OfficeInput[]): Promise<{ inserted: number; updated: number }> {
  if (!items.length) return { inserted: 0, updated: 0 };
  const unique = Array.from(new Map(items.map((i) => [i.dedupeKey, i])).values());
  const keys = unique.map((i) => i.dedupeKey);
  const existing = new Set((await db().select({ k: schema.offices.dedupeKey }).from(schema.offices).where(inArray(schema.offices.dedupeKey, keys))).map((r) => r.k));
  const now = new Date();
  for (let i = 0; i < unique.length; i += 100) {
    const chunk = unique.slice(i, i + 100);
    await db()
      .insert(schema.offices)
      .values(
        chunk.map(({ source, ...o }) => ({
          ...o,
          name: o.name.slice(0, 200),
          address: o.address?.slice(0, 300) ?? null,
          sources: [source],
          firstSeenAt: now,
          lastSeenAt: now,
        })),
      )
      .onConflictDoUpdate({
        target: schema.offices.dedupeKey,
        set: {
          lastSeenAt: now,
          sources: sql`(select jsonb_agg(distinct x) from jsonb_array_elements(${schema.offices.sources} || excluded.sources) as t(x))`,
          brand: sql`coalesce(${schema.offices.brand}, excluded.brand)`,
          address: sql`coalesce(${schema.offices.address}, excluded.address)`,
          postcode: sql`coalesce(${schema.offices.postcode}, excluded.postcode)`,
          municipality: sql`coalesce(${schema.offices.municipality}, excluded.municipality)`,
          website: sql`coalesce(${schema.offices.website}, excluded.website)`,
          domain: sql`coalesce(${schema.offices.domain}, excluded.domain)`,
          phone: sql`coalesce(${schema.offices.phone}, excluded.phone)`,
          email: sql`coalesce(${schema.offices.email}, excluded.email)`,
          enterpriseNumber: sql`coalesce(${schema.offices.enterpriseNumber}, excluded.enterprise_number)`,
          rating: sql`coalesce(excluded.rating, ${schema.offices.rating})`,
          ratingCount: sql`coalesce(excluded.rating_count, ${schema.offices.ratingCount})`,
          category: sql`coalesce(${schema.offices.category}, excluded.category)`,
          // Een exacte ligging wint altijd van een postcodemiddelpunt.
          lat: sql`case when ${schema.offices.geoPrecision} = 'postcode' and excluded.geo_precision = 'exact' then excluded.lat else coalesce(${schema.offices.lat}, excluded.lat) end`,
          lng: sql`case when ${schema.offices.geoPrecision} = 'postcode' and excluded.geo_precision = 'exact' then excluded.lng else coalesce(${schema.offices.lng}, excluded.lng) end`,
          geoPrecision: sql`case when excluded.geo_precision = 'exact' then 'exact' else ${schema.offices.geoPrecision} end`,
        },
      });
  }
  const inserted = keys.filter((k) => !existing.has(k)).length;
  return { inserted, updated: unique.length - inserted };
}

export type BuildResult = {
  municipalities: number;
  queries: number;
  fromCache: number;
  live: number;
  skippedForBudget: number;
  found: number;
  merged: number;
  inserted: number;
  updated: number;
  outOfSector: number;
};

/** Zoekopdrachten uitvoeren (cache gratis, max `budget` nieuwe), vestigingen classificeren en opslaan. */
async function runMapsPlan(queries: string[], sectors: OfficeSector[], budget: number): Promise<Omit<BuildResult, "municipalities">> {
  const cached = await cachedPlaceQueries();
  let live = 0;
  let skipped = 0;
  const todo: { q: string; cached: boolean }[] = [];
  for (const q of queries) {
    const isCached = cached.has(q.trim().toLowerCase());
    if (isCached) todo.push({ q, cached: true });
    else if (live < budget) {
      live++;
      todo.push({ q, cached: false });
    } else skipped++;
  }
  const items: OfficeInput[] = [];
  let outOfSector = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, todo.length) }, async () => {
      while (next < todo.length) {
        const { q } = todo[next++];
        const places = await placesSearchFull(q).catch(() => null);
        for (const p of places ?? []) {
          const c = classify(p.name, p.category);
          if (!c || !sectors.includes(c.sector)) {
            outOfSector++;
            continue;
          }
          const { postcode, municipality } = splitAddress(p.address);
          if (postcode && !isFlemishPostcode(postcode)) continue;
          const domain = p.website ? registrableDomain(p.website) : null;
          items.push({
            sector: c.sector,
            kind: c.kind,
            dedupeKey: officeKey({ cid: p.cid, name: p.name, postcode }),
            name: p.name,
            brand: detectBrand(p.name, c.sector),
            address: p.address || null,
            postcode,
            municipality,
            lat: p.lat,
            lng: p.lng,
            geoPrecision: "exact",
            website: p.website,
            domain,
            phone: p.phone,
            enterpriseNumber: null,
            rating: p.rating,
            ratingCount: p.ratingCount,
            category: p.category || null,
            source: "google_maps",
          });
        }
      }
    }),
  );
  const m = await mergeIntoKnown(items);
  const r = await upsertOffices(m.items);
  return { queries: queries.length, fromCache: todo.filter((t) => t.cached).length, live, skippedForBudget: skipped, found: items.length, merged: m.merged, inserted: r.inserted, updated: r.updated, outOfSector };
}

/**
 * Google Maps afgaan voor elke gemeente binnen de straal: soort kantoor × gemeente, dichtstbij eerst.
 * `budget` = max nieuwe (betalende) Maps-vragen in deze aanroep; wat al in de cache zit is gratis en telt niet.
 * Opnieuw aanroepen gaat verder waar het budget ophield.
 */
export async function buildOffices(center: GeoPoint, radiusKm: number, sectors: OfficeSector[], budget = 40): Promise<BuildResult> {
  const munis = municipalitiesWithin(center, radiusKm, 80);
  const queries: string[] = [];
  for (const m of munis) for (const s of sectors) for (const q of MAPS_QUERIES[s]) queries.push(`${q} ${m.name}`);
  return { municipalities: munis.length, ...(await runMapsPlan(queries, sectors, budget)) };
}

/** Alle Vlaamse gemeenten (één naam per postcode, dubbele namen weg), op postcode gesorteerd. */
export function flemishMunicipalities(): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const zip of Object.keys(BE_ZIP_NAMES).sort()) {
    const name = BE_ZIP_NAMES[zip];
    if (!isFlemishPostcode(zip) || !name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name.replace(/(^|[-\s])\p{L}/gu, (m) => m.toUpperCase()));
  }
  return out;
}

/** Heel Vlaanderen via Google Maps, in rondes van `budget` nieuwe vragen; `skippedForBudget` zegt hoeveel er nog wachten. */
export async function buildOfficesFlanders(sectors: OfficeSector[], budget = 100): Promise<BuildResult> {
  const munis = flemishMunicipalities();
  const queries: string[] = [];
  for (const m of munis) for (const s of sectors) for (const q of MAPS_QUERIES[s]) queries.push(`${q} ${m}`);
  return { municipalities: munis.length, ...(await runMapsPlan(queries, sectors, budget)) };
}

export type OsmResult = { label: string; elements: number; offices: number; merged: number; inserted: number; updated: number; note?: string };

/** OpenStreetMap rond een punt (straal) of voor één stuk van Vlaanderen (chunk 0..5). */
export async function importOsm(area: { center: GeoPoint; radiusKm: number } | { chunk: number }): Promise<OsmResult> {
  const label = "chunk" in area ? (FLANDERS_CHUNKS[area.chunk]?.label ?? "?") : "regio";
  const query = "chunk" in area ? overpassQuery({ bbox: FLANDERS_CHUNKS[area.chunk].bbox }) : overpassQuery({ around: { center: area.center, radiusKm: area.radiusKm } });
  const { elements, attempts } = await fetchOverpassDetailed(query);
  if (!elements) return { label, elements: 0, offices: 0, merged: 0, inserted: 0, updated: 0, note: `OpenStreetMap (Overpass) antwoordde niet: ${attempts.join(" · ")}` };
  const items = elements.map(osmToOffice).filter((x): x is OfficeInput => x !== null);
  const m = await mergeIntoKnown(items);
  const r = await upsertOffices(m.items);
  return { label, elements: elements.length, offices: items.length, merged: m.merged, inserted: r.inserted, updated: r.updated };
}

/** Kantoren in het gebied (grove rechthoek), om nieuwe bronnen aan bestaande vestigingen te koppelen. */
async function officesInBox(center: GeoPoint, radiusKm: number): Promise<Office[]> {
  const dLat = radiusKm / 111;
  const dLng = radiusKm / (111 * Math.cos((center.lat * Math.PI) / 180));
  return db()
    .select()
    .from(schema.offices)
    .where(and(between(schema.offices.lat, center.lat - dLat, center.lat + dLat), between(schema.offices.lng, center.lon - dLng, center.lon + dLng)));
}

type Listing = { name: string; address: string | null; postcode: string | null; municipality: string | null; phone: string | null; email?: string | null; website: string | null; enterpriseNumber: string | null };

/**
 * Lijst van makelaars (uit FVF-gids of FSMA-register) tegen de kaart leggen: bestaand kantoor = bron toevoegen
 * (bevestigd), onbekend kantoor = toevoegen op het middelpunt van zijn postcode (bij benadering).
 */
async function mergeListings(center: GeoPoint, radiusKm: number, listings: Listing[], source: string, kind: OfficeKind, opts: { sector?: OfficeSector; brand?: string } = {}): Promise<{ matched: number; added: number; outside: number }> {
  const known = (await officesInBox(center, radiusKm)).filter((k) => !opts.sector || k.sector === opts.sector);
  const items: OfficeInput[] = [];
  let matched = 0;
  let outside = 0;
  for (const l of listings) {
    const pc = postcodeCenter(l.postcode);
    if (!pc || distanceKm(center, pc) > radiusKm + 3) {
      outside++;
      continue;
    }
    const hit = known.find((k) => sameOffice({ name: k.name, postcode: k.postcode }, { name: l.name, postcode: l.postcode }));
    if (hit) {
      matched++;
      items.push({
        sector: hit.sector as OfficeSector,
        kind: hit.kind as OfficeKind,
        dedupeKey: hit.dedupeKey,
        name: hit.name,
        brand: hit.brand,
        address: l.address,
        postcode: l.postcode,
        municipality: l.municipality,
        lat: null,
        lng: null,
        geoPrecision: "postcode",
        website: l.website,
        domain: l.website ? registrableDomain(l.website) : null,
        phone: l.phone,
        email: l.email ?? null,
        enterpriseNumber: l.enterpriseNumber,
        rating: null,
        ratingCount: null,
        category: null,
        source,
      });
      continue;
    }
    const sector = opts.sector ?? "verzekeringen";
    items.push({
      sector,
      kind,
      dedupeKey: officeKey({ enterpriseNumber: l.enterpriseNumber, name: l.name, postcode: l.postcode }),
      name: l.name,
      brand: opts.brand ?? detectBrand(l.name, sector),
      address: l.address,
      postcode: l.postcode,
      municipality: l.municipality ?? postcodeName(l.postcode),
      lat: pc.lat,
      lng: pc.lon,
      geoPrecision: "postcode",
      website: l.website,
      domain: l.website ? registrableDomain(l.website) : null,
      phone: l.phone,
      email: l.email ?? null,
      enterpriseNumber: l.enterpriseNumber,
      rating: null,
      ratingCount: null,
      category: null,
      source,
    });
  }
  const r = await upsertOffices(items);
  return { matched, added: r.inserted, outside };
}

/** Heel Vlaanderen als één gebied: middelpunt en straal die alles van De Panne tot Maasmechelen dekken. */
const FLANDERS_CENTER: GeoPoint = { lat: 51.0, lon: 4.25 };
const FLANDERS_RADIUS_KM = 130;

/**
 * Merksite (Argenta, Crelan, …): kantoorpagina's uit de sitemap lezen, `limit` per ronde vanaf `offset`.
 * Kantoren worden over heel Vlaanderen samengevoegd met wat er al is (naam + postcode) of toegevoegd op het postcodemiddelpunt.
 */
export async function importBrandSite(key: string, offset = 0, limit = 40): Promise<{ brand: string; total: number; read: number; matched: number; added: number; outside: number; next: number | null }> {
  const site = BRAND_SITES.find((b) => b.key === key);
  if (!site) throw new Error("Onbekend merk.");
  const { total, pages, next } = await readBrandPages(site, offset, limit);
  const listings: Listing[] = pages.map((p) => ({ name: p.name, address: p.address, postcode: p.postcode, municipality: p.municipality, phone: p.phone, email: p.email, website: p.website, enterpriseNumber: null }));
  const m = await mergeListings(FLANDERS_CENTER, FLANDERS_RADIUS_KM, listings, `site:${site.key}`, "bankkantoor", { sector: site.sector, brand: site.brand });
  return { brand: site.brand, total, read: pages.length, ...m, next };
}

/** FSMA-register (al geïmporteerd via Sectoren) tegen de kaart leggen. */
export async function crossCheckRegistry(center: GeoPoint, radiusKm: number): Promise<{ entries: number; matched: number; added: number; outside: number }> {
  const rows = await db()
    .select()
    .from(schema.registryEntries)
    .where(and(eq(schema.registryEntries.sector, "verzekeringsmakelaars"), like(schema.registryEntries.source, "fsma%")));
  const listings: Listing[] = rows.map((r) => ({ name: r.name, address: r.address, postcode: r.postcode, municipality: r.municipality, phone: null, website: r.website, enterpriseNumber: r.enterpriseNumber }));
  const m = await mergeListings(center, radiusKm, listings, "fsma", "verzekeringsmakelaar");
  return { entries: rows.length, ...m };
}

const FVF_HOST = "vindeenverzekeringsmakelaar.be";

/**
 * vindeenverzekeringsmakelaar.be (FVF) via de zoekketen: per gemeente de profielpagina's op die site zoeken,
 * elke pagina lezen (page_cache) en naam + adres eruit halen. Niets wordt automatisch doorzocht op de site zelf.
 */
export async function enrichFromFvf(center: GeoPoint, radiusKm: number, budget = 12): Promise<{ municipalities: number; searches: number; pages: number; parsed: number; matched: number; added: number; outside: number; note?: string }> {
  const munis = municipalitiesWithin(center, radiusKm, budget);
  const urls = new Set<string>();
  let searches = 0;
  for (const m of munis) {
    const r = await webSearch(`site:${FVF_HOST} ${m.name}`, { count: 20 }).catch(() => null);
    if (r === null) continue;
    searches++;
    for (const x of r) if (x.url.includes(FVF_HOST) && !/\/(zoek|search|over|contact|privacy)\b/i.test(new URL(x.url).pathname) && new URL(x.url).pathname.length > 1) urls.add(x.url);
  }
  if (!searches) return { municipalities: munis.length, searches: 0, pages: 0, parsed: 0, matched: 0, added: 0, outside: 0, note: "Geen zoekmachine beschikbaar; vul Serper of een reserve in via Instellingen." };
  const listings: Listing[] = [];
  const list = Array.from(urls).slice(0, 60);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, list.length) }, async () => {
      while (next < list.length) {
        const url = list[next++];
        const page = await fetchPage(url).catch(() => null);
        if (!page || page.status >= 400) continue;
        const title = page.html?.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? decodeURIComponent(new URL(url).pathname.split("/").filter(Boolean).pop() ?? "").replace(/[-_]+/g, " ");
        const parsed = page.html ? parseListingFromHtml(page.html, title) : parseListingFromText(page.text, title);
        if (parsed) listings.push(parsed);
      }
    }),
  );
  const m = await mergeListings(center, radiusKm, listings, "fvf", "verzekeringsmakelaar");
  return { municipalities: munis.length, searches, pages: list.length, parsed: listings.length, ...m, note: list.length === 0 ? `Geen pagina's van ${FVF_HOST} in de zoekresultaten; probeer een CSV-import.` : undefined };
}

/** CSV-bestand van een gids of register (naam, adres, postcode, gemeente, website, ondernemingsnummer) tegen de kaart leggen. */
export async function importOfficesCsv(center: GeoPoint, radiusKm: number, csv: string, source: string): Promise<{ rows: number; matched: number; added: number; outside: number; columns: string[] }> {
  const parsed = parseRegistry(csv);
  const listings: Listing[] = parsed.rows.map((r) => ({ name: r.name, address: r.address, postcode: r.postcode, municipality: r.municipality, phone: null, website: r.website, enterpriseNumber: r.enterpriseNumber }));
  const m = await mergeListings(center, radiusKm, listings, source, "verzekeringsmakelaar");
  return { rows: parsed.rows.length, ...m, columns: parsed.columns };
}

export type OfficeView = {
  id: number;
  sector: OfficeSector;
  kind: OfficeKind;
  name: string;
  brand: string | null;
  address: string | null;
  postcode: string | null;
  municipality: string | null;
  lat: number;
  lng: number;
  approximate: boolean;
  website: string | null;
  phone: string | null;
  email: string | null;
  contactEmail: string | null;
  contactName: string | null;
  /** De website is die van het merk (meerdere kantoren delen ze): vacatures gelden dan voor het merk, niet per se dit kantoor. */
  brandSite: boolean;
  rating: number | null;
  ratingCount: number | null;
  sources: string[];
  verified: boolean;
  distanceKm: number;
  openJobs: number;
  careersUrl: string | null;
  lastSeenAt: string;
};

/** Alle kantoren binnen de straal, dichtstbij eerst, met het aantal open vacatures van hun website (als we die kennen). */
export async function officesNear(center: GeoPoint, radiusKm: number, sectors: OfficeSector[]): Promise<OfficeView[]> {
  const rows = (await officesInBox(center, radiusKm))
    .filter((o) => o.lat !== null && o.lng !== null && sectors.includes(o.sector as OfficeSector))
    .map((o) => {
      // Oude rijen met een Google-omweg als website: hier rechtzetten (en bij de volgende Maps-ronde in de database).
      const website = unwrapGoogleUrl(o.website);
      return { ...o, website, domain: website ? registrableDomain(website) : null };
    });
  const domains = Array.from(new Set(rows.map((r) => r.domain).filter((d): d is string => Boolean(d))));
  const perDomain = new Map<string, number>();
  for (const r of rows) if (r.domain) perDomain.set(r.domain, (perDomain.get(r.domain) ?? 0) + 1);
  const companies = domains.length
    ? await db()
        .select({ domain: schema.companies.domain, open: schema.companies.openJobsCount, jobsUrl: schema.companies.jobsUrl, contactEmail: schema.companies.contactEmail, contactName: schema.companies.contactName })
        .from(schema.companies)
        .where(inArray(schema.companies.domain, domains))
    : [];
  const byDomain = new Map(companies.map((c) => [c.domain, c]));
  const out: OfficeView[] = [];
  for (const o of rows) {
    const d = distanceKm(center, { lat: o.lat!, lon: o.lng! });
    if (d > radiusKm) continue;
    const c = o.domain ? byDomain.get(o.domain) : undefined;
    out.push({
      id: o.id,
      sector: o.sector as OfficeSector,
      kind: o.kind as OfficeKind,
      name: o.name,
      brand: o.brand,
      address: o.address,
      postcode: o.postcode,
      municipality: o.municipality,
      lat: o.lat!,
      lng: o.lng!,
      approximate: o.geoPrecision !== "exact",
      website: o.website,
      phone: o.phone,
      email: o.email,
      contactEmail: c?.contactEmail ?? null,
      contactName: c?.contactName ?? null,
      brandSite: Boolean(o.domain && (perDomain.get(o.domain) ?? 0) >= 3),
      rating: o.rating,
      ratingCount: o.ratingCount,
      sources: o.sources,
      verified: o.sources.length >= 2 || o.sources.includes("fsma"),
      distanceKm: Math.round(d * 10) / 10,
      openJobs: c?.open ?? 0,
      careersUrl: c?.jobsUrl ?? null,
      lastSeenAt: o.lastSeenAt.toISOString(),
    });
  }
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}

/**
 * Vacatures zoeken bij de kantoren binnen de straal: hun websites in de bestaande sectorwachtrij zetten
 * (`companies` met sector + crawlStatus queued) en een ronde crawlen (jobpagina, ATS, extractie, upsertJobs).
 * Daarna telt `openJobsCount` per domein mee op de kaart en houdt de dagelijkse herinventarisatie het vers.
 */
export async function crawlOfficeJobs(center: GeoPoint, radiusKm: number, limit = 16): Promise<{ domains: number; queued: number; crawled: number; withJobs: number; jobs: number; errors: number; costEur: number; remaining: number }> {
  const rows = await officesInBox(center, radiusKm);
  const byDomain = new Map<string, { name: string; sector: string; address: string | null; lat: number | null; lng: number | null }>();
  for (const o of rows) {
    if (o.lat === null || o.lng === null || distanceKm(center, { lat: o.lat, lon: o.lng }) > radiusKm) continue;
    const website = unwrapGoogleUrl(o.website);
    const domain = website ? registrableDomain(website) : null;
    if (!domain || isBlockedDomain(domain) || byDomain.has(domain)) continue;
    byDomain.set(domain, { name: o.brand ?? o.name, sector: o.sector, address: o.address, lat: o.lat, lng: o.lng });
  }
  const domains = Array.from(byDomain.keys());
  if (!domains.length) return { domains: 0, queued: 0, crawled: 0, withJobs: 0, jobs: 0, errors: 0, costEur: 0, remaining: 0 };
  const known = await db().select({ domain: schema.companies.domain, status: schema.companies.crawlStatus, last: schema.companies.lastCrawledAt }).from(schema.companies).where(inArray(schema.companies.domain, domains));
  const knownMap = new Map(known.map((k) => [k.domain, k]));
  // Nieuw of langer dan 7 dagen niet bekeken: in de wachtrij. De rest kent de kaart al.
  const toQueue = domains.filter((d) => {
    const k = knownMap.get(d);
    return !k || !k.last || Date.now() - k.last.getTime() > 7 * 86400_000;
  });
  for (let i = 0; i < toQueue.length; i += 100) {
    const chunk = toQueue.slice(i, i + 100);
    await db()
      .insert(schema.companies)
      .values(chunk.map((d) => ({ domain: d, name: byDomain.get(d)!.name, sector: byDomain.get(d)!.sector, address: byDomain.get(d)!.address, lat: byDomain.get(d)!.lat, lng: byDomain.get(d)!.lng, discoveredVia: "kaart", crawlStatus: "queued", nextCheckAt: new Date() })))
      .onConflictDoUpdate({
        target: schema.companies.domain,
        set: { sector: sql`coalesce(${schema.companies.sector}, excluded.sector)`, name: sql`coalesce(${schema.companies.name}, excluded.name)`, crawlStatus: "queued", nextCheckAt: new Date() },
      });
  }
  const r = await crawlQueue(limit);
  const left = await db()
    .select({ n: sql<number>`count(*)` })
    .from(schema.companies)
    .where(and(inArray(schema.companies.domain, domains), eq(schema.companies.crawlStatus, "queued")));
  return { domains: domains.length, queued: toQueue.length, ...r, remaining: Number(left[0]?.n ?? 0) };
}

/** Totalen voor het beheer: kantoren per sector en per bron. */
export async function officeStats(): Promise<{ sector: string; n: number; verified: number; maps: number; osm: number }[]> {
  const rows = await db()
    .select({
      sector: schema.offices.sector,
      n: sql<number>`count(*)`,
      verified: sql<number>`count(*) filter (where jsonb_array_length(${schema.offices.sources}) >= 2 or ${schema.offices.sources} ? 'fsma')`,
      maps: sql<number>`count(*) filter (where ${schema.offices.sources} ? 'google_maps')`,
      osm: sql<number>`count(*) filter (where ${schema.offices.sources} ? 'osm')`,
    })
    .from(schema.offices)
    .groupBy(schema.offices.sector);
  return rows.map((r) => ({ sector: r.sector, n: Number(r.n), verified: Number(r.verified), maps: Number(r.maps), osm: Number(r.osm) }));
}
