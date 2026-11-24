import { describe, expect, it } from "vitest";
import { classify, detectBrand, isFlemishPostcode, officeKey, parseListingFromHtml, parseListingFromText, postcodeCenter, sameOffice, splitAddress } from "@/lib/offices/classify";

describe("kantorenkaart: classificatie", () => {
  it("herkent bankkantoren op categorie en naam", () => {
    expect(classify("KBC Bank Mechelen", "Bank")).toEqual({ sector: "bank", kind: "bankkantoor" });
    expect(classify("Argenta Kantoor Heist", "Financiële instelling")).toEqual({ sector: "bank", kind: "bankkantoor" });
    expect(classify("Belfius", "")).toEqual({ sector: "bank", kind: "bankkantoor" });
  });
  it("herkent makelaars en agenten", () => {
    expect(classify("Verzekeringen Peeters", "Verzekeringsmakelaar")).toEqual({ sector: "verzekeringen", kind: "verzekeringsmakelaar" });
    expect(classify("AXA Kantoor Janssens", "Verzekeringsagentschap")).toEqual({ sector: "verzekeringen", kind: "verzekeringsagent" });
    expect(classify("DVV Lier", "Insurance agency")).toEqual({ sector: "verzekeringen", kind: "verzekeringsagent" });
  });
  it("laat geldautomaten, bakkers en wisselkantoren weg", () => {
    expect(classify("KBC Geldautomaat", "Geldautomaat")).toBeNull();
    expect(classify("Bakkerij Bank", "Bakkerij")).toBeNull();
    expect(classify("Western Union", "Wisselkantoor")).toBeNull();
  });
  it("leidt het merk af uit de naam", () => {
    expect(detectBrand("BNP Paribas Fortis Mechelen", "bank")).toBe("BNP Paribas Fortis");
    expect(detectBrand("Fintro Kantoor Lier", "bank")).toBe("Fintro");
    expect(detectBrand("Zakenkantoor Vermeulen", "bank")).toBeNull();
    expect(detectBrand("AG Insurance Agent Smets", "verzekeringen")).toBe("AG Insurance");
    expect(detectBrand("Verzekeringen De Smet bv", "verzekeringen")).toBeNull();
  });
});

describe("kantorenkaart: adres en geo", () => {
  it("haalt postcode en gemeente uit een Maps-adres", () => {
    expect(splitAddress("Grote Markt 1, 2800 Mechelen, België")).toEqual({ postcode: "2800", municipality: "Mechelen" });
    expect(splitAddress("Bruul 12, 2800 Mechelen")).toEqual({ postcode: "2800", municipality: "Mechelen" });
    expect(splitAddress("")).toEqual({ postcode: null, municipality: null });
  });
  it("kent het middelpunt van een postcode en Vlaanderen", () => {
    expect(postcodeCenter("2800")).not.toBeNull();
    expect(postcodeCenter("0000")).toBeNull();
    expect(isFlemishPostcode("2800")).toBe(true);
    expect(isFlemishPostcode("9000")).toBe(true);
    expect(isFlemishPostcode("4000")).toBe(false);
  });
});

describe("kantorenkaart: ontdubbelen en vergelijken", () => {
  it("bouwt een sleutel op cid, anders kbo, anders naam + postcode", () => {
    expect(officeKey({ cid: "123", name: "X", postcode: "2800" })).toBe("cid:123");
    expect(officeKey({ enterpriseNumber: "0123456789", name: "X", postcode: "2800" })).toBe("kbo:0123456789");
    expect(officeKey({ name: "Verzekeringen De Smet bv", postcode: "2800" })).toBe("naam:smet:2800");
  });
  it("herkent hetzelfde kantoor onder een iets andere naam", () => {
    expect(sameOffice({ name: "Zakenkantoor Peeters & Co", postcode: "2800" }, { name: "Peeters Verzekeringen", postcode: "2800" })).toBe(true);
    expect(sameOffice({ name: "Peeters Verzekeringen", postcode: "2800" }, { name: "Peeters Verzekeringen", postcode: "2500" })).toBe(false);
    expect(sameOffice({ name: "Verzekeringen Janssens", postcode: "2800" }, { name: "Kantoor Claes", postcode: "2800" })).toBe(false);
  });
});

describe("kantorenkaart: FVF-profielpagina's lezen", () => {
  it("leest JSON-LD als dat er is", () => {
    const html = `<html><head><title>Kantoor Smets | Vind een verzekeringsmakelaar</title>
      <script type="application/ld+json">{"@type":"InsuranceAgency","name":"Kantoor Smets","telephone":"015 12 34 56","url":"https://smets.be","address":{"streetAddress":"Bruul 12","postalCode":"2800","addressLocality":"Mechelen"}}</script></head><body></body></html>`;
    const p = parseListingFromHtml(html, "x");
    expect(p?.name).toBe("Kantoor Smets");
    expect(p?.postcode).toBe("2800");
    expect(p?.website).toBe("https://smets.be");
    expect(p?.address).toBe("Bruul 12, 2800 Mechelen");
  });
  it("valt terug op de eerste adresregel in de tekst", () => {
    const text = `Kantoor Smets\nBruul 12, 2800 Mechelen\nTel. 015 12 34 56\nFSMA 012345 A\nBE 0123.456.789\nwww-site: https://smets.be/contact`;
    const p = parseListingFromText(text, "Kantoor Smets - Vind een verzekeringsmakelaar");
    expect(p?.name).toBe("Kantoor Smets");
    expect(p?.postcode).toBe("2800");
    expect(p?.municipality).toBe("Mechelen");
    expect(p?.enterpriseNumber).toBe("0123456789");
    expect(p?.fsmaNumber).toBe("012345 A");
    expect(p?.website).toBe("https://smets.be/contact");
  });
  it("geeft null zonder adres", () => {
    expect(parseListingFromText("Welkom op onze site", "Home")).toBeNull();
  });
});

describe("kantorenkaart: OpenStreetMap", () => {
  it("zet een bank- en een verzekeringselement om naar kantoren", async () => {
    const { osmToOffice, overpassQuery } = await import("@/lib/offices/osm");
    const bank = osmToOffice({ type: "node", id: 1, lat: 51.03, lon: 4.48, tags: { amenity: "bank", name: "KBC Bank Mechelen", brand: "KBC", "addr:street": "Bruul", "addr:housenumber": "1", "addr:postcode": "2800", "addr:city": "Mechelen", website: "https://www.kbc.be", phone: "+32 15 00 00 00" } });
    expect(bank).toMatchObject({ sector: "bank", kind: "bankkantoor", dedupeKey: "osm:node/1", brand: "KBC", address: "Bruul 1, 2800 Mechelen", postcode: "2800", domain: "kbc.be", source: "osm" });
    const ins = osmToOffice({ type: "way", id: 2, center: { lat: 51.03, lon: 4.48 }, tags: { office: "insurance", name: "Verzekeringen Peeters" } });
    expect(ins?.kind).toBe("verzekeringsmakelaar");
    expect(ins?.postcode).toBe("2800");
    expect(osmToOffice({ type: "node", id: 3, lat: 51.03, lon: 4.48, tags: { amenity: "atm", name: "KBC" } })).toBeNull();
    expect(osmToOffice({ type: "node", id: 4, lat: 50.63, lon: 5.57, tags: { amenity: "bank", name: "Belfius Liège", "addr:postcode": "4000" } })).toBeNull();
    expect(overpassQuery({ around: { center: { lat: 51, lon: 4 }, radiusKm: 20 } })).toContain("(around:20000,51,4)");
  });
  it("herkent dezelfde vestiging uit twee bronnen", async () => {
    const { sameSpot } = await import("@/lib/offices/collect");
    const a = { sector: "bank", name: "Crelan Mechelen - Hellemans", brand: "Crelan", postcode: "2800", lat: 51.0281, lng: 4.4801 };
    expect(sameSpot(a, { sector: "bank", name: "Kantoor Hellemans Mechelen", brand: null, postcode: "2800", lat: 51.0283, lng: 4.4803 })).toBe(true);
    expect(sameSpot(a, { sector: "bank", name: "Crelan", brand: "Crelan", postcode: null, lat: 51.0282, lng: 4.4802 })).toBe(true);
    expect(sameSpot(a, { sector: "bank", name: "Crelan Lier", brand: "Crelan", postcode: "2500", lat: 51.13, lng: 4.57 })).toBe(false);
    expect(sameSpot(a, { sector: "verzekeringen", name: "Crelan Mechelen - Hellemans", brand: null, postcode: "2800", lat: 51.0281, lng: 4.4801 })).toBe(false);
  });
});

describe("kantorenkaart: Google-omweglinks", () => {
  it("pakt google.com/goto en /url uit en laat gewone links staan", async () => {
    const { unwrapGoogleUrl } = await import("@/lib/search");
    expect(unwrapGoogleUrl("https://www.google.com/goto?url=https%3A%2F%2Fwww.vdk.be%2Fkantoren%2Fmechelen&opi=1")).toBe("https://www.vdk.be/kantoren/mechelen");
    expect(unwrapGoogleUrl("https://www.google.com/url?q=https://argenta.be/x&sa=D")).toBe("https://argenta.be/x");
    expect(unwrapGoogleUrl("https://www.argenta.be/nl/kantoren/x.html")).toBe("https://www.argenta.be/nl/kantoren/x.html");
    expect(unwrapGoogleUrl("ftp://x")).toBeNull();
    expect(unwrapGoogleUrl(null)).toBeNull();
  });
});

describe("kantorenkaart: merksites", () => {
  it("maakt een nette kantoornaam uit de paginatitel", async () => {
    const { cleanName } = await import("@/lib/offices/brands");
    expect(cleanName("Kantoor De Feyter bvba | Argenta", "Argenta")).toBe("Argenta De Feyter bvba");
    expect(cleanName("Crelan Mechelen - Hellemans | Crelan", "Crelan")).toBe("Crelan Mechelen - Hellemans");
    expect(cleanName("", "Argenta")).toBe("Argenta");
  });
});

describe("kantorenkaart: merkpagina's (Argenta, Crelan)", () => {
  it("leest de Argenta og:description", () => {
    const html = `<html><head><title>HILDE VAN HECKE BV | ERTVELDE | Argenta</title><meta property="og:title" content="HILDE VAN HECKE BV"><meta property="og:description" content="LINDENLAAN 50 0001, 9940 ERTVELDE | +32 9 344 65 53 | Ertvelde@argenta.be"></head><body><a href="mailto:Ertvelde@argenta.be">x</a></body></html>`;
    const p = parseListingFromHtml(html, "x");
    expect(p).toMatchObject({ name: "Hilde Van Hecke BV", address: "Lindenlaan 50 0001, 9940 Ertvelde", postcode: "9940", municipality: "Ertvelde", phone: "+32 9 344 65 53", email: "ertvelde@argenta.be" });
  });
  it("leest de Crelan-adresvelden met coördinaten", () => {
    const html = `<html><head><title>Brouns &amp; Van Keirsbilck Oostende | Crelan</title></head><body><main data-agencyzipcode="8400" data-agencycity="OOSTENDE"><div data-lat="51.230605" data-lng="2.914821"><meta property="latitude" content="51.230605" /><meta property="longitude" content="2.914821" /></div><span class="address-display-element address-line1-element">Hendrik Serruyslaan 5</span> <span class="address-display-element postal-code-element">8400</span> <span class="address-display-element locality-element">OOSTENDE</span><a href="tel:+32 59/559900">+32 59/559900</a><a href="mailto:oostende@crelan.be">m</a></main></body></html>`;
    const p = parseListingFromHtml(html, "Brouns & Van Keirsbilck Oostende | Crelan");
    expect(p).toMatchObject({ name: "Brouns & Van Keirsbilck Oostende", address: "Hendrik Serruyslaan 5, 8400 Oostende", postcode: "8400", municipality: "Oostende", lat: 51.230605, lng: 2.914821, email: "oostende@crelan.be" });
    expect(p?.phone).toContain("+32 59/559900");
  });
});

describe("kantorenkaart: OSM-tegels", () => {
  it("dekt Vlaanderen in aaneensluitende kleine tegels", async () => {
    const { FLANDERS_TILES } = await import("@/lib/offices/osm");
    expect(FLANDERS_TILES.length).toBeGreaterThan(40);
    expect(FLANDERS_TILES[0]).toEqual([50.68, 2.54, 50.89, 2.784]);
    const last = FLANDERS_TILES[FLANDERS_TILES.length - 1];
    expect(last[2]).toBe(51.52);
    expect(last[3]).toBe(5.95);
  });
});

describe("kantorenkaart: vacatures koppelen aan kantoren", () => {
  it("koppelt op merk of naam én gemeente of postcode", async () => {
    const { matchJobsToOffices } = await import("@/lib/offices/jobsearch");
    const offices = [
      { id: 1, name: "KBC Bank Mechelen", brand: "KBC", postcode: "2800", municipality: "Mechelen" },
      { id: 2, name: "KBC Bank Gent", brand: "KBC", postcode: "9000", municipality: "Gent" },
      { id: 3, name: "Verzekeringen De Smet", brand: null, postcode: "2800", municipality: "Mechelen" },
    ];
    const jobs = [
      { id: 10, title: "Kredietadviseur", url: "https://x/1", source: "adzuna" as const, location: "Mechelen", raw: { companyName: "KBC Bank & Verzekering" }, descriptionText: "Solliciteer via jobs@kbc.be" },
      { id: 11, title: "Schadebeheerder", url: "https://x/2", source: "jooble" as const, location: "2800 Mechelen", raw: { companyName: "De Smet Verzekeringen bv" }, descriptionText: null },
      { id: 12, title: "Bankbediende", url: "https://x/3", source: "adzuna" as const, location: "België", raw: { companyName: "KBC" }, descriptionText: null },
    ];
    const m = matchJobsToOffices(offices, jobs);
    expect(m.get(1)?.map((j) => j.title)).toEqual(["Kredietadviseur"]);
    expect(m.get(1)?.[0].email).toBe("jobs@kbc.be");
    expect(m.get(2)).toBeUndefined();
    expect(m.get(3)?.map((j) => j.title)).toEqual(["Schadebeheerder"]);
  });
  it("bouwt een sectorprofiel dat de jobboard-functies aankunnen", async () => {
    const { sectorProfile, SECTOR_TITLES } = await import("@/lib/offices/jobsearch");
    const p = sectorProfile("bank", SECTOR_TITLES.bank.slice(0, 3), "Mechelen", 20, { lat: 51.0259, lon: 4.4776 });
    expect(p.job_titles).toHaveLength(3);
    expect(p.region).toBe("Mechelen");
    expect(p.nearby_municipalities.length).toBeGreaterThan(0);
  });
});
