/**
 * Kantorenkaart, deel 1: zuivere logica zonder database of netwerk.
 * Merk en soort kantoor afleiden uit naam en Google-categorie, ontdubbelen, namen vergelijken.
 */
import { BE_POSTCODES, BE_ZIP_NAMES } from "@/lib/geo-be";
import type { GeoPoint } from "@/lib/geo";

export type OfficeSector = "bank" | "verzekeringen";
export type OfficeKind = "bankkantoor" | "verzekeringsmakelaar" | "verzekeringsagent" | "financieel-adviseur" | "onbekend";

/** Bankmerken in Vlaanderen. Volgorde: specifiek vóór algemeen (bv. "KBC Brussels" vóór "KBC"). */
const BANK_BRANDS: [RegExp, string][] = [
  [/\bbnp\s*paribas\s*fortis\b|\bfortis\b/i, "BNP Paribas Fortis"],
  [/\bfintro\b/i, "Fintro"],
  [/\bhello\s*bank\b/i, "Hello bank!"],
  [/\bkbc\b/i, "KBC"],
  [/\bcbc\b/i, "CBC"],
  [/\bbelfius\b/i, "Belfius"],
  [/\bing\b/i, "ING"],
  [/\bargenta\b/i, "Argenta"],
  [/\bcrelan\b/i, "Crelan"],
  [/\baxa\s*bank\b/i, "AXA Bank"],
  [/\bbeobank\b/i, "Beobank"],
  [/\bbpost\s*bank\b|\bbank\s*van\s*de\s*post\b/i, "bpost bank"],
  [/\bvdk\b/i, "vdk bank"],
  [/\bnagelmackers\b/i, "Nagelmackers"],
  [/\bdeutsche\s*bank\b/i, "Deutsche Bank"],
  [/\beuropabank\b/i, "Europabank"],
  [/\btriodos\b/i, "Triodos"],
  [/\bdelen\b/i, "Delen Private Bank"],
  [/\bvan\s*lanschot\b/i, "Van Lanschot"],
  [/\bdegroof\s*petercam\b/i, "Degroof Petercam"],
  [/\bbank\s*j\.?\s*van\s*breda\b|\bvan\s*breda\b/i, "Bank Van Breda"],
  [/\bkeytrade\b/i, "Keytrade Bank"],
  [/\baion\b/i, "Aion Bank"],
  [/\bcph\b/i, "CPH"],
];

/** Verzekeraars waarvan kantoren onder een merknaam werken (agenten). Een makelaar heeft geen merk. */
const INSURER_BRANDS: [RegExp, string][] = [
  [/\bag\s*insurance\b/i, "AG Insurance"],
  [/\baxa\b/i, "AXA"],
  [/\ballianz\b/i, "Allianz"],
  [/\bbaloise\b|\bfidea\b/i, "Baloise"],
  [/\bethias\b/i, "Ethias"],
  [/\bdvv\b/i, "DVV"],
  [/\bp&v\b|\bp\s*&\s*v\b/i, "P&V"],
  [/\bvivium\b/i, "Vivium"],
  [/\bnn\s*(insurance|verzekeringen)?\b/i, "NN"],
  [/\bathora\b|\bgenerali\b/i, "Athora"],
  [/\bfederale\s*verzekering\b/i, "Federale Verzekering"],
  [/\bcorona\s*direct\b/i, "Corona Direct"],
  [/\byuzzu\b/i, "Yuzzu"],
  [/\bkbc\s*verzekeringen\b/i, "KBC Verzekeringen"],
  [/\bargenta\b/i, "Argenta"],
  [/\bcrelan\b/i, "Crelan"],
  [/\bbelfius\b/i, "Belfius"],
  [/\bing\b/i, "ING"],
  [/\bbnp\s*paribas\s*fortis\b|\bfortis\b|\bfintro\b/i, "BNP Paribas Fortis"],
];

export function detectBrand(name: string, sector: OfficeSector): string | null {
  const list = sector === "bank" ? BANK_BRANDS : INSURER_BRANDS;
  for (const [re, brand] of list) if (re.test(name)) return brand;
  return null;
}

/** Hoort deze Google Maps-vestiging bij de sector? Op categorie en naam; alles wat duidelijk iets anders is valt weg. */
export function classify(name: string, category: string | null | undefined): { sector: OfficeSector; kind: OfficeKind } | null {
  const c = (category ?? "").toLowerCase();
  const n = name.toLowerCase();
  const bankCat = /\b(bank|banque|spaarbank|geldautomaat|atm|kredietinstelling|financi[eë]le instelling|financial institution)\b/.test(c);
  const insCat = /(verzekering|assurance|insurance|makelaar|courtier|broker)/.test(c);
  const bankName = /\b(bank|banque|bankkantoor|bankagent|kantoor kbc|kbc|belfius|ing|argenta|crelan|fintro|bnp|fortis|beobank|vdk|nagelmackers|cbc|bpost bank)\b/.test(n);
  const insName = /(verzeker|assur|insurance|makelaar|courtier|broker|zekerheden|polis)/.test(n);
  // Geldautomaten, wisselkantoren en consumentenkrediet zijn geen kantoren waar men aanwerft.
  if (/(atm|geldautomaat|cash point|bancontact|wisselkantoor|exchange|pandjes|lening|krediet)/.test(c) && !bankCat) return null;
  if (/\b(atm|geldautomaat|cash ?point|self.?bank|bankautomaat)\b/.test(n)) return null;
  // Een duidelijke andere categorie (bakkerij, kapper, …) wint van een toevallig woord in de naam.
  const finCat = bankCat || insCat || /(financ|krediet|hypothe|vermogen|belegg|pensioen|fiscal|boekhoud|accountan)/.test(c);
  if (c && !finCat) return null;
  const isIns = insCat || insName;
  const isBank = (bankCat || bankName) && !(insCat && !bankCat && !bankName);
  if (isIns && !(bankCat || (bankName && !insName))) {
    const agent = /(agent|kantoor\s+(axa|ag|allianz|baloise|dvv|p&v|vivium|nn)|\b(axa|ag insurance|allianz|baloise|dvv|p&v|vivium|ethias|nn)\b)/.test(n) || /(agent)/.test(c);
    return { sector: "verzekeringen", kind: agent ? "verzekeringsagent" : "verzekeringsmakelaar" };
  }
  if (isBank) return { sector: "bank", kind: "bankkantoor" };
  if (/(financi[eë]le? (dienst|advies|planning)|financial (advisor|planner|consultant)|vermogensbeheer|beleggingsadvies|kredietbemiddel)/.test(c + " " + n)) return { sector: "bank", kind: "financieel-adviseur" };
  return null;
}

/** Postcode en gemeente uit een Google Maps-adres ("Grote Markt 1, 2800 Mechelen, België"). */
export function splitAddress(address: string | null | undefined): { postcode: string | null; municipality: string | null } {
  const m = (address ?? "").match(/\b([1-9]\d{3})\s+([^,]+?)\s*(,|$)/);
  if (!m) return { postcode: null, municipality: null };
  return { postcode: m[1], municipality: m[2].trim().replace(/\s+belgi[eë]$/i, "") || null };
}

/** Coördinaten van een postcode (middelpunt), voor kantoren uit registers zonder exacte ligging. */
export function postcodeCenter(postcode: string | null | undefined): GeoPoint | null {
  if (!postcode || !BE_POSTCODES[postcode]) return null;
  const [lat, lon] = BE_POSTCODES[postcode];
  return { lat, lon };
}

export function postcodeName(postcode: string | null | undefined): string | null {
  return postcode ? (BE_ZIP_NAMES[postcode] ?? null) : null;
}

/** Vlaamse postcodes: 1500–3999 en 8000–9999. Brussel (1000–1299) en Waals-Brabant (1300–1499) horen er niet bij. */
export function isFlemishPostcode(postcode: string | null | undefined): boolean {
  const n = Number(postcode);
  return Number.isFinite(n) && ((n >= 1500 && n <= 3999) || (n >= 8000 && n <= 9999));
}

const STOP = new Set(["nv", "bv", "bvba", "sa", "srl", "sprl", "cvba", "vof", "comm", "verzekeringen", "verzekering", "assurances", "assurance", "insurance", "kantoor", "makelaar", "makelaars", "groep", "group", "en", "de", "het", "van", "der", "bank", "agentschap", "agent", "zelfstandig", "zelfstandige", "financieel", "advies", "office", "the", "and"]);

export function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3 && !STOP.has(t));
}

/** Zelfde kantoor? Minstens één betekenisvol naamwoord gemeenschappelijk en (als beide bekend) dezelfde postcode. */
export function sameOffice(a: { name: string; postcode: string | null }, b: { name: string; postcode: string | null }): boolean {
  if (a.postcode && b.postcode && a.postcode !== b.postcode) return false;
  const ta = nameTokens(a.name);
  const tb = new Set(nameTokens(b.name));
  if (!ta.length || !tb.size) return false;
  const common = ta.filter((t) => tb.has(t)).length;
  // Eén gemeenschappelijk woord volstaat bij korte namen; bij langere namen de helft.
  return common >= Math.max(1, Math.ceil(Math.min(ta.length, tb.size) / 2));
}

/** Ontdubbelsleutel: Google-cid, anders ondernemingsnummer, anders naam + postcode. */
export function officeKey(o: { cid?: string | null; enterpriseNumber?: string | null; name: string; postcode: string | null }): string {
  if (o.cid) return `cid:${o.cid}`;
  if (o.enterpriseNumber) return `kbo:${o.enterpriseNumber}`;
  return `naam:${nameTokens(o.name).join("-") || o.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}:${o.postcode ?? "0000"}`;
}

/** Zoekopdrachten voor Google Maps per gemeente, per sector. Kort en concreet: zo geeft Maps vestigingen, geen artikels. */
export const MAPS_QUERIES: Record<OfficeSector, string[]> = {
  bank: ["bankkantoor", "bank"],
  verzekeringen: ["verzekeringsmakelaar", "verzekeringskantoor", "verzekeringen"],
};

/**
 * Gegevens van één vestiging uit een vrije tekst (bv. een profielpagina op vindeenverzekeringsmakelaar.be):
 * eerst JSON-LD (LocalBusiness/InsuranceAgency), anders de eerste "straat nr, 1234 Gemeente"-regel.
 */
export type ParsedListing = { name: string; address: string | null; postcode: string | null; municipality: string | null; phone: string | null; email?: string | null; website: string | null; enterpriseNumber: string | null; fsmaNumber: string | null; lat?: number | null; lng?: number | null };

export function parseListingFromHtml(html: string, fallbackTitle: string): ParsedListing | null {
  const ld = [...html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
  for (const raw of ld) {
    try {
      const data = JSON.parse(raw) as unknown;
      const items = Array.isArray(data) ? data : [data];
      for (const it of items) {
        const o = (it && typeof it === "object" ? it : {}) as Record<string, unknown>;
        const type = String(o["@type"] ?? "");
        if (!/(LocalBusiness|InsuranceAgency|FinancialService|Organization)/i.test(type)) continue;
        const addr = (o.address && typeof o.address === "object" ? o.address : {}) as Record<string, unknown>;
        const street = String(addr.streetAddress ?? "").trim();
        const postcode = String(addr.postalCode ?? "").match(/\d{4}/)?.[0] ?? null;
        const municipality = String(addr.addressLocality ?? "").trim() || null;
        const name = String(o.name ?? fallbackTitle).trim();
        if (!name) continue;
        return {
          name,
          address: [street, [postcode, municipality].filter(Boolean).join(" ")].filter(Boolean).join(", ") || null,
          postcode,
          municipality,
          phone: String(o.telephone ?? "").trim() || null,
          website: String(o.url ?? "").match(/^https?:\/\/\S+/)?.[0] ?? null,
          enterpriseNumber: null,
          fsmaNumber: null,
        };
      }
    } catch {
      /* geen geldige JSON-LD; verder met de tekst */
    }
  }
  // Microdata/RDFa (itemprop of property) en Drupal-adresvelden (address-line1-element, postal-code-element, locality-element).
  const attr = (names: string[]): string | null => {
    for (const n of names) {
      const m =
        html.match(new RegExp(`(?:itemprop|property)=["']${n}["'][^>]*content=["']([^"']+)["']`, "i")) ??
        html.match(new RegExp(`(?:itemprop|property)=["']${n}["'][^>]*>([^<]{1,160})<`, "i")) ??
        html.match(new RegExp(`class=["'][^"']*\\b${n}\\b[^"']*["'][^>]*>([^<]{1,160})<`, "i"));
      if (m?.[1]?.trim()) return decode(m[1]);
    }
    return null;
  };
  const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#0?39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, " ").trim();
  const ogTitle = html.match(/property=["']og:title["'][^>]*content=["']([^"']+)["']/i)?.[1];
  const lat = Number(html.match(/(?:property|itemprop)=["']latitude["'][^>]*content=["']([-\d.]+)["']/i)?.[1] ?? html.match(/data-lat=["']([-\d.]+)["']/i)?.[1]);
  const lng = Number(html.match(/(?:property|itemprop)=["']longitude["'][^>]*content=["']([-\d.]+)["']/i)?.[1] ?? html.match(/data-lng=["']([-\d.]+)["']/i)?.[1]);
  const geo = Number.isFinite(lat) && Number.isFinite(lng) && lat > 49 && lat < 52 && lng > 2 && lng < 7 ? { lat, lng } : {};
  const street = attr(["streetAddress", "address-line1-element"]);
  const pc = (attr(["postalCode", "postal-code-element"]) ?? html.match(/data-[a-z]*zipcode=["'](\d{4})["']/i)?.[1] ?? "").match(/\d{4}/)?.[0] ?? null;
  const city = attr(["addressLocality", "locality-element"]) ?? html.match(/data-[a-z]*city=["']([^"']+)["']/i)?.[1] ?? null;
  const emailAny = html.match(/mailto:([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i)?.[1]?.toLowerCase() ?? null;
  if (street && pc) {
    return {
      name: decode(ogTitle ?? fallbackTitle).split("|")[0].trim(),
      address: `${street}, ${pc}${city ? ` ${titleCase(city)}` : ""}`,
      postcode: pc,
      municipality: city ? titleCase(city) : null,
      phone: attr(["telephone"]) ?? html.match(/href=["']tel:([^"']+)["']/i)?.[1]?.replace(/[^\d+ /.-]/g, "").trim() ?? null,
      email: emailAny,
      website: null,
      enterpriseNumber: null,
      fsmaNumber: null,
      ...geo,
    };
  }
  // og:description, bv. "LINDENLAAN 50 0001, 9940 ERTVELDE | +32 9 344 65 53 | Ertvelde@argenta.be" (Argenta).
  const og = html.match(/property=["']og:description["'][^>]*content=["']([^"']+)["']/i)?.[1];
  if (og) {
    const p = parseListingFromText(decode(og).replace(/\s*\|\s*/g, "\n"), decode(ogTitle ?? fallbackTitle));
    if (p) return { ...p, email: p.email ?? emailAny, ...geo };
  }
  const text = html
    .replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/[ \t]+/g, " ");
  const p = parseListingFromText(text, decode(ogTitle ?? fallbackTitle));
  return p ? { ...p, email: p.email ?? emailAny, ...geo } : null;
}

/** "LINDENLAAN 50" of "OOSTENDE" in hoofdletters wordt "Lindenlaan 50" en "Oostende"; gemengde tekst blijft zoals ze is. */
export function titleCase(s: string): string {
  if (s !== s.toUpperCase() || !/[A-Z]/.test(s)) return s;
  return s.toLowerCase().replace(/(^|[\s\-'/(])\p{L}/gu, (m) => m.toUpperCase()).replace(/\b(Bv|Bvba|Nv|Cv|Vof)\b/g, (m) => m.toUpperCase());
}

export function parseListingFromText(text: string, fallbackTitle: string): ParsedListing | null {
  const addr = text.match(/([A-Z][\p{L}'\-. ]{2,60}?\s\d{1,4}[a-zA-Z]?(?:\s?(?:bus|b|\/)\s?\w+)?(?:\s\d{1,4})?)\s*[,\n]\s*([1-9]\d{3})\s+([\p{L}\-' ]{2,40}?)(?=[\s,.\n|]|$)/u);
  if (!addr) return null;
  const email = text.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i)?.[0]?.toLowerCase() ?? null;
  const fsma = text.match(/\bFSMA\b[^0-9]{0,20}(\d{4,6})\s*([A-Za-z-]{1,6})?/i);
  const kbo = text.match(/\b(?:BE\s?)?0\d{3}[. ]?\d{3}[. ]?\d{3}\b/);
  const phone = text.match(/(?:\+32|0)\s?\d(?:[\s./-]?\d){7,8}\b/);
  const site = text.match(/https?:\/\/(?!www\.vindeenverzekeringsmakelaar\.be)[\w.-]+\.[a-z]{2,}[^\s"'<>]*/i);
  const title = fallbackTitle.replace(/\s*[|\-–]\s*(vind ?een ?verzekeringsmakelaar.*|fvf.*)$/i, "").trim();
  return {
    name: titleCase(title) || titleCase(addr[1].trim()),
    address: `${titleCase(addr[1].trim())}, ${addr[2]} ${titleCase(addr[3].trim())}`,
    postcode: addr[2],
    municipality: titleCase(addr[3].trim()),
    phone: phone?.[0]?.trim() ?? null,
    email,
    website: site?.[0] ?? null,
    enterpriseNumber: kbo ? kbo[0].replace(/[^0-9]/g, "") : null,
    fsmaNumber: fsma ? `${fsma[1]}${fsma[2] ? ` ${fsma[2]}` : ""}` : null,
  };
}
