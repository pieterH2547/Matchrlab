import type { AtsAdapter } from "./types";
import { fetchJson } from "@/lib/fetch";
import { firstMatch } from "./util";

type LeverPosting = {
  id: string;
  text: string;
  hostedUrl: string;
  categories?: { location?: string; team?: string };
  descriptionPlain?: string;
};

/** Lever Postings API: publiek, geen key nodig. */
export const lever: AtsAdapter = {
  id: "lever",
  verified: true,
  endpointNote: "GET https://api.lever.co/v0/postings/{slug}?mode=json (JSON-array)",
  detect(html, links) {
    return firstMatch(/jobs\.lever\.co\/([a-z0-9-]+)/i, html, links.join("\n")) ?? firstMatch(/api\.lever\.co\/v0\/postings\/([a-z0-9-]+)/i, html);
  },
  listingUrl(slug) {
    return `https://jobs.lever.co/${slug}`;
  },
  async fetchJobs(slug) {
    const data = await fetchJson<LeverPosting[]>(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    if (!Array.isArray(data)) return null;
    return data.map((p) => ({
      externalId: p.id,
      url: p.hostedUrl,
      title: p.text,
      location: p.categories?.location ?? "",
      descriptionText: (p.descriptionPlain ?? "").slice(0, 600),
      raw: { id: p.id, categories: p.categories },
    }));
  },
};
