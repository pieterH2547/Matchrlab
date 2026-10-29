import { describe, expect, it } from "vitest";
import { matchesAsText } from "@/components/Thread";

describe("export van alle matches", () => {
  it("vacature, werkgever, waarom, contact en link per match", () => {
    const text = matchesAsText({
      candidateName: "Jan Peeters",
      profile: { job_titles: ["Boekhouder"], region: "Kortrijk", radius_km: 20 } as never,
      state: { steps: [], employers: [] } as never,
      matches: [
        { jobId: 1, score: 80, reason: "r", rank: 1, title: "Boekhouder", company: "Acme", location: "Kortrijk", url: "https://acme.be/jobs/1", source: "company_site", firstSeenAt: "", argument: "5 jaar KMO-boekhouding", risk: "", verification: "actief: x", contactEmail: "hr@acme.be", contactSource: "vacaturepagina", contactName: "Lies Janssens" },
      ],
    });
    expect(text).toContain("1. Boekhouder — Acme, Kortrijk (8/10)");
    expect(text).toContain("Match: 5 jaar KMO-boekhouding");
    expect(text).toContain("Contact: Lies Janssens, hr@acme.be");
    expect(text).toContain("Vacature: https://acme.be/jobs/1");
  });
});
