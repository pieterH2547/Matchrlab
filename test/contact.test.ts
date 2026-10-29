import { describe, expect, it } from "vitest";
import { extractEmails, pickEmail, findContact, employerDomainFor } from "@/lib/pipeline/contact";

describe("contactadres", () => {
  it("haalt adressen uit tekst, ook met [at]", () => {
    expect(extractEmails("Mail je cv naar jobs [at] chemco.be of info@chemco.be. logo@2x.png")).toEqual(["jobs@chemco.be", "info@chemco.be"]);
  });
  it("kiest het HR-adres van de werkgever, nooit dat van een jobboard of bureau", () => {
    expect(pickEmail(["info@chemco.be", "jobs@chemco.be", "support@jooble.org"], "chemco.be")).toBe("jobs@chemco.be");
    expect(pickEmail(["vacatures@randstad.be"], "chemco.be")).toBeNull();
  });
  it("domein van de werkgever niet uit een jobboard-link halen", () => {
    expect(employerDomainFor("https://be.jooble.org/desc/1", null)).toBeNull();
    expect(employerDomainFor("https://www.chemco.be/jobs/1", null)).toBe("chemco.be");
  });
  it("zoekt verder op de site als de vacature geen adres heeft, en verzint niets", async () => {
    const pages: Record<string, string> = { "https://chemco.be/contact": "Contacteer HR via hr@chemco.be" };
    const c = await findContact({ jobText: "Geen adres hier", jobUrl: "https://chemco.be/jobs/1", employerDomain: "chemco.be" }, async (u) => pages[u] ?? "");
    expect(c).toEqual({ email: "hr@chemco.be", source: "contactpagina werkgever" });
    const none = await findContact({ jobText: "", jobUrl: null, employerDomain: "leeg.be" }, async () => "");
    expect(none).toBeNull();
  });
});
