import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { listOpenAIModels, pickLightModel, resolveOpenAIModel } from "@/lib/openaiModels";
import { getSetting } from "@/lib/settings";

/** Modellen die de OpenAI-key kan gebruiken + wat Matchr effectief kiest. Geen keys in de output. */
export async function GET() {
  try {
    await requireSession();
    const ids = await listOpenAIModels();
    return NextResponse.json({
      provider: (await getSetting("AI_PROVIDER")) ?? "openai",
      ids,
      auto: pickLightModel(ids),
      effective: { cheap: await resolveOpenAIModel("cheap"), scoring: await resolveOpenAIModel("scoring") },
    });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
