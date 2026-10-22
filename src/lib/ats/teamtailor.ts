import * as cheerio from "cheerio";
import type { AtsAdapter } from "./types";
import { fetchRaw } from "@/lib/fetch";
import { firstMatch } from "./util";

/**
 * Teamtailor: career sites bieden een publieke RSS-feed op /jobs.rss. Sommige
 * klanten gebruiken een eigen domein; dan werkt de detectie via de link
 * "powered by teamtailor" of het script op cdn.teamtailor.com niet op slug
 * en valt de pijplijn terug op de generieke extractie.
 */
export const teamtailor: AtsAdapter = {
  id: "teamtailor",
  verified: false,
  endpointNote: "GET https://{slug}.teamtailor.com/jobs.rss (RSS, items met title/link/description)",
  detect(html, links) {
    return firstMatch(/https?:\/\/([a-z0-9-]+)\.teamtailor\.com/i, html, links.join("\n"));
  },
  listingUrl(slug) {
    return `https://${slug}.teamtailor.com/jobs`;
  },
  async fetchJobs(slug) {
    const r = await fetchRaw(`https://${slug}.teamtailor.com/jobs.rss`);
    if (r.status !== 200 || !r.body.includes("<item")) return null;
    const $ = cheerio.load(r.body, { xml: true });
    const jobs = $("item")
      .map((_, el) => {
        const $el = $(el);
        const url = $el.find("link").first().text().trim();
        const title = $el.find("title").first().text().trim();
        const location = $el.find("location, teamtailor\\:location").first().text().trim();
        const description = $el.find("description").first().text().replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 600);
        return url && title ? { url, title, location, descriptionText: description, externalId: url } : null;
      })
      .get()
      .filter((j): j is NonNullable<typeof j> => j !== null);
    return jobs.length ? jobs : null;
  },
};
