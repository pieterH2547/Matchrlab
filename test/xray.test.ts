/** Boolean X-ray: werkt voor elke sector, zonder vaste lijsten; controle en adaptieve volgorde. */
import { describe, expect, it } from "vitest";
import { normalizeXray, orderByYield, type XrayItem } from "@/lib/pipeline/xray";
import type { Profile } from "@/lib/pipeline/types";

const base = (region: string): Profile =>
  ({ candidate_name: "", job_titles: [], skills: [], years_experience: 3, sectors: [], region, radius_km: 25, exclusions: [], employer_type: "", search_queries: [], positioning: [], uncertainties: [], open_questions: [], consent: "onbekend", hard_requirements: [], related_titles: [], title_variants: [], skill_keywords: [], company_types: [], nearby_municipalities: ["Lier"], region_lat: 0, region_lng: 0 }) as Profile;

const plans: Record<string, XrayItem[]> = {
  zorg: [
    { query: '("verpleegkundige" OR "infirmier" OR "nurse") site:linkedin.com/jobs Gent', intent: "meertalig", channel: "linkedin" },
    { query: '"verpleegkundige" "werken bij" woonzorgcentrum Gent', intent: "verborgen", channel: "bedrijf" },
  ],
  it: [
    { query: '("java developer" OR "backend developer") (site:recruitee.com OR site:teamtailor.com)', intent: "synoniem", channel: "ats" },
    { query: '"java developer" site:linkedin.com/in Antwerpen', intent: "exact", channel: "linkedin" },
  ],
  horeca: [{ query: '("kok" OR "chef de partie" OR "cuisinier") vacature Brugge', intent: "exact", channel: "algemeen" }],
  logistiek: [
    { query: '("vrachtwagenchauffeur" OR "chauffeur CE") site:randstad.be', intent: "exact", channel: "sector" },
    { query: '("vrachtwagenchauffeur" OR "chauffeur CE") site:be.indeed.com Hasselt', intent: "synoniem", channel: "indeed" },
  ],
  juridisch: [{ query: '"paralegal" OR "juridisch medewerker"', intent: "aansluitend", channel: "linkedin" }],
};

describe("X-ray voor verschillende sectoren", () => {
  it("zorg: meertalig LinkedIn Jobs blijft, eigen sites krijgen uitsluiting van bureaus", () => {
    const q = normalizeXray(plans.zorg, base("Gent"));
    expect(q).toHaveLength(2);
    expect(q[0].kind).toBe("linkedin");
    expect(q[1].q).toContain("-interim");
  });
  it("IT: nooit LinkedIn-profielen (/in/), ATS-zoekopdracht krijgt de regio", () => {
    const q = normalizeXray(plans.it, base("Antwerpen"));
    expect(q).toHaveLength(1);
    expect(q[0].kind).toBe("ats");
    expect(q[0].q).toContain("Antwerpen");
  });
  it("horeca en logistiek: geen sites van uitzendkantoren", () => {
    expect(normalizeXray(plans.horeca, base("Brugge"))).toHaveLength(1);
    const l = normalizeXray(plans.logistiek, base("Hasselt"));
    expect(l).toHaveLength(1);
    expect(l[0].kind).toBe("indeed");
  });
  it("juridisch: LinkedIn-kanaal zonder site: krijgt site:linkedin.com/jobs en een plaats", () => {
    const q = normalizeXray(plans.juridisch, base("Mechelen"));
    expect(q[0].q.startsWith("site:linkedin.com/jobs")).toBe(true);
    expect(q[0].q).toContain("Mechelen");
  });
  it("adaptief: intenties met resultaten eerst, zonder resultaat achteraan", () => {
    const qs = [
      { q: "a", kind: "site" as const, intent: "exact" as const },
      { q: "b", kind: "site" as const, intent: "verborgen" as const },
      { q: "c", kind: "site" as const, intent: "lokaal" as const },
    ];
    expect(orderByYield(qs, { exact: 0, verborgen: 4 }, 3).map((x) => x.q)).toEqual(["b", "c", "a"]);
  });
});
