import { describe, expect, it } from "vitest";
import { isBlockedDomain, registrableDomain } from "@/lib/blocklist";
import { domainsFromResults } from "@/lib/pipeline/discover";

describe("registrableDomain", () => {
  it("haalt het domein uit een URL", () => {
    expect(registrableDomain("https://www.chemco.be/nl/over-ons")).toBe("chemco.be");
    expect(registrableDomain("jobs.lever.co/acme")).toBe("lever.co");
    expect(registrableDomain("https://example.co.uk/x")).toBe("example.co.uk");
  });
  it("geeft null voor rommel", () => {
    expect(registrableDomain("not a url")).toBeNull();
  });
});

describe("isBlockedDomain", () => {
  it("blokkeert jobboards en interimkantoren", () => {
    expect(isBlockedDomain("https://www.vdab.be/vindeenjob")).toBe(true);
    expect(isBlockedDomain("https://be.indeed.com/jobs")).toBe(true);
    expect(isBlockedDomain("https://www.randstad.be/")).toBe(true);
    expect(isBlockedDomain("https://acme.recruitee.com/")).toBe(true);
    expect(isBlockedDomain("https://www.jobsinmechelen.be/")).toBe(true);
  });
  it("laat gewone bedrijfssites door", () => {
    expect(isBlockedDomain("https://www.chemco.be/")).toBe(false);
    expect(isBlockedDomain("https://duvel.com/")).toBe(false);
  });
});

describe("domainsFromResults", () => {
  it("dedupliceert, filtert en respecteert het maximum", () => {
    const urls = ["https://www.chemco.be/a", "https://chemco.be/b", "https://www.vdab.be/x", "https://duvel.com/jobs", "https://acme.be/brochure.pdf", "https://puratos.com/"];
    expect(domainsFromResults(urls, new Set(), 2)).toEqual(["chemco.be", "duvel.com"]);
    expect(domainsFromResults(urls, new Set(["chemco.be"]))).toEqual(["duvel.com", "puratos.com"]);
  });
});
