import { describe, expect, it } from "vitest";
import { percentile, summarizeTimings } from "@/lib/perf";

describe("p50/p95", () => {
  it("berekent percentielen per fase", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 50)).toBe(5);
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
    const s = summarizeTimings([{ jobboards: 10_000, firstResult: 30_000 }, { jobboards: 20_000 }]);
    expect(s.find((x) => x.phase === "jobboards")).toMatchObject({ n: 2, p50: 10_000, p95: 20_000 });
  });
});
