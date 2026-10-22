import { describe, expect, it } from "vitest";
import { detectAts } from "@/lib/ats";

describe("detectAts", () => {
  it("herkent Recruitee via een link", () => {
    const r = detectAts("<a href='https://chemco.recruitee.com/'>Jobs</a>", ["https://chemco.recruitee.com/"]);
    expect(r?.adapter.id).toBe("recruitee");
    expect(r?.slug).toBe("chemco");
    expect(r?.adapter.listingUrl("chemco")).toBe("https://chemco.recruitee.com/");
  });
  it("herkent Greenhouse, Lever, Workable, Teamtailor, Personio, Jobtoolz, Talentfinder en SmartRecruiters", () => {
    expect(detectAts("", ["https://boards.greenhouse.io/acme"])?.adapter.id).toBe("greenhouse");
    expect(detectAts("", ["https://jobs.lever.co/acme"])?.adapter.id).toBe("lever");
    expect(detectAts("", ["https://apply.workable.com/acme/"])?.adapter.id).toBe("workable");
    expect(detectAts("", ["https://acme.teamtailor.com/jobs"])?.adapter.id).toBe("teamtailor");
    expect(detectAts("", ["https://acme.jobs.personio.de/"])?.slug).toBe("acme.jobs.personio.de");
    expect(detectAts("", ["https://acme.jobtoolz.com/nl"])?.adapter.id).toBe("jobtoolz");
    expect(detectAts("", ["https://acme.talentfinder.be/nl/vacatures"])?.adapter.id).toBe("talentfinder");
    expect(detectAts("", ["https://jobs.smartrecruiters.com/AcmeCorp"])?.slug).toBe("AcmeCorp");
  });
  it("geeft null zonder signatuur", () => {
    expect(detectAts("<html><body>Welkom</body></html>", ["https://acme.be/contact"])).toBeNull();
  });
});
