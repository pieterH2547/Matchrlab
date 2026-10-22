/**
 * Stap 2: jobboards, parallel. Adzuna (be-endpoint) en VDAB.
 *
 * VDAB: de officiële vacature-API vereist partnerregistratie op
 * developer.vdab.be (IBM API Connect) en is niet publiek. Tot die toegang er is
 * zoeken we VDAB-vacatures via Brave met `site:vdab.be/vindeenjob`, wat
 * per run 2 queries kost en enkel titel + url + snippet oplevert.
 */
import { env, hasEnv } from "@/lib/env";
import { fetchJson } from "@/lib/fetch";
import { braveSearch } from "@/lib/brave";
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
  if (!hasEnv("ADZUNA_APP_ID") || !hasEnv("ADZUNA_APP_KEY")) return [];
  const queries = profile.job_titles.slice(0, 3);
  const out: NormalizedJob[] = [];
  await Promise.all(
    queries.map(async (what) => {
      const params = new URLSearchParams({
        app_id: env.ADZUNA_APP_ID ?? "",
        app_key: env.ADZUNA_APP_KEY ?? "",
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
    const results = await braveSearch(`site:vdab.be/vindeenjob/vacatures ${title} ${profile.region}`, { freshness: "pm" });
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

export async function searchJobboards(profile: Profile): Promise<JobboardResult> {
  const notes: string[] = [];
  const [adzuna, vdab] = await Promise.all([
    searchAdzuna(profile).catch(() => {
      notes.push("Adzuna gaf een fout.");
      return [] as NormalizedJob[];
    }),
    searchVdabViaBrave(profile).catch(() => {
      notes.push("VDAB-zoekopdracht gaf een fout.");
      return { jobs: [] as NormalizedJob[], queries: 0 };
    }),
  ]);
  if (!hasEnv("ADZUNA_APP_ID")) notes.push("Adzuna niet geconfigureerd.");
  return { jobs: [...vdab.jobs, ...adzuna], notes, braveQueries: vdab.queries };
}
