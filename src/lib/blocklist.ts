/**
 * Domeinen die nooit als "bedrijf" mogen tellen bij bedrijfsontdekking:
 * jobboards, interimkantoren, aggregators, sociale media, overheid, pers.
 * Vergelijking gebeurt op het geregistreerde domein (zonder subdomein).
 */
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
  // Interim en selectiekantoren
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
  "selor.be",
  "werkenvoor.be",
  "jobpunt.be",
  "poolstok.be",
  "flexpoint.be",
  "stepstone.com",
  "profilegroup.com",
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
const BLOCKED_FRAGMENTS = ["interim", "jobs", "vacature", "job-", "jobboard", "recruit", "uitzend", "talent"];

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
