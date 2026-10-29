/**
 * Stap 2: jobboards, parallel. Adzuna (be-endpoint) en VDAB.
 *
 * VDAB: de officiële vacature-API vereist partnerregistratie op
 * developer.vdab.be (IBM API Connect) en is niet publiek. Tot die toegang er is
 * zoeken we VDAB-vacatures via Brave met `site:vdab.be/vindeenjob`, wat
 * per run 2 queries kost en enkel titel + url + snippet oplevert.
 */
import { fetchJson } from "@/lib/fetch";
import { webSearch } from "@/lib/search";
import { getSetting } from "@/lib/settings";
import { LIMITS } from "@/lib/config";
import type { NormalizedJob, Profile } from "./types";

export type JobboardResult = { jobs: NormalizedJob[]; notes: string[]; braveQueries: number };

type AdzunaResult = {
  id: string;
  title: string;
  description?: string;
  redirect_url: string;
  created?: string;
  company?: { display_name?: string };
  location?: { display_name?: string };
};

export async function searchAdzuna(profile: Profile): Promise<NormalizedJob[]> {
  const appId = await getSetting("ADZUNA_APP_ID");
  const appKey = await getSetting("ADZUNA_APP_KEY");
  if (!appId || !appKey) return [];
  const queries = profile.job_titles.slice(0, 3);
  const out: NormalizedJob[] = [];
  await Promise.all(
    queries.map(async (what) => {
      const params = new URLSearchParams({
        app_id: appId,
        app_key: appKey,
        what,
        where: profile.region,
        distance: String(profile.radius_km),
        results_per_page: "25",
        max_days_old: "45",
        sort_by: "date",
        "content-type": "application/json",
      });
      const data = await fetchJson<{ results?: AdzunaResult[] }>(`https://api.adzuna.com/v1/api/jobs/be/search/1?${params}`);
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
  return out.slice(0, LIMITS.maxJobsPerBoard);
}

export async function searchVdabViaBrave(profile: Profile): Promise<{ jobs: NormalizedJob[]; queries: number }> {
  const out: NormalizedJob[] = [];
  let queries = 0;
  for (const title of profile.job_titles.slice(0, 2)) {
    const results = await webSearch(`site:vdab.be/vindeenjob/vacatures ${title} ${profile.region}`, { freshness: "pm" });
    if (results === null) break;
    queries += 1;
    for (const r of results) {
      if (!/vdab\.be\/vindeenjob\/vacatures\/\d+/.test(r.url)) continue;
      const titleClean = r.title.replace(/\s*[|–-]\s*VDAB.*$/i, "").trim();
      out.push({
        source: "vdab",
        externalId: r.url.match(/vacatures\/(\d+)/)?.[1],
        url: r.url,
        title: titleClean || r.title,
        location: guessLocation(r.title, r.description),
        descriptionText: r.description,
        companyName: guessCompany(r.title),
        raw: { title: r.title, description: r.description },
      });
    }
  }
  return { jobs: out.slice(0, LIMITS.maxJobsPerBoard), queries };
}

function guessLocation(title: string, description: string): string {
  const m = `${title} ${description}`.match(/\b(?:te|in)\s+([A-Z][a-zà-ÿ-]+(?:\s[A-Z][a-zà-ÿ-]+)?)/);
  return m?.[1] ?? "";
}

function guessCompany(title: string): string {
  const m = title.match(/\b(?:bij|at)\s+([^|–-]+)/i);
  return m?.[1]?.trim() ?? "";
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
export async function searchJooble(profile: Profile): Promise<NormalizedJob[]> {
  const key = await getSetting("JOOBLE_API_KEY");
  if (!key) return [];
  const out: NormalizedJob[] = [];
  await Promise.all(
    profile.job_titles.slice(0, 3).map(async (keywords) => {
      const body = JSON.stringify({ keywords, location: profile.region, radius: joobleRadius(profile.radius_km), page: 1, ResultOnPage: 30 });
      const init = { method: "POST", headers: { "content-type": "application/json" }, body };
      let data = await fetchJson<{ jobs?: JoobleJob[] }>(`https://be.jooble.org/api/${encodeURIComponent(key)}`, init);
      if (!data) data = await fetchJson<{ jobs?: JoobleJob[] }>(`https://jooble.org/api/${encodeURIComponent(key)}`, init);
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
  return out.slice(0, LIMITS.maxJobsPerBoard);
}

export async function searchJobboards(profile: Profile): Promise<JobboardResult> {
  const notes: string[] = [];
  const [adzuna, vdab, jooble] = await Promise.all([
    searchAdzuna(profile).catch(() => {
      notes.push("Adzuna gaf een fout.");
      return [] as NormalizedJob[];
    }),
    searchVdabViaBrave(profile).catch(() => {
      notes.push("VDAB-zoekopdracht gaf een fout.");
      return { jobs: [] as NormalizedJob[], queries: 0 };
    }),
    searchJooble(profile).catch(() => {
      notes.push("Jooble gaf een fout.");
      return [] as NormalizedJob[];
    }),
  ]);
  if (!(await getSetting("ADZUNA_APP_ID"))) notes.push("Adzuna niet geconfigureerd.");
  if (!(await getSetting("JOOBLE_API_KEY"))) notes.push("Jooble niet geconfigureerd.");
  return { jobs: [...vdab.jobs, ...adzuna, ...jooble], notes, braveQueries: vdab.queries };
}
