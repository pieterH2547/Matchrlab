import type { AtsAdapter } from "./types";
import { fetchJson } from "@/lib/fetch";
import { firstMatch, stripHtml } from "./util";

type Offer = {
  id: number;
  title: string;
  location?: string;
  city?: string;
  careers_url?: string;
  description?: string;
  requirements?: string;
};

/** Recruitee: https://{slug}.recruitee.com/api/offers/ geeft alle open vacatures als JSON. */
export const recruitee: AtsAdapter = {
  id: "recruitee",
  verified: true,
  endpointNote: "GET https://{slug}.recruitee.com/api/offers/ (JSON, veld offers[])",
  detect(html, links) {
    return firstMatch(/https?:\/\/([a-z0-9-]+)\.recruitee\.com/i, html, links.join("\n"));
  },
  listingUrl(slug) {
    return `https://${slug}.recruitee.com/`;
  },
  async fetchJobs(slug) {
    const data = await fetchJson<{ offers?: Offer[] }>(`https://${slug}.recruitee.com/api/offers/`);
    if (!data?.offers) return null;
    return data.offers.map((o) => ({
      externalId: String(o.id),
      url: o.careers_url || `https://${slug}.recruitee.com/o/${o.id}`,
      title: o.title,
      location: o.location || o.city || "",
      descriptionText: stripHtml(`${o.description ?? ""} ${o.requirements ?? ""}`),
      raw: o,
    }));
  },
};
