import { describe, expect, it } from "vitest";
import { distanceKm, geocode, withinRadius } from "@/lib/geo";
import { CostMeter } from "@/lib/llm";
import { htmlToText } from "@/lib/fetch";

describe("geo", () => {
  it("geocodeert plaatsnamen in vrije tekst", () => {
    expect(geocode("2800 Mechelen, België")).toEqual(geocode("Mechelen"));
    expect(geocode("Sint-Katelijne-Waver")).not.toBeNull();
    expect(geocode("Timboektoe")).toBeNull();
  });
  it("berekent afstanden en straal", () => {
    const d = distanceKm(geocode("Mechelen")!, geocode("Antwerpen")!);
    expect(d).toBeGreaterThan(18);
    expect(d).toBeLessThan(26);
    expect(withinRadius("Antwerpen", "Mechelen", 25)).toBe(true);
    expect(withinRadius("Hasselt", "Mechelen", 25)).toBe(false);
    expect(withinRadius("Onbekend", "Mechelen", 25)).toBeNull();
  });
});

describe("CostMeter", () => {
  it("rekent tokens om naar euro", () => {
    const m = new CostMeter();
    m.add("claude-haiku-5-5", 1_000_000, 0);
    expect(m.eur).toBeCloseTo(0.1 * 0.92, 5);
    m.add("claude-sonnet-5-5", 0, 100_000);
    expect(m.eur).toBeCloseTo(0.092 + 1 * 0.92, 5);
  });
});

describe("htmlToText", () => {
  it("haalt tekst en absolute links uit html", () => {
    const { text, links, title } = htmlToText("<html><head><title>Acme</title><script>x()</script></head><body><h1>Jobs</h1><a href='/vacatures'>Vacatures</a><a href='#'>x</a></body></html>", "https://acme.be/");
    expect(title).toBe("Acme");
    expect(text).toContain("Jobs");
    expect(text).not.toContain("x()");
    expect(links).toEqual([{ href: "https://acme.be/vacatures", text: "Vacatures" }, { href: "https://acme.be/", text: "x" }]);
  });
});
