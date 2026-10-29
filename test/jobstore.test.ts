import { describe, expect, it } from "vitest";
import { dedupeJobs, normalizeUrl, prefilterJobs, titleKey } from "@/lib/pipeline/jobstore";
import type { Profile } from "@/lib/pipeline/types";

const profile: Profile = {
  candidate_name: "Test",
  job_titles: ["procesoperator"],
  skills: [],
  years_experience: 9,
  sectors: ["chemie"],
  region: "Mechelen",
  radius_km: 25,
  exclusions: ["nachtwerk"],
  employer_type: "",
  search_queries: ["procesoperator Mechelen"],
  positioning: [],
  uncertainties: [],
  open_questions: [],
  consent: "onbekend",
  hard_requirements: [],
};

describe("normalizeUrl", () => {
  it("verwijdert tracking en trailing slash", () => {
    expect(normalizeUrl("https://Acme.be/jobs/1/?utm_source=x&id=2#top")).toBe("https://acme.be/jobs/1/?id=2");
  });
});

describe("dedupeJobs", () => {
  it("dedupliceert op url en op titel+bedrijf", () => {
    const jobsIn = [
      { url: "https://a.be/1", title: "Procesoperator (m/v/x)", companyName: "Acme" },
      { url: "https://a.be/1?utm_source=y", title: "Andere", companyName: "Acme" },
      { url: "https://b.be/9", title: "Procesoperator", companyName: "Acme" },
      { url: "https://c.be/2", title: "Procesoperator", companyName: "Beta" },
    ];
    expect(dedupeJobs(jobsIn).map((j) => j.url)).toEqual(["https://a.be/1", "https://c.be/2"]);
    expect(titleKey("Procesoperator (M/V/X)", "Acme")).toBe(titleKey("procesoperator", "ACME"));
  });
});

describe("prefilterJobs", () => {
  it("regio is strikt voor jobboards: buiten de straal of onherkenbare plaats valt weg", () => {
    const jobsIn = [
      { title: "Procesoperator", location: "Willebroek", source: "vdab" },
      { title: "Procesoperator", location: "Hasselt", source: "vdab" },
      { title: "Procesoperator nachtwerk", location: "Mechelen", source: "vdab" },
      { title: "Procesoperator", location: "Ergens-Onbekend", source: "vdab" },
      { title: "Procesoperator", location: "België", source: "vdab" },
    ];
    expect(prefilterJobs(jobsIn, profile).map((j) => j.location)).toEqual(["Willebroek"]);
  });

  it("bedrijfssites: onbekende plaats blijft, buiten de straal valt weg, tussenpersonen vallen weg", () => {
    const jobsIn = [
      { title: "Procesoperator", location: "", source: "company_site", companyName: "Chemco nv", url: "https://chemco.be/jobs/1" },
      { title: "Procesoperator", location: "Hasselt", source: "company_site", companyName: "Chemco nv", url: "https://chemco.be/jobs/2" },
      { title: "Procesoperator", location: "Mechelen", source: "company_site", companyName: "Accent Jobs", url: "https://accentjobs.be/x" },
      { title: "Procesoperator", location: "Mechelen", source: "company_site", companyName: "Talent Partners", url: "https://tp.be/x" },
      { title: "Procesoperator", location: "Mechelen", source: "company_site", companyName: "XYZ Recruitment", url: "https://xyz.be/x" },
    ];
    expect(prefilterJobs(jobsIn, profile).map((j) => j.url)).toEqual(["https://chemco.be/jobs/1"]);
  });
});
