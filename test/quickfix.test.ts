/** Regressietests quick fix sprint: locatie, zoekdekking, ontbrekende gegevens, scoringsinput, diversiteit, verificatie. */
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/settings", () => ({ getSetting: async () => undefined, minScore100: async () => 60 }));
vi.mock("@/lib/search", () => ({ webSearch: async () => [] }));
vi.mock("@/lib/openaiModels", () => ({ resolveOpenAIModel: async () => "gpt-5.4-mini" }));
import { applyHardFilters, toVerifyFlags, type ScoredLike } from "@/lib/pipeline/filters";
import { locationStatus, prefilterWithReasons } from "@/lib/pipeline/jobstore";
import { targetedQueries, searchPlaces } from "@/lib/pipeline/jobboards";
import { relevantExcerpt, diversify } from "@/lib/pipeline/score";
import { confirmedThisRun } from "@/lib/pipeline/verify";
import type { Profile } from "@/lib/pipeline/types";

const profile = {
  candidate_name: "", job_titles: ["procesoperator", "productieoperator"], skills: [], years_experience: 8, sectors: ["chemie"], region: "Mechelen", radius_km: 25,
  exclusions: [], employer_type: "", search_queries: [], positioning: [], uncertainties: [], open_questions: [], consent: "onbekend", hard_requirements: [],
  related_titles: ["operator chemie"], title_variants: ["process operator", "opérateur de production"], skill_keywords: ["DCS"], company_types: [], nearby_municipalities: [], region_lat: 0, region_lng: 0,
} as Profile;

const s = (over: Partial<ScoredLike> = {}): ScoredLike => ({
  job: { id: 1, url: "https://chemco.be/jobs/1", location: "Willebroek", source: "jooble" },
  score: 70, contract: "vast", employerStatus: "rechtstreeks", hardBlocker: "", distanceKm: 12, ...over,
});

describe("1. locatie: bevestigd buiten vs. nog niet gekend", () => {
  it("drie toestanden", () => {
    expect(locationStatus("Willebroek", profile)).toBe("binnen");
    expect(locationStatus("Hasselt", profile)).toBe("buiten");
    expect(locationStatus("", profile)).toBe("onbekend");
    expect(locationStatus("België", profile)).toBe("onbekend");
  });
  it("vage plaats verdwijnt niet in de voorfilter", () => {
    expect(prefilterWithReasons([{ title: "Operator", location: "België", source: "jooble" }], profile).kept).toHaveLength(1);
  });
  it("eindfilter: onbekende afstand blijft met 'locatie te verifiëren'; bevestigd buiten valt weg", () => {
    const unknown = s({ job: { id: 2, url: "https://x.be/v/2", location: "België", source: "jooble" }, distanceKm: -1 });
    const out = s({ job: { id: 3, url: "https://y.be/v/3", location: "Hasselt", source: "jooble" }, distanceKm: 5 });
    const r = applyHardFilters([unknown, out], new Map([[2, "X"], [3, "Y"]]), profile, 60);
    expect(r.kept.map((x) => x.job.id)).toEqual([2]);
    expect(r.reasons.buiten_straal).toBe(1);
    expect(toVerifyFlags(unknown, "X", profile)).toContain("locatie te verifiëren");
  });
  it("onze gemeentelijst gaat voor op een foute AI-afstand", () => {
    const r = applyHardFilters([s({ distanceKm: 60 })], new Map([[1, "Chemco"]]), profile, 60);
    expect(r.kept).toHaveLength(1);
  });
});

describe("2. zoekdekking binnen budget", () => {
  it("verdeelt over bronnen, titels en gemeenten, zonder dubbels", () => {
    const q = targetedQueries(profile);
    expect(q.length).toBe(10);
    expect(new Set(q.map((x) => x.q)).size).toBe(q.length);
    expect(new Set(q.map((x) => x.kind)).size).toBe(5);
    expect(q.some((x) => x.q.includes("productieoperator"))).toBe(true);
    const places = searchPlaces(profile, 3);
    expect(places.length).toBe(3);
    expect(q.some((x) => x.q.includes(places[1]))).toBe(true);
    expect(q[1].q).toContain('"process operator"');
  });
  it("een kleiner budget houdt de belangrijkste vragen", () => {
    expect(targetedQueries(profile, { budget: 4 }).map((x) => x.kind)).toEqual(["vdab", "indeed", "linkedin", "ats"]);
  });
});

describe("3. ontbrekende gegevens", () => {
  it("onbekend contract en onbekende werkgever blijven, met labels", () => {
    const x = s({ contract: "onbekend", employerStatus: "onbekend" });
    const r = applyHardFilters([x], new Map([[1, ""]]), profile, 60);
    expect(r.kept).toHaveLength(1);
    expect(toVerifyFlags(x, "", profile)).toEqual(["contract te verifiëren", "werkgever te verifiëren"]);
  });
});

describe("4. scoringsinput", () => {
  it("houdt taken en vereisten, laat cookietekst vallen", () => {
    const text = "Welkom bij ons familiebedrijf. ".repeat(30) + "Je taken: bediening van de DCS en procesopvolging. Vereisten: VCA en ploegenwerk. Wij gebruiken cookies voor statistieken.";
    const ex = relevantExcerpt(text, 200);
    expect(ex).toContain("DCS");
    expect(ex).toContain("VCA");
    expect(ex).not.toContain("cookies");
    expect(ex.length).toBeLessThanOrEqual(200);
  });
});

describe("5. diversiteit", () => {
  it("niet bijna alles uit één bron of één titel als er alternatieven zijn", () => {
    const ranked = [
      ...Array.from({ length: 30 }, (_, i) => ({ id: i, source: "jooble", title: "Procesoperator (m/v/x)" })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, source: "company_site", title: `Operator chemie ${i}` })),
      ...Array.from({ length: 10 }, (_, i) => ({ id: 200 + i, source: "google_jobs", title: `Productiemedewerker ${i}` })),
    ];
    const out = diversify(ranked, 20);
    expect(out).toHaveLength(20);
    expect(out.filter((j) => j.source === "jooble").length).toBeLessThanOrEqual(10);
    expect(out.some((j) => j.source === "company_site")).toBe(true);
  });
  it("vult aan als er geen alternatieven zijn", () => {
    const ranked = Array.from({ length: 30 }, (_, i) => ({ id: i, source: "jooble", title: "Procesoperator" }));
    expect(diversify(ranked, 20)).toHaveLength(20);
  });
});

describe("7. verificatie: recent opgeslagen is niet actief bevestigd", () => {
  const start = Date.now() - 60_000;
  it("enkel actief als in deze run op de jobpagina gezien", () => {
    expect(confirmedThisRun({ url: "u", title: "t", source: "company_site", lastSeenAt: new Date() }, start)?.status).toBe("actief");
    expect(confirmedThisRun({ url: "u", title: "t", source: "company_site", lastSeenAt: new Date(start - 3600_000) }, start)).toBeNull();
    expect(confirmedThisRun({ url: "u", title: "t", source: "jooble", lastSeenAt: new Date() }, start)).toBeNull();
  });
});
