import type { AtsAdapter } from "./types";
import { fetchJson } from "@/lib/fetch";
import { firstMatch } from "./util";

type WorkableJob = { title: string; shortcode: string; location?: { city?: string; country?: string }; url?: string };

/** Workable: apply.workable.com/api/v3/accounts/{slug}/jobs (POST, publiek). */
export const workable: AtsAdapter = {
  id: "workable",
  verified: false,
  endpointNote: "POST https://apply.workable.com/api/v3/accounts/{slug}/jobs met body {} (JSON, veld results[])",
  detect(html, links) {
    return firstMatch(/apply\.workable\.com\/(?:api\/v3\/accounts\/)?([a-z0-9-]+)/i, html, links.join("\n")) ?? firstMatch(/([a-z0-9-]+)\.workable\.com/i, html, links.join("\n"));
  },
  listingUrl(slug) {
    return `https://apply.workable.com/${slug}/`;
  },
  async fetchJobs(slug) {
    const data = await fetchJson<{ results?: WorkableJob[] }>(`https://apply.workable.com/api/v3/accounts/${slug}/jobs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "", location: [], department: [], worktype: [], remote: [] }),
    });
    if (!data?.results) return null;
    return data.results.map((j) => ({
      externalId: j.shortcode,
      url: j.url || `https://apply.workable.com/${slug}/j/${j.shortcode}/`,
      title: j.title,
      location: [j.location?.city, j.location?.country].filter(Boolean).join(", "),
      descriptionText: "",
      raw: { shortcode: j.shortcode, location: j.location },
    }));
  },
};
