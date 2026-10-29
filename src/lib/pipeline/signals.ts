/**
 * Spoor B: werkgevers met een gedateerd hiring-signaal (investering, uitbreiding,
 * nieuwe vestiging, teamopbouw), zonder bevestigde vacature. Geen bron of geen
 * datum = geen signaal. We vullen nooit op tot een vast aantal.
 */
import { llmJson, type CostMeter } from "@/lib/llm";
import { webSearch } from "@/lib/search";
import { fetchPage, clampText } from "@/lib/fetch";
import { registrableDomain } from "@/lib/blocklist";
import { SignalSchema, type Profile, type SignalView } from "./types";

const SYSTEM = `Je beoordeelt of een webpagina een feitelijk, gedateerd signaal bevat dat een bedrijf groeit of mensen
zal nodig hebben: investering, uitbreiding, nieuwe vestiging of productielijn, teamopbouw, grote order, aanwerving.
Regels:
- Enkel signalen van DIT bedrijf, niet van een sector of een ander bedrijf.
- Een signaal zonder datum op de pagina telt niet: zet dan is_signal op false.
- Een vacaturepagina of jobboard is geen groeisignaal.
- Een groeibericht is geen gegarandeerde vacature: schrijf nooit dat er een vacature is.
- Overdrijf niet. Eén feitelijke zin als evidence.
- fit: sterk / middel / zwak, op basis van hoe goed het kandidaatprofiel bij de werking van dit bedrijf past.`;

/** Domeinen die nooit als bron voor een signaal tellen. */
const NOT_A_SOURCE = /(linkedin|facebook|instagram|twitter|x\.com|youtube|tiktok|indeed|jobat|stepstone|vdab|glassdoor|jooble|adzuna|monster|talent\.com)\./i;

export async function findSignal(
  company: { name: string; domain: string },
  profile: Profile,
  meter: CostMeter,
): Promise<SignalView | null> {
  const query = `"${company.name}" investering OR uitbreiding OR "nieuwe vestiging" OR groei OR aanwerving`;
  const results = await webSearch(query, { count: 8, freshness: "py" });
  if (!results?.length) return null;
  const own = results.filter((r) => registrableDomain(r.url) === company.domain);
  const other = results.filter((r) => registrableDomain(r.url) !== company.domain && !NOT_A_SOURCE.test(r.url));
  const candidates = [...own, ...other].slice(0, 2);

  for (const r of candidates) {
    const page = await fetchPage(r.url, { allowJina: true });
    if (page.status < 200 || page.status >= 300 || page.text.length < 300) continue;
    const user = `Bedrijf: ${company.name} (${company.domain})
Kandidaat: ${(profile.positioning ?? []).join(" / ") || profile.job_titles.join(", ")}
Bron: ${r.title} — ${r.url}

Paginatekst:
${clampText(page.text, 8000)}`;
    const v = await llmJson({ system: SYSTEM, user, schema: SignalSchema, meter, effort: "low", maxTokens: 500 }).catch(() => null);
    if (!v || !v.is_signal || !v.date.trim() || !v.evidence.trim()) continue;
    return {
      company: company.name,
      domain: company.domain,
      kind: v.kind.trim() || "signaal",
      date: v.date.trim(),
      sourceUrl: r.url,
      sourceTitle: r.title,
      evidence: v.evidence.trim(),
      fit: v.fit,
      fitReason: v.fit_reason.trim(),
    };
  }
  return null;
}
