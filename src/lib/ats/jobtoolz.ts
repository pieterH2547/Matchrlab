import type { AtsAdapter } from "./types";
import { firstMatch } from "./util";

/**
 * Jobtoolz (Belgisch ATS). Er is geen gedocumenteerde publieke feed; de
 * career site op {slug}.jobtoolz.com wordt server-side gerenderd en gaat door
 * de generieke extractie (stap 5). Zodra Jobtoolz een feed bevestigt, hoort
 * die hier in fetchJobs.
 */
export const jobtoolz: AtsAdapter = {
  id: "jobtoolz",
  verified: false,
  endpointNote: "Geen publieke feed bekend; career site https://{slug}.jobtoolz.com/ via generieke extractie",
  detect(html, links) {
    return firstMatch(/https?:\/\/([a-z0-9-]+)\.jobtoolz\.com/i, html, links.join("\n"));
  },
  listingUrl(slug) {
    return `https://${slug}.jobtoolz.com/`;
  },
  async fetchJobs() {
    return null;
  },
};
