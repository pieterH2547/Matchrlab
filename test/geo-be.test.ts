import { describe, expect, it } from "vitest";
import { geocode, withinRadius } from "@/lib/geo";

describe("volledige Belgische gemeentelijst", () => {
  it("kent ook kleinere (deel)gemeenten en postcodes", () => {
    expect(geocode("Sint-Katelijne-Waver")).not.toBeNull();
    expect(geocode("2550 Kontich")).not.toBeNull();
    expect(geocode("9940")).not.toBeNull();
    expect(withinRadius("Sint-Katelijne-Waver", "Mechelen", 15)).toBe(true);
    expect(withinRadius("Koksijde", "Mechelen", 30)).toBe(false);
  });
});
