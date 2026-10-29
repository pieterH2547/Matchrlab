/** Speed & architecture: trage/onbereikbare bronnen, lege/warme index, veel vacatures, geen relevante, hervatten. */
import { afterEach, describe, expect, it, vi } from "vitest";
const settings: Record<string, string | undefined> = {};
vi.mock("@/lib/settings", () => ({ getSetting: async (k: string) => settings[k], minScore100: async () => 60 }));
vi.mock("@/lib/search", () => ({ webSearch: async () => [] }));
vi.mock("@/lib/openaiModels", () => ({ resolveOpenAIModel: async () => "gpt-5.4-mini" }));
vi.mock("@/lib/db", () => ({ db: () => ({}), schema: {} }));
import { searchJobboards } from "@/lib/pipeline/jobboards";
import { quickShortlist, scoreJobs } from "@/lib/pipeline/score";
import { freshVerification, scoreKey, contentHash, SCORING_VERSION, VERIFY_TTL_MS } from "@/lib/pipeline/index-cache";
import { CostMeter } from "@/lib/llm";
import type { Job } from "@/lib/db/schema";
import type { Profile } from "@/lib/pipeline/types";

const profile = {
  candidate_name: "", job_titles: ["boekhouder"], skills: ["btw"], years_experience: 5, sectors: [], region: "Kortrijk", radius_km: 20, exclusions: [], employer_type: "",
  search_queries: [], positioning: [], uncertainties: [], open_questions: [], consent: "onbekend", hard_requirements: [], related_titles: ["accountant"], title_variants: ["comptable"],
  skill_keywords: ["btw-aangiften"], company_types: [], nearby_municipalities: [], region_lat: 0, region_lng: 0,
} as Profile;
const noAi = async () => ({ jobs: [], rounds: 0, searches: 0, raw: 0, costEur: 0, durationMs: 0, model: null, queries: [], skipped: "test" });
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of Object.keys(settings)) delete settings[k];
});

describe("Fast Search wacht niet op een trage bron", () => {
  it("een bron die 3 s duurt, wordt na de limiet losgelaten; de andere resultaten zijn er meteen", async () => {
    settings.SERPAPI_API_KEY = "x";
    settings.JOOBLE_API_KEY = "y";
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("serpapi.com")) await new Promise((r) => setTimeout(r, 3000));
      if (String(url).includes("jooble.org"))
        return new Response(JSON.stringify({ jobs: [{ id: 1, title: "Boekhouder", location: "Kortrijk", link: "https://be.jooble.org/desc/1", company: "Acme" }] }), { status: 200 });
      return new Response("{}", { status: 200 });
    });
    const t = Date.now();
    const r = await searchJobboards(profile, { ai: noAi, timeoutMs: 300 });
    expect(Date.now() - t).toBeLessThan(1500);
    expect(r.slow).toContain("google_jobs");
    expect(r.jobs.some((j) => j.source === "jooble")).toBe(true);
  });
  it("een onbereikbare bron geeft een fout in de diagnose, de rest werkt", async () => {
    settings.JOOBLE_API_KEY = "y";
    settings.SERPAPI_API_KEY = "x";
    vi.stubGlobal("fetch", async (url: string) => {
      if (String(url).includes("serpapi.com")) throw new Error("ECONNREFUSED");
      return new Response(JSON.stringify({ jobs: [{ id: 2, title: "Accountant", location: "Kortrijk", link: "https://be.jooble.org/desc/2", company: "B" }] }), { status: 200 });
    });
    const r = await searchJobboards(profile, { ai: noAi, timeoutMs: 2000 });
    expect(r.sources.google_jobs.error).toBeTruthy();
    expect(r.jobs.length).toBeGreaterThan(0);
  });
});

const job = (id: number, title: string, source = "jooble"): Job => ({ id, title, url: `https://e${id}.be/v/${id}`, source, location: "Kortrijk", descriptionText: "", companyId: null, externalId: null, raw: null } as unknown as Job);

describe("vacature-index en caches", () => {
  it("lege index: geen hergebruik; verse controle: wel, met tijdstip; oude: opnieuw controleren", () => {
    expect(freshVerification({ verifiedAt: null, verificationStatus: null })).toBeNull();
    const fresh = freshVerification({ verifiedAt: new Date(), verificationStatus: "actief", verificationReason: "titel gevonden" });
    expect(fresh?.status).toBe("actief");
    expect(fresh?.reason).toContain("gecontroleerd");
    expect(freshVerification({ verifiedAt: new Date(Date.now() - VERIFY_TTL_MS - 1000), verificationStatus: "actief" })).toBeNull();
  });
  it("scorecache enkel bij zelfde profiel, vacaturetekst en scoringsversie", () => {
    const h = contentHash({ title: "Boekhouder", descriptionText: "btw" });
    expect(scoreKey(profile, h)).toBe(scoreKey({ ...profile, candidate_name: "Andere naam" }, h));
    expect(scoreKey(profile, h)).not.toBe(scoreKey({ ...profile, radius_km: 30 }, h));
    expect(scoreKey(profile, h)).not.toBe(scoreKey(profile, contentHash({ title: "Boekhouder", descriptionText: "btw, nieuw" })));
    expect(scoreKey(profile, h)).toContain(SCORING_VERSION);
  });
  it("warme cache en hervatten: al gescoorde vacatures worden niet opnieuw aan de AI gevraagd", async () => {
    const jobs = [job(1, "Boekhouder"), job(2, "Accountant")];
    const cache = new Map([[1, { id: 1, kerntaken: 3, vaardigheden: 3, senioriteit: 2, sector: 1, mobiliteit: 1, contract: "vast" as const, distance_km: 5, employer_status: "rechtstreeks" as const, hard_blocker: "", argument: "a", risk: "r" }]]);
    const asked: number[] = [];
    const res = await scoreJobs(profile, jobs, new Map(), new CostMeter(), undefined, async (b) => {
      asked.push(...b.map((j) => j.id));
      return { intro: "", followups: ["a", "b"], scores: b.map((j) => ({ ...cache.get(1)!, id: j.id })) };
    }, cache, 4);
    expect(asked).toEqual([2]);
    expect(res.scored).toHaveLength(2);
  });
});

describe("snelle shortlist", () => {
  it("veel vacatures: 5.000 in ruim minder dan een halve seconde, relevante eerst", () => {
    const many = Array.from({ length: 5000 }, (_, i) => job(i, i % 50 === 0 ? "Boekhouder KMO" : `Magazijnier ${i}`, i % 3 ? "jooble" : "google_jobs"));
    const t = performance.now();
    const top = quickShortlist(profile, many, 12);
    expect(performance.now() - t).toBeLessThan(500);
    expect(top).toHaveLength(12);
    expect(top.slice(0, 5).every((j) => j.title.startsWith("Boekhouder"))).toBe(true);
  });
  it("geen relevante vacatures: nog steeds een shortlist (de AI-score beslist), geen crash", () => {
    const top = quickShortlist(profile, [job(1, "Kok"), job(2, "Chauffeur")], 12);
    expect(top).toHaveLength(2);
  });
});
