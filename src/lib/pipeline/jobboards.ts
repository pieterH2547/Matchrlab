/**
 * Spoor A (jobboards: Google Jobs, Jooble, Adzuna) en spoor C (gerichte Google-zoekopdrachten
 * op VDAB, Indeed, LinkedIn en publieke ATS-pagina's), parallel. Elke bron faalt los van de rest.
 *
 * Spoor C gebruikt enkel zoekresultaten (titel, link, snippet). Pagina's van LinkedIn en Indeed
 * worden nooit opgevraagd (toegangsvoorwaarden); die vacatures blijven 'niet geverifieerd'.
 */
import { fetchJson, fetchRaw } from "@/lib/fetch";
import { redactSecrets } from "@/lib/redact";
import { webSearch } from "@/lib/search";
import { getSetting } from "@/lib/settings";
import { LIMITS } from "@/lib/config";
import { countCall, noteFailure } from "@/lib/usage";
import { findPlaceName } from "@/lib/geo";
import type { NormalizedJob, Profile } from "./types";
import { searchOpenAIJobs, type AiSearchResult } from "./aisearch";

/** Per bron: aantal zoekopdrachten, ruwe resultaten en of ze faalde. Voor de diagnose per run. */
export type SourceStat = { queries: number; raw: number; kept: number; error?: string; skipped?: string };
export type JobboardResult = {
  jobs: NormalizedJob[];
  notes: string[];
  braveQueries: number;
  perSource: Record<string, number>;
  sources: Record<string, SourceStat>;
  ai?: AiSearchResult;
};
type SourceOut = { jobs: NormalizedJob[]; queries: number; raw: number; error?: string; skipped?: string };

/** Primaire titels eerst, dan verwante functies; zonder dubbels. */
export function searchTitles(profile: Profile, max: number): string[] {
  const all = [...profile.job_titles, ...(profile.related_titles ?? [])].map((t) => t.trim()).filter(Boolean);
  return Array.from(new Set(all.map((t) => t.toLowerCase()))).slice(0, max).map((low) => all.find((t) => t.toLowerCase() === low)!);
}

type AdzunaResult = {
  id: string;
  title: string;
  description?: string;
  redirect_url: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
};

export async function searchAdzuna(profile: Profile): Promise<SourceOut> {
  const appId = await getSetting("ADZUNA_APP_ID");
  const appKey = await getSetting("ADZUNA_APP_KEY");
  if (!appId || !appKey) return { jobs: [], queries: 0, raw: 0, skipped: "niet ingesteld" };
  const queries = searchTitles(profile, LIMITS.titlesPerSource);
  const out: NormalizedJob[] = [];
  let failed = 0;
  countCall("adzuna", queries.length);
  await Promise.all(
    queries.map(async (what) => {
      const params = new URLSearchParams({
        app_id: appId,
        app_key: appKey,
        what,
        where: profile.region,
        distance: String(profile.radius_km),
        results_per_page: String(Math.min(50, LIMITS.resultsPerQuery)),
        max_days_old: "45",
        sort_by: "date",
        "content-type": "application/json",
      });
      const data = await fetchJson<{ results?: AdzunaResult[] }>(`https://api.adzuna.com/v1/api/jobs/be/search/1?${params}`);
      if (!data) failed += 1;
      for (const r of data?.results ?? []) {
        out.push({
          source: "adzuna",
          externalId: r.id,
          url: r.redirect_url,
          title: r.title,
          location: r.location?.display_name ?? "",
          descriptionText: r.description ?? "",
          companyName: r.company?.display_name ?? "",
          raw: { id: r.id, created: r.created, company: r.company?.display_name },
        });
      }
    }),
  );
  return { jobs: out.slice(0, LIMITS.maxJobsPerBoard), queries: queries.length, raw: out.length, error: failed === queries.length && queries.length ? "geen antwoord" : undefined };
}

/** Doelgerichte zoekopdrachten voor spoor C. Max 6, elk met titel + regio. */
export function targetedQueries(profile: Profile): { q: string; kind: "vdab" | "indeed" | "linkedin" | "ats" | "site" }[] {
  const [t1, t2] = searchTitles(profile, 2);
  const r = profile.region;
  if (!t1) return [];
  const ats = "(site:jobs.smartrecruiters.com OR site:recruitee.com OR site:jobs.lever.co OR site:boards.greenhouse.io OR site:jobtoolz.com OR site:teamtailor.com)";
  const out: { q: string; kind: "vdab" | "indeed" | "linkedin" | "ats" | "site" }[] = [
    { q: `site:vdab.be/vindeenjob/vacatures ${t1} ${r}`, kind: "vdab" },
    { q: `site:be.indeed.com ${t1} ${r}`, kind: "indeed" },
    { q: `site:linkedin.com/jobs ${t1} ${r}`, kind: "linkedin" },
    { q: `${ats} ${t1} ${r}`, kind: "ats" },
    { q: `"${t1}" vacature ${r} solliciteer -interim -uitzendkantoor`, kind: "site" },
  ];
  if (t2) out.push({ q: `site:vdab.be/vindeenjob/vacatures ${t2} ${r}`, kind: "vdab" });
  return out.slice(0, 6);
}

/** Lijkt deze link op één concrete vacature (geen zoek- of lijstpagina)? */
export function looksLikeSingleJob(url: string, kind: string): boolean {
  if (kind === "vdab") return /vdab\.be\/vindeenjob\/vacatures\/\d+/.test(url);
  if (kind === "indeed") return /indeed\.com\/(viewjob|rc\/clk|pagead|cmp\/[^/]+\/jobs\/)|[?&]jk=/.test(url);
  if (kind === "linkedin") return /linkedin\.com\/jobs\/view\//.test(url);
  if (kind === "ats") return /(recruitee\.com\/o\/|jobs\.lever\.co\/[^/]+\/[0-9a-f-]{8,}|boards\.greenhouse\.io\/[^/]+\/jobs\/\d+|jobs\.smartrecruiters\.com\/[^/]+\/\d+|jobtoolz\.com\/.+\/.+|teamtailor\.com\/jobs\/\d+)/.test(url);
  return /(vacature|vacatures|jobs?|career|werken-bij)\/[^/]{6,}/i.test(url);
}

/** Titel opkuisen en werkgever/plaats raden uit zoekresultaten van jobsites. */
export function parseJobResult(title: string, snippet: string, kind: string): { title: string; company: string; location: string } {
  let t = title.replace(/\s*[|–-]\s*(VDAB|Indeed(\.com)?|LinkedIn|Jobat|StepStone)\b.*$/i, "").trim();
  let company = "";
  // LinkedIn: "Werkgever hiring Functie in Plaats"
  const li = t.match(/^(.+?)\s+(?:hiring|zoekt|recrute)\s+(.+?)(?:\s+in\s+(.+))?$/i);
  if (kind === "linkedin" && li) {
    company = li[1].trim();
    t = li[2].trim();
  }
  // Indeed en anderen: "Functie - Werkgever - Plaats"
  const parts = t.split(/\s+[-–|]\s+/);
  if (!company && parts.length >= 2) {
    company = parts[1].trim();
    t = parts[0].trim();
  }
  if (!company) company = title.match(/\b(?:bij|at|chez)\s+([^|–-]+)/i)?.[1]?.trim() ?? "";
  const location = findPlaceName(`${title} ${snippet}`) ?? "";
  return { title: t, company, location };
}

/** Spoor C: gerichte Google-zoekopdrachten via de zoekketen (Serper eerst). */
export async function searchTargetedWeb(profile: Profile): Promise<SourceOut> {
  const qs = targetedQueries(profile);
  const results = await Promise.all(qs.map((x) => webSearch(x.q, { count: 10, freshness: x.kind === "site" ? undefined : "pm" }).then((r) => ({ ...x, r }))));
  const out: NormalizedJob[] = [];
  let raw = 0;
  for (const { kind, r } of results) {
    raw += (r ?? []).length;
    for (const hit of r ?? []) {
      if (!looksLikeSingleJob(hit.url, kind)) continue;
      const parsed = parseJobResult(hit.title, hit.description, kind);
      out.push({
        source: kind === "vdab" ? "vdab" : "web",
        externalId: kind === "vdab" ? hit.url.match(/vacatures\/(\d+)/)?.[1] : undefined,
        url: hit.url,
        title: parsed.title || hit.title,
        location: parsed.location,
        descriptionText: hit.description,
        companyName: parsed.company,
        raw: { via: kind, title: hit.title },
      });
    }
  }
  const ok = results.filter((x) => x.r !== null).length;
  return { jobs: out.slice(0, LIMITS.maxJobsPerBoard), queries: ok, raw, error: qs.length && ok === 0 ? "zoekmachine gaf geen antwoord" : undefined };
}

type JoobleJob = { id?: string | number; title?: string; location?: string; snippet?: string; source?: string; type?: string; link?: string; company?: string; updated?: string };

/** Jooble-straal kent enkel vaste waarden (km). */
function joobleRadius(km: number): string {
  const allowed = [0, 4, 8, 16, 26, 40, 80];
  return String(allowed.find((r) => r >= km) ?? 80);
}

/**
 * Jooble: gratis vacature-API (aggregator). Key per landendomein; voor België aangevraagd via be.jooble.org.
 * We proberen eerst het Belgische domein, dan het algemene endpoint.
 */
export async function searchJooble(profile: Profile): Promise<SourceOut> {
  const key = await getSetting("JOOBLE_API_KEY");
  if (!key) return { jobs: [], queries: 0, raw: 0, skipped: "niet ingesteld" };
  const out: NormalizedJob[] = [];
  const titles = searchTitles(profile, LIMITS.titlesPerSource);
  let failed = 0;
  let raw = 0;
  await Promise.all(
    titles.map(async (keywords) => {
      countCall("jooble");
      const body = JSON.stringify({ keywords, location: profile.region, radius: joobleRadius(profile.radius_km), page: 1, ResultOnPage: LIMITS.resultsPerQuery });
      const init = { method: "POST", headers: { "content-type": "application/json" }, body };
      let data = await fetchJson<{ jobs?: JoobleJob[] }>(`https://be.jooble.org/api/${encodeURIComponent(key)}`, init);
      if (!data) data = await fetchJson<{ jobs?: JoobleJob[] }>(`https://jooble.org/api/${encodeURIComponent(key)}`, init);
      if (!data) failed += 1;
      raw += data?.jobs?.length ?? 0;
      for (const j of data?.jobs ?? []) {
        if (!j.link || !j.title) continue;
        // "Interim" of "tijdelijk" in het contracttype: meteen weg.
        if (/interim|tijdelijk|temporary|freelance|uitzend/i.test(j.type ?? "")) continue;
        out.push({
          source: "jooble",
          externalId: j.id !== undefined ? String(j.id) : undefined,
          url: j.link,
          title: j.title.replace(/<[^>]+>/g, "").trim(),
          location: j.location ?? "",
          descriptionText: (j.snippet ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          companyName: (j.company ?? "").trim(),
          raw: { id: j.id, type: j.type, source: j.source, updated: j.updated },
        });
      }
    }),
  );
  return { jobs: out.slice(0, LIMITS.maxJobsPerBoard), queries: titles.length, raw, error: failed === titles.length && titles.length ? "geen antwoord (key of limiet?)" : undefined };
}

type GoogleJob = {
  title?: string;
  company_name?: string;
  location?: string;
  description?: string;
  job_id?: string;
  share_link?: string;
  apply_options?: { title?: string; link?: string }[];
  detected_extensions?: { schedule_type?: string; posted_at?: string };
};

/**
 * Google Jobs via SerpApi: de vacatures die Google van alle sites verzamelt (ook bedrijfssites).
 * We nemen bij voorkeur de sollicitatielink van de werkgever zelf, niet die van een jobboard.
 */
/** Laatste foutmelding van Google Jobs, voor de testknop in Instellingen. */
export let googleJobsLastError: string | null = null;

/** Eén Google Jobs-resultaat omzetten; null = overslaan (geen titel, geen link of expliciet tijdelijk). */
export function mapGoogleJob(j: GoogleJob): NormalizedJob | null {
  if (!j.title) return null;
  if (/interim|tijdelijk|temporary|freelance|uitzend/i.test(j.detected_extensions?.schedule_type ?? "")) return null;
  const company = (j.company_name ?? "").trim();
  const companyWord = company.toLowerCase().split(/\s+/)[0] ?? "";
  const options = j.apply_options ?? [];
  const own = options.find((o) => o.link && companyWord.length > 2 && o.link.toLowerCase().includes(companyWord));
  const url = own?.link ?? options[0]?.link ?? j.share_link;
  if (!url) return null;
  return {
    source: "google_jobs",
    externalId: j.job_id,
    url,
    title: j.title.trim(),
    location: j.location ?? "",
    descriptionText: (j.description ?? "").replace(/\s+/g, " ").slice(0, 1500),
    companyName: company,
    raw: { via: options.map((o) => o.title).filter(Boolean).slice(0, 4), posted: j.detected_extensions?.posted_at, schedule: j.detected_extensions?.schedule_type },
  };
}

/** Google Jobs via SerpApi, met paginering (next_page_token) tot LIMITS.googleJobsPagesPerQuery per titel. */
export async function searchGoogleJobs(profile: Profile): Promise<SourceOut> {
  const key = await getSetting("SERPAPI_API_KEY");
  if (!key) return { jobs: [], queries: 0, raw: 0, skipped: "niet ingesteld" };
  googleJobsLastError = null;
  const out: NormalizedJob[] = [];
  let queries = 0;
  let raw = 0;
  await Promise.all(
    searchTitles(profile, LIMITS.titlesPerSource).map(async (title) => {
      let token: string | undefined;
      for (let page = 0; page < LIMITS.googleJobsPagesPerQuery; page++) {
        countCall("google_jobs");
        queries += 1;
        // Regio in de zoekvraag zelf: SerpApi kent niet elke gemeente als 'location'.
        const params = new URLSearchParams({ engine: "google_jobs", q: `${title} ${profile.region}`.trim(), hl: "nl", gl: "be", api_key: key });
        if (token) params.set("next_page_token", token);
        const r = await fetchRaw(`https://serpapi.com/search.json?${params}`, undefined, 30_000);
        let data: { jobs_results?: GoogleJob[]; error?: string; serpapi_pagination?: { next_page_token?: string } } = {};
        try {
          data = JSON.parse(r.body);
        } catch {
          data = {};
        }
        if (r.status !== 200 || data.error) {
          // "geen resultaten" is geen fout; al de rest wel (key, tegoed op, …).
          if (!/hasn't returned any results|no results/i.test(data.error ?? "")) googleJobsLastError = redactSecrets(data.error ?? (r.status === 0 ? "geen antwoord binnen 30 s" : `HTTP ${r.status}`));
          return;
        }
        const list = data.jobs_results ?? [];
        raw += list.length;
        for (const j of list) {
          const m = mapGoogleJob(j);
          if (m) out.push(m);
        }
        token = data.serpapi_pagination?.next_page_token;
        if (!token || list.length === 0) return;
      }
    }),
  );
  return { jobs: out.slice(0, LIMITS.maxJobsPerBoard), queries, raw, error: googleJobsLastError ?? undefined };
}

/**
 * Alle vacaturebronnen parallel. Een bron die faalt of time-out geeft, stopt de rest niet.
 * OpenAI Web Search (spoor D) loopt mee als aanvullende bron.
 */
export async function searchJobboards(profile: Profile, deps: { ai?: (p: Profile) => Promise<AiSearchResult> } = {}): Promise<JobboardResult> {
  const notes: string[] = [];
  const empty: SourceOut = { jobs: [], queries: 0, raw: 0 };
  const guard = (label: string, p: Promise<SourceOut>) =>
    p.catch((e: unknown) => {
      notes.push(`${label} gaf een fout.`);
      noteFailure(`${label} gaf een fout; de andere bronnen liepen door.`);
      return { ...empty, error: redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 120) };
    });
  const aiRun = (deps.ai ?? searchOpenAIJobs)(profile).catch(
    (e: unknown): AiSearchResult => ({ jobs: [], rounds: 0, searches: 0, raw: 0, costEur: 0, durationMs: 0, model: null, queries: [], error: redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 120) }),
  );
  const [adzuna, web, jooble, google, ai] = await Promise.all([
    guard("Adzuna", searchAdzuna(profile)),
    guard("Google-zoekopdrachten (spoor C)", searchTargetedWeb(profile)),
    guard("Jooble", searchJooble(profile)),
    guard("Google Jobs", searchGoogleJobs(profile)),
    aiRun,
  ]);
  if (google.error) {
    notes.push(`Google Jobs: ${google.error}`);
    noteFailure(`Google Jobs: ${google.error}`);
  }
  if (jooble.error) noteFailure(`Jooble: ${jooble.error}`);
  if (adzuna.error) noteFailure(`Adzuna: ${adzuna.error}`);
  if (ai.error) notes.push(`OpenAI Web Search: ${ai.error}`);
  const aiOut: SourceOut = { jobs: ai.jobs, queries: ai.searches, raw: ai.raw, error: ai.error, skipped: ai.skipped };
  const bySource: Record<string, SourceOut> = { google_jobs: google, jooble, adzuna, google_zoek: web, openai_web: aiOut };
  // Limiet per run: elke bron krijgt een eerlijk deel, zodat één grote bron de rest niet verdringt.
  const all: NormalizedJob[] = [];
  const lists = Object.values(bySource).map((x) => x.jobs);
  for (let i = 0; all.length < LIMITS.maxRawJobsPerRun && lists.some((l) => i < l.length); i++) {
    for (const l of lists) if (i < l.length && all.length < LIMITS.maxRawJobsPerRun) all.push(l[i]);
  }
  const sources: Record<string, SourceStat> = {};
  for (const [k, v] of Object.entries(bySource)) sources[k] = { queries: v.queries, raw: v.raw, kept: v.jobs.length, error: v.error, skipped: v.skipped };
  const perSource = Object.fromEntries(Object.entries(bySource).map(([k, v]) => [k, v.jobs.length]));
  return { jobs: all, notes, braveQueries: web.queries, perSource, sources, ai };
}
