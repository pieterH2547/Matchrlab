import { BE_PLACES, BE_POSTCODES } from "./geo-be";
/**
 * Grove geolocatie voor Belgische plaatsnamen, zonder externe dienst.
 * Onbekende plaatsen worden niet weggefilterd; het scoringsmodel oordeelt dan.
 */
export type GeoPoint = { lat: number; lon: number };

const CITIES: Record<string, GeoPoint> = {
  // Antwerpen
  antwerpen: { lat: 51.2194, lon: 4.4025 },
  anvers: { lat: 51.2194, lon: 4.4025 },
  mechelen: { lat: 51.0259, lon: 4.4776 },
  lier: { lat: 51.1312, lon: 4.5702 },
  turnhout: { lat: 51.3227, lon: 4.9447 },
  herentals: { lat: 51.1767, lon: 4.8359 },
  geel: { lat: 51.1621, lon: 4.9897 },
  mol: { lat: 51.1909, lon: 5.1157 },
  heist: { lat: 51.0749, lon: 4.7257 },
  "heist-op-den-berg": { lat: 51.0749, lon: 4.7257 },
  boom: { lat: 51.0923, lon: 4.3669 },
  kontich: { lat: 51.1316, lon: 4.4463 },
  edegem: { lat: 51.1566, lon: 4.4428 },
  mortsel: { lat: 51.1689, lon: 4.4572 },
  wilrijk: { lat: 51.1683, lon: 4.3966 },
  hoboken: { lat: 51.1764, lon: 4.3486 },
  merksem: { lat: 51.2439, lon: 4.4427 },
  deurne: { lat: 51.2224, lon: 4.4632 },
  berchem: { lat: 51.1945, lon: 4.4267 },
  ekeren: { lat: 51.2797, lon: 4.4175 },
  kapellen: { lat: 51.3148, lon: 4.4332 },
  brasschaat: { lat: 51.2911, lon: 4.4917 },
  schoten: { lat: 51.2529, lon: 4.5027 },
  wijnegem: { lat: 51.2271, lon: 4.5203 },
  wommelgem: { lat: 51.2037, lon: 4.5306 },
  ranst: { lat: 51.1911, lon: 4.5648 },
  zandhoven: { lat: 51.2142, lon: 4.6613 },
  nijlen: { lat: 51.1612, lon: 4.6687 },
  duffel: { lat: 51.0963, lon: 4.5102 },
  "sint-katelijne-waver": { lat: 51.0724, lon: 4.5339 },
  bonheiden: { lat: 51.0227, lon: 4.5468 },
  putte: { lat: 51.0541, lon: 4.6329 },
  willebroek: { lat: 51.0609, lon: 4.3602 },
  puurs: { lat: 51.0745, lon: 4.2868 },
  "puurs-sint-amands": { lat: 51.0745, lon: 4.2868 },
  bornem: { lat: 51.0975, lon: 4.2424 },
  rumst: { lat: 51.0812, lon: 4.4224 },
  niel: { lat: 51.1114, lon: 4.3343 },
  schelle: { lat: 51.1265, lon: 4.3387 },
  hemiksem: { lat: 51.1448, lon: 4.3379 },
  aartselaar: { lat: 51.1346, lon: 4.3862 },
  zwijndrecht: { lat: 51.2182, lon: 4.3258 },
  beveren: { lat: 51.2117, lon: 4.2557 },
  stabroek: { lat: 51.3303, lon: 4.3689 },
  zoersel: { lat: 51.2676, lon: 4.7123 },
  malle: { lat: 51.2998, lon: 4.7166 },
  brecht: { lat: 51.3503, lon: 4.6367 },
  hoogstraten: { lat: 51.4004, lon: 4.7598 },
  beerse: { lat: 51.3178, lon: 4.8538 },
  westerlo: { lat: 51.0905, lon: 4.9152 },
  laakdal: { lat: 51.0866, lon: 5.0085 },
  balen: { lat: 51.1696, lon: 5.1667 },
  lommel: { lat: 51.2306, lon: 5.3135 },
  // Vlaams-Brabant / Brussel
  brussel: { lat: 50.8503, lon: 4.3517 },
  bruxelles: { lat: 50.8503, lon: 4.3517 },
  brussels: { lat: 50.8503, lon: 4.3517 },
  leuven: { lat: 50.8798, lon: 4.7005 },
  vilvoorde: { lat: 50.928, lon: 4.4244 },
  zaventem: { lat: 50.8847, lon: 4.4719 },
  machelen: { lat: 50.9099, lon: 4.4394 },
  grimbergen: { lat: 50.9341, lon: 4.3722 },
  londerzeel: { lat: 51.0046, lon: 4.3029 },
  kapelle: { lat: 50.9631, lon: 4.3725 },
  "kapelle-op-den-bos": { lat: 50.9631, lon: 4.3725 },
  zemst: { lat: 50.9838, lon: 4.4613 },
  kampenhout: { lat: 50.9427, lon: 4.5519 },
  haacht: { lat: 50.9774, lon: 4.6383 },
  keerbergen: { lat: 51.0023, lon: 4.6315 },
  tremelo: { lat: 50.9897, lon: 4.6919 },
  aarschot: { lat: 50.984, lon: 4.8366 },
  diest: { lat: 50.9896, lon: 5.0511 },
  tienen: { lat: 50.8076, lon: 4.9372 },
  halle: { lat: 50.7337, lon: 4.2367 },
  asse: { lat: 50.9103, lon: 4.1986 },
  dilbeek: { lat: 50.8484, lon: 4.2594 },
  // Oost-Vlaanderen
  gent: { lat: 51.0543, lon: 3.7174 },
  gand: { lat: 51.0543, lon: 3.7174 },
  aalst: { lat: 50.9378, lon: 4.0409 },
  dendermonde: { lat: 51.0288, lon: 4.1012 },
  "sint-niklaas": { lat: 51.1655, lon: 4.1434 },
  lokeren: { lat: 51.1033, lon: 3.9917 },
  temse: { lat: 51.1263, lon: 4.2104 },
  wetteren: { lat: 51.0045, lon: 3.8818 },
  zele: { lat: 51.0658, lon: 4.0394 },
  hamme: { lat: 51.0963, lon: 4.1364 },
  ninove: { lat: 50.8296, lon: 4.0254 },
  oudenaarde: { lat: 50.8457, lon: 3.6039 },
  ronse: { lat: 50.7483, lon: 3.6006 },
  eeklo: { lat: 51.1859, lon: 3.5656 },
  deinze: { lat: 50.9824, lon: 3.5301 },
  zelzate: { lat: 51.1958, lon: 3.8104 },
  evergem: { lat: 51.1119, lon: 3.7098 },
  // West-Vlaanderen
  brugge: { lat: 51.2093, lon: 3.2247 },
  kortrijk: { lat: 50.8282, lon: 3.2649 },
  roeselare: { lat: 50.9447, lon: 3.1233 },
  oostende: { lat: 51.2154, lon: 2.9286 },
  ieper: { lat: 50.8512, lon: 2.8857 },
  waregem: { lat: 50.8858, lon: 3.4267 },
  izegem: { lat: 50.9175, lon: 3.2129 },
  tielt: { lat: 50.9995, lon: 3.3268 },
  zeebrugge: { lat: 51.3302, lon: 3.2048 },
  // Limburg
  hasselt: { lat: 50.9307, lon: 5.3378 },
  genk: { lat: 50.965, lon: 5.5004 },
  "sint-truiden": { lat: 50.8169, lon: 5.1865 },
  tongeren: { lat: 50.7804, lon: 5.4644 },
  beringen: { lat: 51.0477, lon: 5.2261 },
  "heusden-zolder": { lat: 51.0344, lon: 5.2792 },
  tessenderlo: { lat: 51.0667, lon: 5.0867 },
  maasmechelen: { lat: 50.9644, lon: 5.6946 },
  bilzen: { lat: 50.8733, lon: 5.5186 },
  "houthalen-helchteren": { lat: 51.0318, lon: 5.3744 },
  // Wallonië (beperkt)
  luik: { lat: 50.6326, lon: 5.5797 },
  liège: { lat: 50.6326, lon: 5.5797 },
  namen: { lat: 50.4674, lon: 4.8718 },
  namur: { lat: 50.4674, lon: 4.8718 },
  charleroi: { lat: 50.4108, lon: 4.4446 },
  bergen: { lat: 50.4542, lon: 3.9567 },
  mons: { lat: 50.4542, lon: 3.9567 },
  waver: { lat: 50.7175, lon: 4.6114 },
  wavre: { lat: 50.7175, lon: 4.6114 },
  nijvel: { lat: 50.5983, lon: 4.3283 },
  nivelles: { lat: 50.5983, lon: 4.3283 },
  // Provincies als centrum
  "provincie antwerpen": { lat: 51.2194, lon: 4.4025 },
  "vlaams-brabant": { lat: 50.88, lon: 4.6 },
  "oost-vlaanderen": { lat: 51.0543, lon: 3.7174 },
  "west-vlaanderen": { lat: 51.0, lon: 3.1 },
  limburg: { lat: 50.98, lon: 5.4 },
  vlaanderen: { lat: 51.0, lon: 4.3 },
  belgië: { lat: 50.85, lon: 4.35 },
  belgie: { lat: 50.85, lon: 4.35 },
  belgium: { lat: 50.85, lon: 4.35 },
};

const NAMES = Object.keys(CITIES).sort((a, b) => b.length - a.length);
/** Volledige Belgische lijst als aanvulling (enkel voor geocode, niet voor het herkennen van plaatsen in vrije tekst). */
const BE_NAMES = Object.keys(BE_PLACES)
  .filter((n) => !(n in CITIES))
  .sort((a, b) => b.length - a.length);

/** Zoek de eerste bekende plaatsnaam in een vrije locatietekst. */
export function geocode(text: string | null | undefined): GeoPoint | null {
  if (!text) return null;
  const t = ` ${text.toLowerCase().replace(/[(),/]/g, " ").replace(/\s+/g, " ")} `;
  for (const name of NAMES) {
    if (t.includes(` ${name} `) || t.includes(` ${name}-`) || t.includes(`-${name} `)) return CITIES[name];
  }
  for (const name of BE_NAMES) {
    if (t.includes(` ${name} `) || t.includes(` ${name}-`) || t.includes(`-${name} `)) {
      const [lat, lon] = BE_PLACES[name];
      return { lat, lon };
    }
  }
  // Postcode (bv. "2800 Mechelen" of enkel "2800").
  const pc = t.match(/ ([1-9]\d{3}) /)?.[1];
  if (pc && BE_POSTCODES[pc]) {
    const [lat, lon] = BE_POSTCODES[pc];
    return { lat, lon };
  }
  return null;
}

/** De eerste bekende Belgische plaatsnaam in een tekst, met hoofdletter, of null. */
export function findPlaceName(text: string | null | undefined): string | null {
  if (!text) return null;
  const t = ` ${text.toLowerCase().replace(/[(),/|]/g, " ").replace(/\s+/g, " ")} `;
  for (const name of NAMES) {
    if (/^(belgi|belgium|vlaanderen|limburg|oost-vlaanderen|west-vlaanderen|antwerpen-provincie)/.test(name)) continue;
    if (t.includes(` ${name} `) || t.includes(` ${name}-`) || t.includes(`-${name} `)) return name.replace(/(^|[-\s])\p{L}/gu, (m) => m.toUpperCase());
  }
  return null;
}

export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLon = ((b.lon - a.lon) * Math.PI) / 180;
  const la1 = (a.lat * Math.PI) / 180;
  const la2 = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Valt een locatie binnen de straal rond de regio? Onbekende locaties geven
 * `null` (niet beslisbaar) zodat de aanroeper ze kan behouden.
 */
export function withinRadius(location: string | null | undefined, region: string, radiusKm: number): boolean | null {
  const center = geocode(region);
  if (!center) return null;
  // Land- en gewestniveau ("België", "Vlaanderen") is geen plaats: onbeslisbaar.
  if (/(^|[^a-z])(belgi[eë]|belgium|vlaanderen|flanders|walloni[eë]|nationaal|heel het land)(?![a-z])/i.test(location ?? "")) return null;
  const p = geocode(location);
  if (!p) return null;
  return distanceKm(center, p) <= radiusKm;
}

/** Middelpunt van de regio: eerst de eigen gemeentelijst, anders de coördinaten uit het profiel (AI), anders null. */
export function regionCenter(p: { region: string; region_lat?: number; region_lng?: number }): GeoPoint | null {
  const known = geocode(p.region);
  if (known) return known;
  const lat = p.region_lat ?? 0;
  const lon = p.region_lng ?? 0;
  // Enkel plausibele Belgische coördinaten aanvaarden.
  if (lat > 49.4 && lat < 51.6 && lon > 2.4 && lon < 6.5) return { lat, lon };
  return null;
}

/** Afstand in km van een punt tot het regiomiddelpunt, of null als een van beide onbekend is. */
export function distanceFromCenter(center: GeoPoint | null, point: GeoPoint | null): number | null {
  if (!center || !point) return null;
  return Math.round(distanceKm(center, point));
}

/**
 * Binnen de straal rond het profiel? true/false als beslisbaar, null als de plaats of het middelpunt onbekend is.
 * Gebruikt de eigen gemeentelijst én de coördinaten uit het profiel.
 */
export function withinProfileRadius(
  location: string | null | undefined,
  p: { region: string; radius_km: number; region_lat?: number; region_lng?: number },
): boolean | null {
  if (/(^|[^a-z])(belgi[eë]|belgium|vlaanderen|flanders|walloni[eë]|nationaal|heel het land)(?![a-z])/i.test(location ?? "")) return null;
  const center = regionCenter(p);
  const point = geocode(location);
  if (!center || !point) return null;
  return distanceKm(center, point) <= p.radius_km;
}

/** Belgische postcode (4 cijfers) uit een locatietekst halen, voor weergave en normalisatie. */
export function extractPostcode(text: string | null | undefined): string | null {
  const m = (text ?? "").match(/\b([1-9]\d{3})\b/);
  return m ? m[1] : null;
}

/** Strikte variant: onbeslisbaar telt als buiten de regio. Voor jobboards, waar een plaats altijd vermeld hoort te staan. */
export function strictlyWithinRadius(location: string | null | undefined, region: string, radiusKm: number): boolean {
  return withinRadius(location, region, radiusKm) === true;
}
