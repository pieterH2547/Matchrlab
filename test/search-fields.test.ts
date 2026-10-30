import { describe, expect, it } from "vitest";
import { passwordMatches } from "@/lib/auth";

describe("beheerderswachtwoord", () => {
  it("vergelijkt in constante tijd en exact", () => {
    expect(passwordMatches("geheim-123", "geheim-123")).toBe(true);
    expect(passwordMatches("geheim-12", "geheim-123")).toBe(false);
    expect(passwordMatches("", "x")).toBe(false);
  });
});
