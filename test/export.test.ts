import { describe, expect, it } from "vitest";
import { csvRows, matchesAsText } from "@/components/Thread";

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

describe("export met kantoren uit de kantorenkaart", () => {
  const office = { id: 1, sector: "bank", kind: "bankkantoor", name: "KBC Mechelen", brand: "KBC", address: "Bruul 1, 2800 Mechelen", postcode: "2800", municipality: "Mechelen", lat: 51, lng: 4.4, approximate: false, website: "https://kbc.be", phone: "015 00 00 00", rating: null, ratingCount: null, sources: ["google_maps", "fsma"], verified: true, distanceKm: 1.2, openJobs: 2, careersUrl: "https://kbc.be/jobs", lastSeenAt: "" } as const;
  const run = { candidateName: "Jan", profile: { job_titles: ["Bankbediende"], region: "Mechelen", radius_km: 20 } as never, state: { steps: [], offices: [office] } as never, matches: [] };
  it("tekst vermeldt de kantoren als kansen", () => {
    const text = matchesAsText(run);
    expect(text).toContain("Bank- en verzekeringskantoren binnen 20 km");
    expect(text).toContain("KBC Mechelen (Bankkantoor, KBC) · Bruul 1, 2800 Mechelen · 1.2 km · 2 open vacatures · https://kbc.be");
  });
  it("csv heeft een typekolom met een rij per kantoor", () => {
    const rows = csvRows(run);
    expect(rows[0][0]).toBe("Type");
    expect(rows[1]).toEqual(["Kantoor", "", "Bankkantoor", "KBC Mechelen", "KBC", "Bruul 1, 2800 Mechelen", 1.2, "", "", "", "", "015 00 00 00", "https://kbc.be/jobs", "google_maps, fsma (bevestigd)", 2]);
  });
});
