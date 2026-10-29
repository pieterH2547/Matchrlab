/**
 * Resultatenspoor B: max 10 interessante werkgevers, ook zonder passende vacature.
 * Feiten komen uit wat Matchr zelf zag (Google Maps, jobpagina, vacatures); de AI beoordeelt enkel
 * relevantie en activiteit. Een bedrijf zonder vacature is een potentiële werkgever, nooit een
 * bewezen aanwervingskans.
 */
import { inArray } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Company } from "@/lib/db/schema";
import { llmJson, type CostMeter } from "@/lib/llm";
import { isIntermediaryCompany } from "@/lib/blocklist";
import { distanceFromCenter, findPlaceName, regionCenter } from "@/lib/geo";
import { EmployersSchema, type EmployerView, type Profile } from "./types";

const SYSTEM = `Je beoordeelt werkgevers voor één kandidaat. Per bedrijf krijg je enkel wat we zelf vonden:
naam, Google Maps-categorie, adres, of er een jobpagina is en hoeveel vacatures erop stonden.
Zeg per bedrijf of het kandidaatprofiel er realistisch relevant kan zijn, de hoofdactiviteit in een paar woorden,
en één zin waarom. Verzin nooit vacatures, groeiplannen, uitbreidingen of personeelsbehoeften.
Weet je weinig over het bedrijf, baseer je dan enkel op de categorie en zeg dat niet stellig.`;

function municipality(address: string | null | undefined): string {
  if (!address) return "";
  const m = address.match(/\b[1-9]\d{3}\s+([^,]+)/);
  return (m?.[1] ?? findPlaceName(address) ?? "").trim();
}

export async function buildEmployers(
  profile: Profile,
  domains: string[],
  matchedCompanyIds: Set<number>,
  meter: CostMeter,
): Promise<EmployerView[]> {
  if (!domains.length) return [];
  const rows: Company[] = await db().select().from(schema.companies).where(inArray(schema.companies.domain, domains));
  const center = regionCenter(profile);
  const candidates = rows
    .filter((c) => !isIntermediaryCompany(c.name, c.domain) && !(c.notes ?? "").startsWith("tussenpersoon"))
    .map((c) => ({ c, dist: c.lat !== null && c.lng !== null ? distanceFromCenter(center, { lat: c.lat, lon: c.lng }) : null }))
    .filter((x) => x.dist === null || x.dist <= profile.radius_km)
    .sort(
      (a, b) =>
        Number(matchedCompanyIds.has(b.c.id)) - Number(matchedCompanyIds.has(a.c.id)) ||
        b.c.openJobsCount - a.c.openJobsCount ||
        (a.dist ?? 999) - (b.dist ?? 999),
    )
    .slice(0, 20);
  if (!candidates.length) return [];

  const list = candidates
    .map(
      ({ c }) =>
        `[${c.id}] ${c.name ?? c.domain} — categorie: ${c.category || "onbekend"} — adres: ${c.address || "onbekend"} — jobpagina: ${c.jobsUrl ? "ja" : "nee"} — vacatures op jobpagina: ${c.openJobsCount}`,
    )
    .join("\n");
  const user = `Kandidaat: ${(profile.positioning ?? []).join(" / ") || profile.job_titles.join(", ")}\nSectoren: ${profile.sectors.join(", ")}\n\nBedrijven:\n${list}`;
  const judged = await llmJson({ system: SYSTEM, user, schema: EmployersSchema, meter, effort: "low", maxTokens: 2500 }).catch(() => null);
  const byId = new Map((judged?.employers ?? []).map((e) => [e.id, e]));

  const today = new Date().toLocaleDateString("nl-BE");
  const out: EmployerView[] = [];
  for (const { c, dist } of candidates) {
    const j = byId.get(c.id);
    if (judged && (!j || !j.relevant)) continue;
    const matched = matchedCompanyIds.has(c.id);
    const signal = matched
      ? "Passende vacature gevonden (zie vacatures)."
      : c.openJobsCount > 0
        ? `${c.openJobsCount} open vacature${c.openJobsCount === 1 ? "" : "s"} op hun jobpagina op ${today}, geen passende.`
        : null;
    out.push({
      name: c.name ?? c.domain,
      domain: c.domain,
      municipality: municipality(c.address),
      website: `https://${c.domain}`,
      activity: j?.activity?.trim() || c.category || "",
      why: j?.why?.trim() || "",
      signal,
      careersUrl: c.jobsUrl,
      hasMatchingJob: matched,
      openJobs: c.openJobsCount,
      distanceKm: dist,
    });
    if (out.length >= 10) break;
  }
  return out;
}
