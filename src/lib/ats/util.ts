import * as cheerio from "cheerio";

/** Eerste match van een regex met een capture group, of null. */
export function firstMatch(re: RegExp, ...sources: string[]): string | null {
  for (const s of sources) {
    const m = s.match(re);
    if (m?.[1]) return m[1].toLowerCase();
  }
  return null;
}

export function stripHtml(html: string | undefined | null, max = 600): string {
  if (!html) return "";
  const $ = cheerio.load(`<div>${html}</div>`);
  return $("div").text().replace(/\s+/g, " ").trim().slice(0, max);
}

export function joinLinks(links: string[]): string {
  return links.join("\n");
}
