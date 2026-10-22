import type { AtsAdapter } from "./types";
import { fetchJson } from "@/lib/fetch";
import { firstMatch } from "./util";

type Posting = {
  id: string;
  name: string;
  location?: { city?: string; country?: string };
  ref?: string;
};

/** SmartRecruiters Posting API: publiek, geen key nodig. De company-id is hoofdlettergevoelig. */
export const smartrecruiters: AtsAdapter = {
  id: "smartrecruiters",
  verified: true,
  endpointNote: "GET https://api.smartrecruiters.com/v1/companies/{company}/postings?limit=100 (JSON, veld content[])",
  detect(html, links) {
    const joined = `${html}\n${links.join("\n")}`;
    const m = joined.match(/(?:jobs|careers|api)\.smartrecruiters\.com\/(?:v1\/companies\/)?([A-Za-z0-9-]+)/);
    return m?.[1] ?? null;
  },
  listingUrl(slug) {
    return `https://jobs.smartrecruiters.com/${slug}`;
  },
  async fetchJobs(slug) {
    const data = await fetchJson<{ content?: Posting[] }>(`https://api.smartrecruiters.com/v1/companies/${slug}/postings?limit=100`);
    if (!data?.content) return null;
    return data.content.map((p) => ({
      externalId: p.id,
      url: `https://jobs.smartrecruiters.com/${slug}/${p.id}`,
      title: p.name,
      location: [p.location?.city, p.location?.country].filter(Boolean).join(", "),
      descriptionText: "",
      raw: { id: p.id, ref: p.ref, location: p.location },
    }));
  },
};

/** `firstMatch` lowercase't; SmartRecruiters heeft hoofdletters nodig, vandaar de eigen regex hierboven. */
void firstMatch;
