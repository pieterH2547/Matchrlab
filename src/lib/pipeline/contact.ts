/**
 * Contactadres om een kandidaat voor te stellen. Enkel adressen die letterlijk op de vacature of op de
 * website van de werkgever staan; nooit een gegokt patroon (voornaam.naam@…). Altijd met de vindplaats.
 * Voorkeur: sollicitatie-/HR-adres op het eigen domein van de werkgever.
 */
import { fetchPage } from "@/lib/fetch";
import { isBlockedDomain, registrableDomain } from "@/lib/blocklist";

export type Contact = { email: string; source: string; name?: string | null };

const NAME = "([A-ZÀ-Ý][a-zà-ÿ'’-]+(?:\\s+(?:van|de|der|den|du|le|la|vd|ten|ter)){0,3}(?:\\s+[A-ZÀ-Ý][a-zà-ÿ'’-]+){1,2})";
const CONTACT_CUE = new RegExp(
  `(?:[Cc]ontactpersoon|[Cc]ontact\\s*persoon|[Nn]eem contact op met|[Vv]ragen\\??[^.]{0,40}?(?:bij|aan|met)|[Ss]tuur (?:je|jouw) (?:cv|kandidatuur)[^.]{0,30}?naar|[Ss]olliciteren bij|[Pp]ersonne de contact|[Cc]ontactez|[Cc]ontact person|[Cc]ontact:)\\s*:?\\s*(?:mevrouw|meneer|mevr\\.|dhr\\.|mr\\.|mrs\\.|ms\\.)?\\s*${NAME}`,
);

/** Naam van de contactpersoon zoals die in de tekst staat, of uit het e-mailadres (voornaam.naam@). Nooit gegokt. */
export function extractContactName(text: string, email: string | null): string | null {
  const m = text.match(CONTACT_CUE);
  if (m?.[1] && !/^(Wij|Ons|Onze|Het|De|Een|Je|Jij|Uw|Hr|Info|Jobs)\b/.test(m[1])) return m[1].trim();
  // Uit het adres enkel bij voornaam.naam@ (twee delen, letters), nooit bij jobs@, hr@, info@.
  const local = email?.split("@")[0] ?? "";
  const parts = local.split(/[._-]/).filter(Boolean);
  if (parts.length === 2 && parts.every((p) => /^[a-zà-ÿ]{2,}$/i.test(p)) && !HR_WORDS.test(local) && !GENERIC.test(local)) {
    return parts.map((p) => p.charAt(0).toUpperCase() + p.slice(1).toLowerCase()).join(" ");
  }
  return null;
}

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,24}/gi;
const JUNK = /(example\.|sentry|wixpress|domain\.|email\.com$|yourname|naam@|name@|\.(png|jpe?g|gif|svg|webp)$|noreply|no-reply|donotreply|privacy|gdpr|dpo@|abuse@|webmaster|postmaster|newsletter|nieuwsbrief|unsubscribe)/i;
const HR_WORDS = /^(jobs?|hr|vacatures?|recruit\w*|sollicit\w*|careers?|career|werken|werkenbij|people|talent|personeel|personnel|job)[._-]?/i;
const GENERIC = /^(info|contact|hello|hallo|office|admin|onthaal|receptie|mail)[._-]?@?/i;

/** Alle bruikbare adressen uit tekst (ook "jan [at] firma.be"). */
export function extractEmails(text: string): string[] {
  const normalized = text.replace(/\s*\[\s*(at|@)\s*\]\s*/gi, "@").replace(/\s*\(\s*(at|@)\s*\)\s*/gi, "@").replace(/\s*\[\s*(dot|punt)\s*\]\s*/gi, ".");
  const out = new Set<string>();
  for (const m of normalized.matchAll(EMAIL)) {
    const e = m[0].toLowerCase().replace(/\.$/, "");
    if (JUNK.test(e)) continue;
    out.add(e);
  }
  return Array.from(out);
}

/**
 * Beste adres kiezen: HR/jobs-adres op het domein van de werkgever > ander adres op dat domein >
 * HR-adres elders (bv. een ATS die het adres van de werkgever toont) > algemeen adres van de werkgever.
 * Adressen van jobboards en bureaus nooit.
 */
export function pickEmail(emails: string[], employerDomain: string | null): string | null {
  const usable = emails.filter((e) => {
    const d = e.split("@")[1] ?? "";
    return !isBlockedDomain(d) || (employerDomain !== null && registrableDomain(d) === employerDomain);
  });
  if (!usable.length) return null;
  const own = (e: string) => employerDomain !== null && registrableDomain(e.split("@")[1] ?? "") === employerDomain;
  const local = (e: string) => e.split("@")[0];
  const rank = (e: string) => (own(e) ? 0 : 4) + (HR_WORDS.test(local(e)) ? 0 : GENERIC.test(local(e)) ? 2 : 1);
  return usable.sort((a, b) => rank(a) - rank(b))[0];
}

/** Domein van de werkgever: uit de bedrijfsfiche, anders uit de vacaturelink als dat geen jobboard is. */
export function employerDomainFor(jobUrl: string, companyDomain: string | null): string | null {
  if (companyDomain) return companyDomain;
  if (!isBlockedDomain(jobUrl)) return registrableDomain(jobUrl);
  return null;
}

type Fetcher = (url: string) => Promise<string>;
const defaultFetch: Fetcher = async (url) => (await fetchPage(url, { allowJina: false }).catch(() => null))?.text ?? "";

/**
 * Zoek een contactadres voor één vacature/werkgever. Volgorde: vacaturetekst, vacaturepagina,
 * dan max 3 pagina's van de werkgeverssite (jobs, contact, home). Stopt bij het eerste goede HR-adres.
 */
export async function findContact(
  opts: { jobText?: string | null; jobUrl?: string | null; employerDomain: string | null; careersUrl?: string | null },
  fetcher: Fetcher = defaultFetch,
): Promise<Contact | null> {
  const d = opts.employerDomain;
  const tryText = (text: string, source: string): Contact | null => {
    const e = pickEmail(extractEmails(text), d);
    return e ? { email: e, source, name: extractContactName(text, e) } : null;
  };
  let best: Contact | null = null;
  const better = (c: Contact | null) => {
    if (!c) return;
    const isHr = (x: Contact) => HR_WORDS.test(x.email.split("@")[0]);
    if (!best || (isHr(c) && !isHr(best))) best = c;
  };
  better(opts.jobText ? tryText(opts.jobText, "vacaturetekst") : null);
  if (best && HR_WORDS.test((best as Contact).email.split("@")[0])) return best;
  if (opts.jobUrl && !/linkedin\.com|indeed\./i.test(opts.jobUrl)) better(tryText(await fetcher(opts.jobUrl), "vacaturepagina"));
  if (best && HR_WORDS.test((best as Contact).email.split("@")[0])) return best;
  if (d) {
    const pages = [opts.careersUrl, `https://${d}/contact`, `https://www.${d}/`].filter((x): x is string => Boolean(x));
    const texts = await Promise.all(pages.slice(0, 3).map((u) => fetcher(u).then((t) => ({ u, t }))));
    for (const { u, t } of texts) better(tryText(t, u.includes("/contact") ? "contactpagina werkgever" : u === opts.careersUrl ? "jobpagina werkgever" : "website werkgever"));
  }
  return best;
}
