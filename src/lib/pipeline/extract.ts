/**
 * Stap 5: vacatures uit een jobpagina halen. Via ATS-feed als die er is,
 * anders Haiku op de paginatekst; bij enkel titels detailpagina's ophalen
 * (max 10 per bedrijf).
 */
import { fetchPage, clampText, type LinkInfo } from "@/lib/fetch";
import { llmJson, type CostMeter } from "@/lib/llm";
import { LIMITS } from "@/lib/config";
import type { AtsDetection } from "@/lib/ats";
import { ExtractedJobsSchema, type NormalizedJob } from "./types";

const EXTRACT_SYSTEM = `Je krijgt de tekst van de vacaturepagina van een bedrijf (en eventueel de links op die pagina).
Haal er de open vacatures uit. Per vacature: titel, plaats (lege string als onbekend), absolute URL van de
vacature (lege string als er geen aparte link is) en een korte beschrijving van max 300 tekens.

Regels:
- Enkel echte vacatures van dit bedrijf; geen nieuwsberichten, geen "spontaan solliciteren", geen stages tenzij als stage benoemd.
- Als de pagina enkel een lijst titels toont zonder inhoud per vacature: zet is_listing_only op true.
- Als er geen vacatures staan: lege lijst.
- Nooit vacatures verzinnen.`;

export type ExtractResult = { jobs: NormalizedJob[]; detailPagesFetched: number; via: "ats" | "page" | "none" };

export async function extractFromAts(detection: AtsDetection, companyName: string): Promise<NormalizedJob[] | null> {
  const jobs = await detection.adapter.fetchJobs(detection.slug).catch(() => null);
  if (!jobs) return null;
  return jobs.map((j) => ({ ...j, source: "company_site" as const, companyName }));
}

export async function extractFromPage(
  input: { jobsUrl: string; text: string; links: LinkInfo[]; companyName: string },
  meter: CostMeter,
): Promise<ExtractResult> {
  const jobLinks = input.links
    .filter((l) => /(vacature|job|career|werken|solliciteer|opportun|position|functie|offre|emploi)/i.test(`${l.href} ${l.text}`))
    .slice(0, 80)
    .map((l) => `${l.href} — ${l.text}`)
    .join("\n");
  const user = `Bedrijf: ${input.companyName}\nPagina: ${input.jobsUrl}\n\n## Tekst\n${clampText(input.text)}\n\n## Links\n${jobLinks || "(geen)"}`;
  const extracted = await llmJson({ system: EXTRACT_SYSTEM, user, schema: ExtractedJobsSchema, meter, effort: "low", maxTokens: 3000 });

  let jobs: NormalizedJob[] = extracted.jobs
    .filter((j) => j.title.trim())
    .map((j) => ({
      source: "company_site" as const,
      url: absolutize(j.url, input.jobsUrl) ?? `${input.jobsUrl}#${slug(j.title)}`,
      title: j.title.trim(),
      location: j.location.trim(),
      descriptionText: j.description.trim(),
      companyName: input.companyName,
    }));

  let detailPagesFetched = 0;
  const needsDetail = extracted.is_listing_only || jobs.some((j) => !j.descriptionText);
  if (needsDetail) {
    const targets = jobs.filter((j) => !j.descriptionText && !j.url.includes("#")).slice(0, LIMITS.maxDetailPagesPerCompany);
    const detailed = await Promise.all(
      targets.map(async (j) => {
        const page = await fetchPage(j.url, { allowJina: true });
        detailPagesFetched += 1;
        if (page.status >= 200 && page.status < 300 && page.text) {
          return { ...j, descriptionText: summarizeDetail(page.text), location: j.location || guessLocationFromText(page.text) };
        }
        return j;
      }),
    );
    const byUrl = new Map(detailed.map((j) => [j.url, j]));
    jobs = jobs.map((j) => byUrl.get(j.url) ?? j);
  }
  return { jobs, detailPagesFetched, via: jobs.length ? "page" : "none" };
}

function absolutize(url: string, base: string): string | null {
  if (!url) return null;
  try {
    const u = new URL(url, base);
    return /^https?:$/.test(u.protocol) ? u.toString() : null;
  } catch {
    return null;
  }
}

function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

/** Geen LLM: de eerste zinvolle 600 tekens van de detailpagina volstaan voor de scoring. */
function summarizeDetail(text: string): string {
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 30);
  return lines.join(" ").slice(0, 800);
}

function guessLocationFromText(text: string): string {
  const m = text.match(/\b(?:locatie|plaats|regio|standplaats|location)\s*[:\-]?\s*([A-Z][a-zà-ÿ-]+(?:\s[A-Z][a-zà-ÿ-]+)?)/);
  return m?.[1] ?? "";
}
