import { describe, expect, it } from "vitest";
import { guessCandidateName, fallbackLabel } from "@/lib/candidateName";

describe("kandidaatnaam zonder AI", () => {
  it("uit de bestandsnaam", () => {
    expect(guessCandidateName("CV_Jan_Peeters.pdf", "")).toBe("Jan Peeters");
    expect(guessCandidateName("cv-SARAH-VAN-DEN-BROECK-2026.docx", "")).toBe("Sarah van den Broeck");
    expect(guessCandidateName("Curriculum Vitae.pdf", "")).toBeNull();
  });
  it("uit de eerste regels van het cv", () => {
    expect(guessCandidateName("cv.pdf", "Ecem Akpinar\nTax consultant\nAntwerpen")).toBe("Ecem Akpinar");
    expect(guessCandidateName("cv.pdf", "CURRICULUM VITAE\n0470 12 34 56\njan@x.be")).toBeNull();
  });
  it("nooit 'Onbekende kandidaat'", () => {
    expect(fallbackLabel({ job_titles: ["boekhouder"], region: "Kortrijk" })).toBe("Boekhouder · Kortrijk");
    expect(fallbackLabel(null)).toBe("Nieuwe zoektocht");
  });
});
