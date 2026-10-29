import { describe, expect, it } from "vitest";
import { pickLightModel } from "@/lib/openaiModels";

describe("pickLightModel", () => {
  it("kiest het nieuwste mini-model", () => {
    expect(pickLightModel(["gpt-4o-mini", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5.4-mini", "o4-mini"])).toBe("gpt-5.4-mini");
  });
  it("valt terug op luna of nano als er geen mini is", () => {
    expect(pickLightModel(["gpt-6-astra", "gpt-6-luna", "gpt-6.1-sol"])).toBe("gpt-6-luna");
    expect(pickLightModel(["gpt-5", "gpt-5-nano"])).toBe("gpt-5-nano");
  });
  it("geeft null zonder licht model", () => {
    expect(pickLightModel(["gpt-5", "gpt-6-astra"])).toBeNull();
  });
});
