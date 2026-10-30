/**
 * Domeinen die nooit als "bedrijf" mogen tellen bij bedrijfsontdekking:
 * jobboards, interimkantoren, aggregators, sociale media, overheid, pers.
 * Vergelijking gebeurt op het geregistreerde domein (zonder subdomein).
 */
/**
 * Interim-, uitzend-, selectie-, recruitment- en HR-dienstverleners: echte tussenpersonen.
 * Let op: jobboards en ATS-platformen staan hier NIET in. Een vacature op VDAB, Jooble of Recruitee
 * kan perfect van een rechtstreekse werkgever zijn; die domeinen blokkeren we enkel bij bedrijfsontdekking.
 */
const AGENCY_LIST = [
  "randstad.be",
  "tempo-team.be",
  "adecco.be",
  "manpower.be",
  "startpeople.be",
  "accentjobs.be",
  "asap.be",
  "synergiejobs.be",
  "unique.be",
  "konvert.be",
  "agilitas.be",
  "actief.be",
  "actiefinterim.be",
  "vivaldisinterim.be",
  "vivaldis.be",
  "hays.be",
  "roberthalf.be",
  "roberthalf.com",
  "michaelpage.be",
  "pagepersonnel.be",
  "hudson.be",
  "hudsonsolutions.com",
  "daoust.be",
  "trixxo.be",
  "forumjobs.be",
  "jobfixers.be",
  "itzu.eu",
  "itzujobs.be",
  "t-interim.be",
  "aquilaconsulting.be",
  "express.be",
  "impactjobs.be",
  "bright-plus.be",
  "brightplus.be",
  "walters.be",
  "robertwalters.com",
  "sdworx.be",
  "sdworx.com",
  "acerta.be",
  "securex.be",
  "liantis.be",
  "partena-professional.be",
  "talentus.be",
  "wearepeople.be",
  "poolstok.be",
  "flexpoint.be",
  "profilegroup.com",
];
export const AGENCY_DOMAINS = new Set<string>(AGENCY_LIST);

export const BLOCKED_DOMAINS = new Set<string>([
  // Jobboards en aggregators
  "vdab.be",
  "indeed.com",
  "be.indeed.com",
  "linkedin.com",
  "glassdoor.com",
  "glassdoor.be",
  "jobat.be",
  "stepstone.be",
  "monster.be",
  "monster.com",
  "adzuna.be",
  "adzuna.com",
  "jooble.org",
  "be.jooble.org",
  "talent.com",
  "jobrapido.com",
  "neuvoo.be",
  "careerjet.be",
  "optioncarriere.be",
  "jobsora.com",
  "kariera.group",
  "jobijoba.be",
  "trabajo.org",
  "vacature.com",
  "jobsinbrussels.com",
  "references.be",
  "regiotalent.be",
  "jobsregio.be",
  "jobmatch.be",
  "werkzoeken.nl",
  "nationalevacaturebank.nl",
  "mijnjobsite.be",
  "ictjob.be",
  "ictjobs.be",
  "jobfinder.be",
  "jobsindustrie.be",
  "technicaljobs.be",
  "creativeskills.be",
  "jobsinlogistics.be",
  "jobs.be",
  "jobserve.com",
  "simplyhired.com",
  "ziprecruiter.com",
  "kununu.com",
  "welcometothejungle.com",
  "otys.com",
  "hiring.cafe",
  "jobtoolz.com",
  "recruitee.com",
  "teamtailor.com",
  "workable.com",
  "smartrecruiters.com",
  "greenhouse.io",
  "lever.co",
  "personio.de",
  "personio.com",
  "talentfinder.be",
  "jobsoid.com",
  "homerun.co",
  "join.com",
  "softgarden.io",
  "successfactors.com",
  "myworkdayjobs.com",
  "icims.com",
  "selor.be",
  "werkenvoor.be",
  "jobpunt.be",
  "stepstone.com",
  ...AGENCY_LIST,
  // Sociaal, pers, naslag, overheid
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "youtube.com",
  "tiktok.com",
  "wikipedia.org",
  "wikidata.org",
  "google.com",
  "google.be",
  "bing.com",
  "reddit.com",
  "quora.com",
  "hln.be",
  "nieuwsblad.be",
  "standaard.be",
  "tijd.be",
  "demorgen.be",
  "gva.be",
  "hbvl.be",
  "vrt.be",
  "knack.be",
  "trends.be",
  "madeinantwerpen.be",
  "made-in.be",
  "voka.be",
  "unizo.be",
  "agoria.be",
  "essenscia.be",
  "belgium.be",
  "vlaanderen.be",
  "europa.eu",
  "statbel.fgov.be",
  "kbo.be",
  "trendstop.be",
  "companyweb.be",
  "goldenpages.be",
  "goudengids.be",
  "pagesdor.be",
  "openthebox.be",
  "bizzy.org",
  "yelp.com",
  "mapcarta.com",
  "cylex.be",
  "cylex-belgie.be",
  "infobel.com",
  "europages.com",
  "kompass.com",
  "ensun.io",
  "dnb.com",
  "zoominfo.com",
  "crunchbase.com",
  "bloomberg.com",
  "amazon.com",
  "bol.com",
]);

/** Fragmenten die op een jobboard, interimkantoor of aggregator wijzen. */
const BLOCKED_FRAGMENTS = ["interim", "jobs", "vacature", "job-", "jobboard", "recruit", "uitzend", "talent", "staffing", "headhunt", "werving", "selectie", "consultancy", "consulting", "detacher", "outsourc", "payroll", "hr-", "hrservices"];

/**
 * Tussenpersonen herkennen aan hun eigen homepage: recruitment-, interim-, consultancy-,
 * detacherings- en outsourcingbedrijven zijn geen werkgevers voor onze kandidaten.
 * Sterke signalen in de titel volstaan; in de bodytekst vragen we er minstens twee.
 */
const INTERMEDIARY_STRONG = /\b(recruitment|recruiting|rekrutering|werving\s*(en|&)\s*selectie|headhunt\w*|executive search|interim(kantoor|bureau)?|uitzend\w*|staffing|detachering|outsourcing|hr[- ]?(consultancy|consulting|dienstverlen\w+|partner)|consultancy|consulting|payroll\w*|sourcing partner|selectiekantoor|talent acquisition)\b/i;

/**
 * Werkgever uit een officieel register (bv. FSMA-verzekeringsmakelaar): een gereglementeerde eindwerkgever.
 * Zijn naam of homepage ("X Consulting", "verzekeringsbemiddeling") mag hem nooit als HR-tussenpersoon laten wegvallen.
 */
export function isTrustedEmployer(j: { raw?: unknown } | null | undefined): boolean {
  return Boolean(((j?.raw ?? {}) as { trustedEmployer?: boolean }).trustedEmployer);
}

/** Bedrijfsnaam of vacature-url van een tussenpersoon (interim, recruitment, consultancy, detachering)? */
/** Merknamen van bekende kantoren, afgeleid uit hun domein (randstad, adecco, tempoteam, …). */
const AGENCY_BRANDS = Array.from(
  new Set(AGENCY_LIST.map((d) => d.split(".")[0].replace(/[^a-z0-9]/g, "")).filter((b) => b.length >= 5 && !["express", "unique", "actief", "people"].includes(b))),
);

export function isIntermediaryCompany(name: string | null | undefined, url?: string | null): boolean {
  if (name && INTERMEDIARY_STRONG.test(name)) return true;
  const compact = (name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact && AGENCY_BRANDS.some((b) => compact === b || compact.startsWith(b))) return true;
  if (name && /\b(interim|jobs|staffing|select|recruit|consult|talent|people|hr)\b/i.test(name) && /\b(group|groep|partners?|solutions?|services?|office|bureau|kantoor|agency)\b/i.test(name)) return true;
  // Enkel domeinen van tussenpersonen; een jobboard of ATS-platform zegt niets over de werkgever.
  if (url && isAgencyDomain(url)) return true;
  return false;
}

/** Fragmenten in een domeinnaam die op een tussenpersoon wijzen (niet: "jobs", "vacature", "talent"). */
const AGENCY_FRAGMENTS = ["interim", "uitzend", "staffing", "headhunt", "werving", "recruit", "detacher", "outsourc", "payroll"];

/** Domein van een interim-, selectie- of recruitmentkantoor? Jobboards en ATS-platformen niet. */
export function isAgencyDomain(domainOrUrl: string): boolean {
  const d = registrableDomain(domainOrUrl);
  if (!d) return false;
  if (AGENCY_DOMAINS.has(d)) return true;
  // Bekende jobboards/ATS met een verdacht woord in de naam (bv. regiotalent) zijn geen bureau.
  if (BLOCKED_DOMAINS.has(d) && !AGENCY_DOMAINS.has(d)) return false;
  const label = d.split(".")[0];
  return AGENCY_FRAGMENTS.some((f) => label.includes(f));
}

export function looksLikeIntermediary(title: string, text: string): { yes: boolean; reason?: string } {
  const t = title.toLowerCase();
  const strongInTitle = t.match(INTERMEDIARY_STRONG);
  if (strongInTitle) return { yes: true, reason: `titel: "${strongInTitle[0]}"` };
  const body = text.slice(0, 4000);
  const hits = new Set<string>();
  for (const m of body.matchAll(new RegExp(INTERMEDIARY_STRONG.source, "gi"))) hits.add(m[0].toLowerCase());
  if (hits.size >= 2) return { yes: true, reason: `homepage: ${[...hits].slice(0, 3).join(", ")}` };
  return { yes: false };
}

/** Haal het registreerbare domein uit een URL of hostnaam (grof: laatste twee labels, met uitzondering van .co.uk e.d.). */
export function registrableDomain(input: string): string | null {
  let host = input.trim().toLowerCase();
  try {
    if (!/^https?:\/\//.test(host)) host = `https://${host}`;
    host = new URL(host).hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "");
  const parts = host.split(".").filter(Boolean);
  if (parts.length < 2) return null;
  const secondLevel = new Set(["co", "com", "org", "net", "gov", "ac"]);
  if (parts.length >= 3 && secondLevel.has(parts[parts.length - 2]) && parts[parts.length - 1].length === 2) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

export function isBlockedDomain(domainOrUrl: string): boolean {
  const d = registrableDomain(domainOrUrl);
  if (!d) return true;
  if (BLOCKED_DOMAINS.has(d)) return true;
  let host = domainOrUrl.toLowerCase();
  try {
    host = new URL(/^https?:\/\//.test(host) ? host : `https://${host}`).hostname;
  } catch {
    /* laat host zoals hij is */
  }
  if (BLOCKED_DOMAINS.has(host.replace(/^www\./, ""))) return true;
  const label = d.split(".")[0];
  return BLOCKED_FRAGMENTS.some((f) => label.includes(f));
}
