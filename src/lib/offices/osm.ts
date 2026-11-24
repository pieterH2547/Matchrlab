/**
 * Kantorenkaart, bron OpenStreetMap (Overpass): elke bank (amenity=bank), elk verzekeringskantoor
 * (office=insurance) en financieel adviseur (office=financial_advisor), met naam, merk, adres en exacte ligging.
 * Gratis, zonder key, en dekt heel België in één keer. Bronvermelding: © OpenStreetMap-bijdragers (ODbL).
 */
import { fetchRaw } from "@/lib/fetch";
import { registrableDomain } from "@/lib/blocklist";
import type { GeoPoint } from "@/lib/geo";
import { BE_POSTCODES } from "@/lib/geo-be";
import { detectBrand, isFlemishPostcode, type OfficeKind, type OfficeSector } from "./classify";
import type { OfficeInput } from "./collect";

const MIRRORS = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://lz4.overpass-api.de/api/interpreter"];

export type OsmElement = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> };

/** Vlaanderen (met Brussel) in zes stukken, zodat één Overpass-antwoord klein blijft. [zuid, west, noord, oost] */
export const FLANDERS_CHUNKS: { label: string; bbox: [number, number, number, number] }[] = [
  { label: "West-Vlaanderen", bbox: [50.68, 2.54, 51.4, 3.4] },
  { label: "Oost-Vlaanderen", bbox: [50.68, 3.4, 51.4, 4.15] },
  { label: "Antwerpen", bbox: [50.95, 4.15, 51.52, 5.15] },
  { label: "Vlaams-Brabant en Brussel", bbox: [50.68, 4.15, 50.95, 5.15] },
  { label: "Limburg-noord", bbox: [51.05, 5.15, 51.52, 5.95] },
  { label: "Limburg-zuid", bbox: [50.68, 5.15, 51.05, 5.95] },
];

const SELECT = ['["amenity"="bank"]', '["office"="insurance"]', '["office"="financial_advisor"]'];

export function overpassQuery(area: { around: { center: GeoPoint; radiusKm: number } } | { bbox: [number, number, number, number] }): string {
  const where = "around" in area ? `(around:${Math.round(area.around.radiusKm * 1000)},${area.around.center.lat},${area.around.center.lon})` : `(${area.bbox.join(",")})`;
  return `[out:json][timeout:90];(${SELECT.map((s) => `nwr${s}${where};`).join("")});out center tags;`;
}

/** Overpass bevragen; de eerste spiegel die antwoordt wint. Geeft null als geen enkele antwoordt. */
export async function fetchOverpass(query: string): Promise<OsmElement[] | null> {
  for (const url of MIRRORS) {
    try {
      const r = await fetchRaw(url, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: `data=${encodeURIComponent(query)}` }, 120_000);
      if (r.status < 200 || r.status >= 300) continue;
      const data = JSON.parse(r.body) as { elements?: OsmElement[] };
      if (Array.isArray(data.elements)) return data.elements;
    } catch {
      /* volgende spiegel */
    }
  }
  return null;
}

/** Dichtstbijzijnde postcode (middelpunt) voor een punt, als het adres geen postcode heeft. */
export function nearestPostcode(p: GeoPoint): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const [zip, [lat, lon]] of Object.entries(BE_POSTCODES)) {
    const d = (lat - p.lat) ** 2 + ((lon - p.lon) * Math.cos((p.lat * Math.PI) / 180)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = zip;
    }
  }
  // Verder dan ±6 km van elk postcodemiddelpunt: onbetrouwbaar.
  return bestD < (6 / 111) ** 2 ? best : null;
}

/** Eén OSM-element naar een kantoor; null als het geen kantoor is (bv. enkel een geldautomaat) of buiten Vlaanderen ligt. */
export function osmToOffice(e: OsmElement): OfficeInput | null {
  const t = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  if (lat === undefined || lon === undefined) return null;
  const name = (t.name ?? t["name:nl"] ?? t.brand ?? t.operator ?? "").trim();
  if (!name) return null;
  // Geldautomaten zonder kantoor zijn amenity=atm, maar sommige banken taggen atm=yes op een kantoor; dat is wél een kantoor.
  if (t.amenity === "atm" || /\b(atm|geldautomaat|self.?bank|bankautomaat|cash ?point)\b/i.test(name)) return null;
  let sector: OfficeSector;
  let kind: OfficeKind;
  if (t.amenity === "bank") {
    sector = "bank";
    kind = "bankkantoor";
  } else if (t.office === "insurance") {
    sector = "verzekeringen";
    kind = /(agent|\b(axa|ag insurance|allianz|baloise|dvv|p&v|vivium|ethias|nn)\b)/i.test(name) || /agent/i.test(t.insurance ?? "") ? "verzekeringsagent" : "verzekeringsmakelaar";
  } else if (t.office === "financial_advisor") {
    sector = "bank";
    kind = "financieel-adviseur";
  } else return null;
  const postcode = t["addr:postcode"]?.match(/\d{4}/)?.[0] ?? nearestPostcode({ lat, lon });
  if (postcode && !isFlemishPostcode(postcode)) return null;
  const street = [t["addr:street"], t["addr:housenumber"]].filter(Boolean).join(" ");
  const municipality = (t["addr:city"] ?? "").trim() || null;
  const address = [street, [postcode, municipality].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null;
  const website = (t.website ?? t["contact:website"] ?? t["brand:website"] ?? "").trim().match(/^https?:\/\/\S+/)?.[0] ?? null;
  return {
    sector,
    kind,
    dedupeKey: `osm:${e.type}/${e.id}`,
    name,
    brand: (t.brand ?? "").trim() || detectBrand(name, sector),
    address,
    postcode,
    municipality,
    lat,
    lng: lon,
    geoPrecision: "exact",
    website,
    domain: website ? registrableDomain(website) : null,
    phone: (t.phone ?? t["contact:phone"] ?? "").trim().split(";")[0] || null,
    enterpriseNumber: null,
    rating: null,
    ratingCount: null,
    category: t.amenity === "bank" ? "Bank (OSM)" : `${t.office} (OSM)`,
    source: "osm",
  };
}
