import type { AtsAdapter } from "./types";
import { firstMatch } from "./util";

/**
 * Talentfinder (Profile Group, Belgisch ATS). Geen publieke feed bekend; de
 * career page zit meestal op {slug}.talentfinder.be en gaat door de generieke
 * extractie (stap 5).
 */
export const talentfinder: AtsAdapter = {
  id: "talentfinder",
  verified: false,
  endpointNote: "Geen publieke feed bekend; career page https://{slug}.talentfinder.be/ via generieke extractie",
  detect(html, links) {
    const slug = firstMatch(/https?:\/\/([a-z0-9-]+)\.talentfinder\.be/i, html, links.join("\n"));
    return slug && slug !== "www" ? slug : null;
  },
  listingUrl(slug) {
    return `https://${slug}.talentfinder.be/`;
  },
  async fetchJobs() {
    return null;
  },
};
