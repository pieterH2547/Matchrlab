/** Sectorbeheer: FSMA-import, ontdubbelen, website-koppeling en geen onterechte uitsluiting van makelaars. */
import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: () => ({}), schema: {} }));
vi.mock("@/lib/search", () => ({ webSearch: async () => [], placesSearch: async () => [] }));
vi.mock("@/lib/settings", () => ({ getSetting: async () => undefined, minScore100: async () => 60 }));
import { normalizeEnterpriseNumber, parseRegistry, dedupeRows, dedupeKey, SECTORS } from "@/lib/sector/registry";
import { domainMatchesName, isPortalDomain } from "@/lib/sector/process";
import { isIntermediaryCompany, isTrustedEmployer } from "@/lib/blocklist";
import { prefilterReason } from "@/lib/pipeline/jobstore";
import type { Profile } from "@/lib/pipeline/types";

describe("ondernemingsnummer", () => {
  it("normaliseert en controleert modulo 97", () => {
    expect(normalizeEnterpriseNumber("BE 0403.170.701")).toBe("0403170701");
    expect(normalizeEnterpriseNumber("0812.345.603")).toBe("0812345603");
    expect(normalizeEnterpriseNumber("0403.170.702")).toBeNull();
    expect(normalizeEnterpriseNumber("")).toBeNull();
  });
});

describe("FSMA-import", () => {
  const csv = [
    "Naam;Ondernemingsnummer;Adres;Postcode;Gemeente;Statuut;Status",
    '"Verzekeringen Peeters BV";BE 0403.170.701;"Meir 1";2000;Antwerpen;Verzekeringsmakelaar;Actief',
    '"Verzekeringen Peeters";0403170701;"Meir 1";2000;Antwerpen;Verzekeringsmakelaar;Actief',
    '"Kantoor Janssens";0812.345.603;"Lei 5";2018;Antwerpen;Verzekeringsagent;Actief',
    '"Oud Kantoor";0812.345.603;"Lei 6";2018;Antwerpen;Verzekeringsmakelaar;Geschrapt',
    '"Makelaarskantoor De Vos";;"Kerkstraat 2";2600;Berchem;Makelaar in verzekeringen;Actief',
  ].join("\n");
  it("enkel actieve makelaars, ontdubbeld op ondernemingsnummer", () => {
    const p = parseRegistry(csv, SECTORS.verzekeringsmakelaars.statute);
    expect(p.skipped).toBe(2);
    const rows = dedupeRows("verzekeringsmakelaars", p.rows);
    expect(rows.map((r) => r.name)).toEqual(["Verzekeringen Peeters BV", "Makelaarskantoor De Vos"]);
    expect(rows[0].enterpriseNumber).toBe("0403170701");
    expect(rows[1].postcode).toBe("2600");
  });
  it("zonder nummer: sleutel op sector + naam + gemeente (rechtsvorm en hoofdletters tellen niet)", () => {
    const a = dedupeKey("verzekeringsmakelaars", { name: "De Vos BV", municipality: "Berchem", enterpriseNumber: null });
    const b = dedupeKey("verzekeringsmakelaars", { name: "de vos", municipality: "BERCHEM", enterpriseNumber: null });
    expect(a).toBe(b);
  });
  it("kommagescheiden en Franse kolommen", () => {
    const fr = 'Dénomination,Numéro d\'entreprise,Commune,Statut\n"Assurances Dupont",0403170701,Anvers,Courtier en assurances';
    const p = parseRegistry(fr, SECTORS.verzekeringsmakelaars.statute);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0].municipality).toBe("Anvers");
  });
});

describe("website koppelen", () => {
  it("domein moet op de naam lijken; gidsen en portalen nooit", () => {
    expect(domainMatchesName("peetersverzekeringen.be", "Verzekeringen Peeters BV")).toBe(true);
    expect(domainMatchesName("devos-makelaars.be", "Makelaarskantoor De Vos")).toBe(true);
    expect(domainMatchesName("andere.be", "Verzekeringen Peeters")).toBe(false);
    expect(isPortalDomain("goudengids.be")).toBe(true);
    expect(isPortalDomain("randstad.be")).toBe(true);
    expect(isPortalDomain("finconsult.be")).toBe(false);
  });
});

describe("makelaars en financiële advieskantoren niet onterecht uitgesloten", () => {
  const profile = { region: "Antwerpen", radius_km: 30, exclusions: [], region_lat: 0, region_lng: 0 } as unknown as Profile;
  it("gewone namen van makelaars en adviseurs zijn geen tussenpersoon", () => {
    for (const n of ["Verzekeringen Peeters", "Makelaarskantoor De Vos", "Finconsult", "Kantoor Janssens Verzekeringen", "Vermogensadvies Claes"]) {
      expect(isIntermediaryCompany(n, `https://${n.toLowerCase().replace(/\s+/g, "")}.be`)).toBe(false);
    }
  });
  it("registerwerkgever met 'Consulting' in de naam blijft (trusted), zonder register valt hij weg", () => {
    const job = { title: "Accountmanager verzekeringen", location: "Antwerpen", companyName: "ABC Insurance Consulting", url: "https://abc-consulting.be/jobs/1", source: "company_site" };
    expect(prefilterReason(job, profile)).toBe("tussenpersoon");
    const trusted = { ...job, raw: { trustedEmployer: true } };
    expect(isTrustedEmployer(trusted)).toBe(true);
    expect(prefilterReason(trusted, profile)).toBeNull();
  });
});
