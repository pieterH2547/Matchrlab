/**
 * Bugfix "er wordt maar één vacature onderzocht": reproduceerbare tests met mocks (geen API-kosten).
 * Bronnen worden gemockt via fetch; instellingen via getSetting; de AI via injecteerbare functies.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const settings: Record<string, string | undefined> = {};
vi.mock("@/lib/settings", () => ({
  getSetting: async (k: string) => settings[k],
  minScore100: async () => 60,
}));
vi.mock("@/lib/search", () => ({ webSearch: async () => [] }));
vi.mock("@/lib/openaiModels", () => ({ resolveOpenAIModel: async () => "gpt-5.4-mini" }));

import { searchJobboards } from "@/lib/pipeline/jobboards";
import { dedupeJobs, prefilterWithReasons } from "@/lib/pipeline/jobstore";
import { applyHardFilters, explainNoMatches, toVerifyFlags, type ScoredLike } from "@/lib/pipeline/filters";
import { preselect, scoreJobs } from "@/lib/pipeline/score";
import { searchOpenAIJobs, isConcreteJobUrl, type ResponsesCaller } from "@/lib/pipeline/aisearch";
import { CostMeter } from "@/lib/llm";
import type { Job } from "@/lib/db/schema";
import type { Profile } from "@/lib/pipeline/types";

const profile: Profile = {
  candidate_name: "Test",
  job_titles: ["procesoperator"],
  skills: ["DCS"],
  years_experience: 9,
  sectors: ["chemie"],
  region: "Mechelen",
  radius_km: 25,
  exclusions: [],
  employer_type: "",
  search_queries: ["procesoperator Mechelen"],
  positioning: [],
  uncertainties: [],
  open_questions: [],
  consent: "onbekend",
  hard_requirements: [],
  related_titles: [],
  title_variants: [],
  skill_keywords: [],
  company_types: [],
  nearby_municipalities: [],
  region_lat: 0,
  region_lng: 0,
};

const noAi = async () => ({ jobs: [], rounds: 0, searches: 0, raw: 0, costEur: 0, durationMs: 0, model: null, queries: [], skipped: "test" });

function googleJob(i: number, company = `Chemco ${i}`) {
  return { title: `Procesoperator ${i}`, company_name: company, location: "Willebroek", description: "Ploegenwerk, DCS.", job_id: `g${i}`, apply_options: [{ title: "Site", link: `https://chemco${i}.be/jobs/${i}` }] };
}
function joobleJob(i: number) {
  return { id: i, title: `Operator productie ${i}`, location: "Mechelen", snippet: "Vast contract", link: `https://be.jooble.org/desc/${i}`, company: `Bedrijf ${i}`, type: "" };
}

type Route = (url: string, init?: RequestInit) => { status: number; body: unknown } | "throw";
function mockFetch(route: Route) {
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const r = route(String(url), init);
    if (r === "throw") throw new Error("netwerkfout");
    return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
  });
}

beforeEach(() => {
  for (const k of Object.keys(settings)) delete settings[k];
});
afterEach(() => vi.unstubAllGlobals());

describe("1. één bron levert 1 vacature, een andere 20", () => {
  it("verwerkt alle 21 unieke resultaten", async () => {
    settings.SERPAPI_API_KEY = "x";
    settings.JOOBLE_API_KEY = "y";
    mockFetch((url) => {
      if (url.includes("serpapi.com")) return { status: 200, body: { jobs_results: [googleJob(1)] } };
      if (url.includes("jooble.org")) return { status: 200, body: { jobs: Array.from({ length: 20 }, (_, i) => joobleJob(i + 1)) } };
      return { status: 404, body: {} };
    });
    const r = await searchJobboards(profile, { ai: noAi });
    // Google Jobs: 1 resultaat per titel, 1 titel → 1; Jooble: 20.
    expect(r.sources.google_jobs.kept).toBe(1);
    expect(r.sources.jooble.kept).toBe(20);
    const unique = dedupeJobs(r.jobs);
    expect(unique).toHaveLength(21);
    expect(prefilterWithReasons(unique, profile).kept).toHaveLength(21);
  });
});

describe("2. één API faalt", () => {
  it("de andere bronnen blijven werken en de fout staat in de diagnose", async () => {
    settings.SERPAPI_API_KEY = "x";
    settings.JOOBLE_API_KEY = "y";
    mockFetch((url) => {
      if (url.includes("jooble.org")) return "throw";
      if (url.includes("serpapi.com")) return { status: 200, body: { jobs_results: [googleJob(1), googleJob(2), googleJob(3)] } };
      return { status: 404, body: {} };
    });
    const failingAi = async () => {
      throw new Error("timeout");
    };
    const r = await searchJobboards(profile, { ai: failingAi });
    expect(r.jobs).toHaveLength(3);
    expect(r.sources.jooble.error).toBeTruthy();
    expect(r.sources.openai_web.error).toContain("timeout");
  });
});

const scored = (over: Partial<ScoredLike> = {}): ScoredLike => ({
  job: { id: 1, url: "https://chemco.be/jobs/1", location: "Willebroek", source: "google_jobs" },
  score: 70,
  contract: "vast",
  employerStatus: "rechtstreeks",
  hardBlocker: "",
  distanceKm: 12,
  ...over,
});

describe("3. contracttype ontbreekt", () => {
  it("blijft staan, met 'contract te verifiëren'", () => {
    const s = scored({ contract: "onbekend" });
    const r = applyHardFilters([s], new Map([[1, "Chemco"]]), profile, 60);
    expect(r.kept).toHaveLength(1);
    expect(toVerifyFlags(s, "Chemco")).toContain("contract te verifiëren");
  });
  it("tijdelijk of interim valt wel weg, met reden", () => {
    const r = applyHardFilters([scored({ contract: "interim" })], new Map([[1, "Chemco"]]), profile, 60);
    expect(r.kept).toHaveLength(0);
    expect(r.reasons.contract_tijdelijk).toBe(1);
  });
});

describe("4. werkgever nog onbekend", () => {
  it("wordt niet als bureau behandeld", () => {
    const s = scored({ employerStatus: "onbekend" });
    const r = applyHardFilters([s], new Map([[1, ""]]), profile, 60);
    expect(r.kept).toHaveLength(1);
    expect(r.reasons.tussenpersoon).toBe(0);
    expect(toVerifyFlags(s, "")).toContain("werkgever te verifiëren");
    const pre = prefilterWithReasons([{ title: "Procesoperator", location: "Mechelen", companyName: "", url: "https://onbekend.be/vacature/1", source: "jooble" }], profile);
    expect(pre.kept).toHaveLength(1);
  });
  it("een bevestigd bureau valt wel weg", () => {
    const pre = prefilterWithReasons([{ title: "Procesoperator", location: "Mechelen", companyName: "Randstad", url: "https://randstad.be/x", source: "jooble" }], profile);
    expect(pre.dropped.tussenpersoon).toBe(1);
  });
});

describe("5. identieke vacatures uit meerdere bronnen", () => {
  it("één keer, de pagina van de werkgever wint", () => {
    const out = dedupeJobs([
      { url: "https://be.jooble.org/desc/1", title: "Procesoperator", companyName: "Chemco nv", source: "jooble" },
      { url: "https://chemco.be/jobs/1?utm_source=google", title: "Procesoperator", companyName: "Chemco", source: "google_jobs" },
      { url: "https://chemco.be/jobs/1", title: "Procesoperator (m/v/x)", companyName: "Chemco", source: "company_site" },
      { url: "https://chemco.be/jobs/2", title: "Elektrotechnicus", companyName: "Chemco", source: "company_site" },
    ]);
    expect(out).toHaveLength(2);
    expect(out[0].source).toBe("company_site");
  });
});

describe("6. API-response met meerdere resultaten en paginering", () => {
  it("neemt alle resultaten en de volgende pagina mee, niet één", async () => {
    settings.SERPAPI_API_KEY = "x";
    mockFetch((url) => {
      if (url.includes("serpapi.com")) {
        const page2 = url.includes("next_page_token");
        const base = page2 ? 10 : 0;
        return { status: 200, body: { jobs_results: Array.from({ length: 10 }, (_, i) => googleJob(base + i + 1)), serpapi_pagination: page2 ? {} : { next_page_token: "abc" } } };
      }
      return { status: 404, body: {} };
    });
    const r = await searchJobboards(profile, { ai: noAi });
    expect(r.sources.google_jobs.queries).toBe(2);
    expect(r.sources.google_jobs.raw).toBe(20);
    expect(r.jobs).toHaveLength(20);
  });
});

describe("7. geen matches boven 6/10", () => {
  it("geeft een verklaring met aantallen per fase en per filter", () => {
    const list = [scored({ score: 50 }), scored({ job: { id: 2, url: "https://x.be/v/2", location: "Mechelen", source: "jooble" }, score: 40 }), scored({ job: { id: 3, url: "https://y.be/v/3", location: "Mechelen", source: "jooble" }, contract: "tijdelijk" })];
    const r = applyHardFilters(list, new Map([[1, "A"], [2, "B"], [3, "C"]]), profile, 60);
    expect(r.kept).toHaveLength(0);
    const text = explainNoMatches({ found: 48, siteJobs: 12, unique: 40, checked: 30, closed: 2, toScoring: 28, scored: 28, reasons: r.reasons }, 60);
    expect(text).toContain("Gevonden: 60 vacatures");
    expect(text).toContain("Effectief gescoord: 28 van 28");
    expect(text).toContain("2 onder de matchdrempel");
    expect(text).toContain("1 tijdelijk, interim of freelance");
    expect(text).not.toMatch(/Ik bekeek 1 vacatures/);
  });
});

function job(id: number, title: string): Job {
  return { id, title, url: `https://e${id}.be/vacature/${id}`, source: "jooble", location: "Mechelen", descriptionText: "", companyId: null, externalId: null, raw: null, firstSeenAt: new Date(), lastSeenAt: new Date() } as unknown as Job;
}

describe("AI-stappen laten nooit stil vacatures vallen", () => {
  it("voorselectie: verkeerde id's van de AI → aanvullen op titelgelijkenis", async () => {
    const jobsIn = Array.from({ length: 60 }, (_, i) => job(i + 1, i % 2 ? "Procesoperator chemie" : "Boekhouder"));
    const info = { input: 0, aiKept: 0, filled: 0, output: 0, aiFailed: false };
    const out = await preselect(profile, jobsIn, new Map(), new CostMeter(), info, async () => [1, 9999]);
    expect(info.aiKept).toBe(1);
    expect(out.length).toBeGreaterThanOrEqual(15);
    // De AI hield enkel id 1 (een boekhouder); de aanvulling kiest de vacatures die op de functietitel lijken.
    expect(out.filter((j) => j.title === "Procesoperator chemie").length).toBe(out.length - 1);
  });

  it("scoring: ontbrekende id's worden opnieuw gevraagd", async () => {
    const jobsIn = Array.from({ length: 25 }, (_, i) => job(i + 1, "Procesoperator"));
    let calls = 0;
    const info = { requested: 0, scored: 0, missing: 0, batches: 0, failedBatches: 0 };
    const res = await scoreJobs(profile, jobsIn, new Map(), new CostMeter(), info, async (batch) => {
      calls += 1;
      // Eerste ronde: het model vergeet de helft; tweede ronde: alles.
      const subset = calls <= 3 ? batch.filter((_, i) => i % 2 === 0) : batch;
      return {
        intro: "x",
        followups: ["a", "b"],
        scores: subset.map((j) => ({ id: j.id, kerntaken: 3, vaardigheden: 2, senioriteit: 1, sector: 1, mobiliteit: 1, contract: "onbekend", distance_km: 10, employer_status: "onbekend", hard_blocker: "", argument: "a", risk: "r" })),
      };
    });
    expect(res.scored).toHaveLength(25);
    expect(info.missing).toBe(0);
  });
});

describe("OpenAI Web Search (gemockt)", () => {
  it("zoekt in rondes, stuurt bij na een magere ronde en weigert vage links", async () => {
    settings.OPENAI_API_KEY = "x";
    const inputs: string[] = [];
    let n = 0;
    const call: ResponsesCaller = async (body) => {
      n += 1;
      inputs.push(String(body.input));
      const vac =
        n === 1
          ? [
              { title: "Procesoperator", company: "Chemco", location: "Willebroek", url: "https://chemco.be/jobs/procesoperator", contract: "vast", employer_status: "rechtstreeks", evidence: "DCS" },
              { title: "Operator", company: "Pharma", location: "Puurs", url: "https://www.google.com/search?q=operator", contract: "onbekend", employer_status: "onbekend", evidence: "" },
            ]
          : n === 2
            ? []
            : [{ title: "Productieoperator", company: "Food nv", location: "Duffel", url: "https://food.recruitee.com/o/productieoperator", contract: "onbekend", employer_status: "onbekend", evidence: "" }];
      return {
        status: 200,
        data: {
          output: [
            { type: "web_search_call", action: { type: "search", query: `zoek ${n}` } },
            { type: "message", content: [{ type: "output_text", text: JSON.stringify({ vacancies: vac, explored: { titles: ["procesoperator"], municipalities: ["Mechelen"] } }) }] },
          ],
          usage: { input_tokens: 1000, output_tokens: 200 },
        },
      };
    };
    const r = await searchOpenAIJobs(profile, { call, config: { enabled: true, rounds: 3, maxCostEur: 1, model: "gpt-5.4-mini", hasKey: true } });
    expect(r.rounds).toBe(3);
    expect(r.searches).toBe(3);
    expect(r.jobs.map((j) => j.title)).toEqual(["Procesoperator", "Productieoperator"]);
    expect(r.jobs[0].source).toBe("openai_web");
    expect(inputs[2]).toContain("Verander van strategie");
    expect(inputs[1]).toContain("zoek 1");
    expect(r.costEur).toBeGreaterThan(0);
  });

  it("stopt bij het kostenplafond", async () => {
    settings.OPENAI_API_KEY = "x";
    let n = 0;
    const call: ResponsesCaller = async () => {
      n += 1;
      return { status: 200, data: { output: Array.from({ length: 20 }, () => ({ type: "web_search_call" })), output_text: '{"vacancies":[],"explored":{"titles":[],"municipalities":[]}}' } };
    };
    await searchOpenAIJobs(profile, { call, config: { enabled: true, rounds: 5, maxCostEur: 0.1, model: "gpt-5.4-mini", hasKey: true } });
    expect(n).toBe(1);
  });

  it("concrete vacaturelink", () => {
    expect(isConcreteJobUrl("https://www.vdab.be/vindeenjob/vacatures/12345/procesoperator")).toBe(true);
    expect(isConcreteJobUrl("https://chemco.be/")).toBe(false);
    expect(isConcreteJobUrl("https://www.vdab.be/vindeenjob/vacatures?trefwoord=operator")).toBe(true);
    expect(isConcreteJobUrl("https://www.indeed.com/jobs?q=operator")).toBe(false);
  });
});

describe("Reproduceerbare trechter (aantallen per fase)", () => {
  it("drukt de aantallen af voor het rapport", async () => {
    settings.SERPAPI_API_KEY = "x";
    settings.JOOBLE_API_KEY = "y";
    mockFetch((url) => {
      if (url.includes("serpapi.com")) return { status: 200, body: { jobs_results: [googleJob(1), googleJob(2), { ...googleJob(3), location: "Hasselt" }, { ...googleJob(4), company_name: "Randstad" }] } };
      if (url.includes("jooble.org")) return { status: 200, body: { jobs: [...Array.from({ length: 18 }, (_, i) => joobleJob(i + 1)), { ...joobleJob(99), location: "België" }, { ...joobleJob(1) }] } };
      return { status: 404, body: {} };
    });
    const r = await searchJobboards(profile, { ai: noAi });
    const unique = dedupeJobs(r.jobs);
    const pf = prefilterWithReasons(unique, profile);
    const counts = { gevonden: r.jobs.length, perBron: Object.fromEntries(Object.entries(r.sources).map(([k, v]) => [k, v.kept])), uniek: unique.length, dubbels: r.jobs.length - unique.length, wegLocatie: pf.dropped.regio, wegTussenpersoon: pf.dropped.tussenpersoon, naarVolgendeFase: pf.kept.length };
    console.log("TRECHTER", JSON.stringify(counts));
    expect(counts.naarVolgendeFase).toBeGreaterThan(1);
    expect(counts.wegTussenpersoon).toBe(1);
  });
});
