import { describe, expect, it } from "vitest";
import { passwordMatches } from "@/lib/auth";

describe("beheerderswachtwoord", () => {
  it("vergelijkt in constante tijd en exact", () => {
    expect(passwordMatches("geheim-123", "geheim-123")).toBe(true);
    expect(passwordMatches("geheim-12", "geheim-123")).toBe(false);
    expect(passwordMatches("", "x")).toBe(false);
  });
});

import { diffFields, sanitizeFields, type SearchFieldValues } from "@/lib/pipeline/refine";

const base: SearchFieldValues = {
  job_titles: ["Payroll officer"],
  related_titles: [],
  title_variants: ["gestionnaire de paie"],
  region: "Leuven",
  radius_km: 25,
  years_experience: 4,
  skills: ["SD Worx", "Excel"],
  skill_keywords: [],
  sectors: [],
  company_types: [],
  exclusions: [],
};

describe("zoekvelden in gewone taal", () => {
  it("begrenst straal en ervaring, ontdubbelt en houdt titels nooit leeg", () => {
    const r = sanitizeFields({ job_titles: [], radius_km: 400, years_experience: -3, skills: ["Excel", "excel", " SAP  HR "] }, base);
    expect(r.job_titles).toEqual(["Payroll officer"]);
    expect(r.radius_km).toBe(150);
    expect(r.years_experience).toBe(0);
    expect(r.skills).toEqual(["Excel", "SAP HR"]);
  });
  it("laat ontbrekende velden ongemoeid en beschrijft wat veranderde", () => {
    const r = sanitizeFields({ region: "Gent", radius_km: 40, exclusions: ["ploegenwerk"] }, base);
    expect(r.skills).toEqual(base.skills);
    expect(diffFields(base, r)).toEqual(["+ ploegenwerk", "regio Leuven → Gent", "straal 25 → 40 km"]);
  });
});
