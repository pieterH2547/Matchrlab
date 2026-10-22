import type { AtsAdapter } from "./types";
import { fetchJson } from "@/lib/fetch";
import { firstMatch, stripHtml } from "./util";

type GhJob = { id: number; title: string; absolute_url: string; location?: { name?: string }; content?: string };

/** Greenhouse Job Board API: publiek, geen key nodig. */
export const greenhouse: AtsAdapter = {
  id: "greenhouse",
  verified: true,
  endpointNote: "GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true (JSON, veld jobs[])",
  detect(html, links) {
    return firstMatch(/(?:boards|job-boards|boards-api)\.greenhouse\.io\/(?:v1\/boards\/|embed\/job_board\?for=)?([a-z0-9-]+)/i, html, links.join("\n"));
  },
  listingUrl(slug) {
    return `https://job-boards.greenhouse.io/${slug}`;
  },
  async fetchJobs(slug) {
    const data = await fetchJson<{ jobs?: GhJob[] }>(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=true`);
    if (!data?.jobs) return null;
    return data.jobs.map((j) => ({
      externalId: String(j.id),
      url: j.absolute_url,
      title: j.title,
      location: j.location?.name ?? "",
      descriptionText: stripHtml(j.content),
      raw: { id: j.id, title: j.title, location: j.location },
    }));
  },
};
