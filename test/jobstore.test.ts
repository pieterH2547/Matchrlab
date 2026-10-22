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
  it("laat jobs buiten de straal en met uitsluiting in de titel vallen, maar houdt onbekende plaatsen", () => {
    const jobsIn = [
      { title: "Procesoperator", location: "Willebroek" },
      { title: "Procesoperator", location: "Hasselt" },
      { title: "Procesoperator nachtwerk", location: "Mechelen" },
      { title: "Procesoperator", location: "Ergens-Onbekend" },
      { title: "Procesoperator", location: "België" },
    ];
    expect(prefilterJobs(jobsIn, profile).map((j) => j.location)).toEqual(["Willebroek", "Ergens-Onbekend", "België"]);
  });
});
