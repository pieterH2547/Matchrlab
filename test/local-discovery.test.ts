import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: () => ({}), schema: {} }));
vi.mock("@/lib/search", () => ({}));
import { mapsQueries, mapsBudget, categoryMatches } from "@/lib/pipeline/discover";
import { jobsPageFromSitemap } from "@/lib/pipeline/findJobsPage";
import { municipalitiesWithin, geocode } from "@/lib/geo";
import type { Profile } from "@/lib/pipeline/types";

const profile = {
  candidate_name: "", job_titles: ["boekhouder"], skills: [], years_experience: 5, sectors: ["accountancy"], region: "Kortrijk", radius_km: 20,
  exclusions: [], employer_type: "", search_queries: [], positioning: [], uncertainties: [], open_questions: [], consent: "onbekend", hard_requirements: [],
  related_titles: [], title_variants: [], skill_keywords: [], company_types: ["boekhoudkantoor", "accountantskantoor", "bouwbedrijf"], nearby_municipalities: [], region_lat: 0, region_lng: 0,
} as Profile;

describe("lokale KMO-ontdekking", () => {
  it("deelt het zoekgebied op in gemeenten binnen de straal", () => {
    const m = municipalitiesWithin(geocode("Kortrijk")!, 20);
    expect(m.length).toBeGreaterThan(15);
    expect(m.every((x) => x.km <= 20)).toBe(true);
    expect(m[0].name.toLowerCase()).toContain("kortrijk");
  });
  it("verdeelt het Maps-budget over gemeenten en bedrijfstypes, zonder dubbels", () => {
    const q = mapsQueries(profile);
    expect(q.length).toBe(mapsBudget(20));
    expect(new Set(q).size).toBe(q.length);
    const places = new Set(q.map((x) => x.split(" ").slice(1).join(" ")));
    expect(places.size).toBeGreaterThan(8);
    expect(q.filter((x) => x.startsWith("bouwbedrijf")).length).toBeGreaterThan(1);
  });
  it("hergebruikt enkel bedrijven met een passende categorie", () => {
    expect(categoryMatches("Boekhoudkantoor", profile)).toBe(true);
    expect(categoryMatches("Bakkerij", profile)).toBe(false);
  });
  it("vindt de vacaturepagina in een sitemap", () => {
    const xml = "<urlset><url><loc>https://www.kmo.be/nl/nieuws/x</loc></url><url><loc>https://www.kmo.be/nl/vacatures/boekhouder</loc></url><url><loc>https://www.kmo.be/nl/vacatures</loc></url></urlset>";
    expect(jobsPageFromSitemap(xml, "kmo.be")).toBe("https://www.kmo.be/nl/vacatures");
  });
});
