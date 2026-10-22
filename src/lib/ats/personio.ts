import * as cheerio from "cheerio";
import type { AtsAdapter } from "./types";
import { fetchRaw } from "@/lib/fetch";
import { stripHtml } from "./util";

/** Personio: elke career page heeft een publieke XML-feed op /xml. */
export const personio: AtsAdapter = {
  id: "personio",
  verified: false,
  endpointNote: "GET https://{slug}.jobs.personio.de/xml (XML, <position> met id/name/office/jobDescriptions)",
  detect(html, links) {
    const m = `${html}\n${links.join("\n")}`.match(/https?:\/\/([a-z0-9-]+)\.jobs\.personio\.(de|com)/i);
    return m ? `${m[1].toLowerCase()}.jobs.personio.${m[2].toLowerCase()}` : null;
  },
  listingUrl(slug) {
    return `https://${slug}/`;
  },
  async fetchJobs(slug) {
    const r = await fetchRaw(`https://${slug}/xml`);
    if (r.status !== 200 || !r.body.includes("<position")) return null;
    const $ = cheerio.load(r.body, { xml: true });
    const jobs = $("position")
      .map((_, el) => {
        const $el = $(el);
        const id = $el.find("id").first().text().trim();
        const title = $el.find("name").first().text().trim();
        const office = $el.find("office").first().text().trim();
        const desc = $el.find("jobDescription value").first().text();
        return id && title
          ? { externalId: id, url: `https://${slug}/job/${id}`, title, location: office, descriptionText: stripHtml(desc) }
          : null;
      })
      .get()
      .filter((j): j is NonNullable<typeof j> => j !== null);
    return jobs.length ? jobs : null;
  },
};
