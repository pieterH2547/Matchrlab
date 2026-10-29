/**
 * Vacatureverificatie vóór de eindscoring. Een HTTP 200 alleen volstaat niet:
 * de pagina moet de vacature nog tonen en mag niet melden dat ze afgesloten is.
 * Kan het niet betrouwbaar vastgesteld worden, dan 'niet geverifieerd' (nooit stilzwijgend 'actief').
 */
import { fetchPage } from "@/lib/fetch";
import { freshVerification } from "./index-cache";

export type VerificationStatus = "actief" | "gesloten" | "niet geverifieerd";
export type Verification = { status: VerificationStatus; reason: string };

/** Meldingen dat een vacature niet meer open is (NL/FR/EN). */
export const CLOSED_MARKERS =
  /(vacature (is )?(niet meer|niet langer) (beschikbaar|actief|open)|deze vacature is (afgesloten|verlopen|ingevuld|gesloten)|vacature (werd|is) (afgesloten|ingevuld)|solliciteren is niet meer mogelijk|no longer (available|accepting applications|open)|this (job|position|vacancy) (has expired|is closed|is no longer)|position (has been )?filled|job (has )?expired|offre (n'est plus disponible|expirée|clôturée)|cette offre n'est plus)/i;

/** Bronnen die we volgens hun voorwaarden niet opvragen; enkel het zoekresultaat telt. */
export const NO_FETCH = /(^|\.)(linkedin\.com|indeed\.[a-z.]+)(\/|$)/i;

type JobLike = { url: string; title: string; source: string; raw?: unknown; lastSeenAt?: Date | string | null; verifiedAt?: Date | string | null; verificationStatus?: string | null; verificationReason?: string | null };

function significantWords(title: string): string[] {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9à-ÿ ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !/^(voor|with|deze|onze|jouw|team|regio|full|time|part)$/.test(w));
}

/** Beoordeel een al opgehaalde pagina. Puur, zonder netwerk: makkelijk te testen. */
export function judgePage(job: { url: string; title: string }, page: { status: number; finalUrl: string; text: string }): Verification {
  if (page.status === 404 || page.status === 410) return { status: "gesloten", reason: `pagina bestaat niet meer (HTTP ${page.status})` };
  if (page.status === 0) return { status: "niet geverifieerd", reason: "pagina niet bereikbaar" };
  if (page.status >= 400) return { status: "niet geverifieerd", reason: `pagina weigert controle (HTTP ${page.status})` };
  const text = page.text.slice(0, 20_000);
  if (CLOSED_MARKERS.test(text)) return { status: "gesloten", reason: "pagina meldt dat de vacature afgesloten is" };
  try {
    const from = new URL(job.url);
    const to = new URL(page.finalUrl || job.url);
    const shallow = to.pathname.split("/").filter(Boolean).length <= 1;
    // Enkel binnen dezelfde site: een doorverwijzing naar een andere site (tracking-, apply- of jobboardlink) is normaal.
    if (from.hostname === to.hostname && from.pathname !== to.pathname && (shallow || /search|zoek|recherche/i.test(to.pathname))) {
      return { status: "gesloten", reason: "doorverwezen naar een algemene pagina; vacature lijkt weg" };
    }
  } catch {
    /* ongeldige url: verder met de inhoud */
  }
  const words = significantWords(job.title);
  const low = text.toLowerCase();
  const hits = words.filter((w) => low.includes(w)).length;
  const looksLikeJob = /(solliciteer|sollicit|apply|postuler|functieomschrijving|jouw profiel|je profiel|wij bieden|we bieden|taken|vereisten|requirements)/i.test(text);
  if (words.length && hits / words.length >= 0.5 && looksLikeJob) return { status: "actief", reason: "vacaturepagina bereikbaar; titel en vacature-inhoud gevonden" };
  if (text.length < 300) return { status: "niet geverifieerd", reason: "pagina laadt via JavaScript; inhoud niet leesbaar" };
  return { status: "niet geverifieerd", reason: "pagina bereikbaar, maar de vacature werd er niet in herkend" };
}

/**
 * Actief enkel als Matchr de vacature in DEZE run zelf op de jobpagina of ATS-feed van de werkgever zag.
 * Eerder opgeslagen (uit een vorige run) is niet hetzelfde als nu bevestigd: dan controleren we de pagina.
 */
export function confirmedThisRun(job: JobLike, runStartedAt: number | null): Verification | null {
  if (job.source !== "company_site" || runStartedAt === null) return null;
  const seen = job.lastSeenAt ? new Date(job.lastSeenAt).getTime() : 0;
  if (seen < runStartedAt) return null;
  const via = ((job.raw ?? {}) as { via?: string }).via;
  return via === "ats-feed"
    ? { status: "actief", reason: "staat nu op de publieke ATS-feed van de werkgever" }
    : { status: "actief", reason: "nu op de jobpagina van de werkgever gezien" };
}

export async function verifyJob(job: JobLike, runStartedAt: number | null = null): Promise<Verification> {
  const now = confirmedThisRun(job, runStartedAt);
  if (now) return now;
  // Vacature-index: recent (< 24 u) gecontroleerd = hergebruiken, met het tijdstip erbij. Ouder = opnieuw.
  const fresh = freshVerification(job);
  if (fresh) return fresh;
  let host = "";
  try {
    host = new URL(job.url).hostname;
  } catch {
    return { status: "niet geverifieerd", reason: "ongeldige link" };
  }
  if (NO_FETCH.test(host)) return { status: "niet geverifieerd", reason: "LinkedIn/Indeed: enkel het zoekresultaat, pagina niet gecontroleerd" };
  const page = await fetchPage(job.url, { allowJina: false, noCache: true }).catch(() => null);
  if (!page) return { status: "niet geverifieerd", reason: "pagina niet bereikbaar" };
  return judgePage(job, page);
}

/** Verifieer een lijst met begrensde gelijktijdigheid. */
export async function verifyMany<T extends JobLike & { id: number }>(jobs: T[], concurrency = 8, runStartedAt: number | null = null): Promise<Map<number, Verification>> {
  const out = new Map<number, Verification>();
  let i = 0;
  const worker = async () => {
    while (i < jobs.length) {
      const j = jobs[i++];
      out.set(j.id, await verifyJob(j, runStartedAt).catch(() => ({ status: "niet geverifieerd" as const, reason: "controle mislukt" })));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, worker));
  return out;
}
