import { describe, expect, it } from "vitest";
import { detectKeyKind, redactSecrets } from "@/lib/redact";

describe("keys herkennen en verbergen", () => {
  const fakeOpenAI = "sk-proj-" + "A".repeat(40);
  const fakeFirecrawl = "fc-" + "b".repeat(32);
  it("herkent het soort key op prefix", () => {
    expect(detectKeyKind(fakeOpenAI)).toBe("OpenAI");
    expect(detectKeyKind(fakeFirecrawl)).toBe("Firecrawl");
    expect(detectKeyKind("gpt-5-mini")).toBeNull();
  });
  it("verbergt keys in foutmeldingen", () => {
    const out = redactSecrets(`HTTP 401 (model ${fakeOpenAI}): key ${fakeFirecrawl}`);
    expect(out).not.toContain(fakeOpenAI);
    expect(out).not.toContain(fakeFirecrawl);
    expect(out).toContain("[key verborgen]");
  });
});
