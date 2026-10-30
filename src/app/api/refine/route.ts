import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { CostMeter } from "@/lib/llm";
import { diffFields, refineFields, sanitizeFields, type SearchFieldValues } from "@/lib/pipeline/refine";

const EMPTY: SearchFieldValues = {
  job_titles: [],
  related_titles: [],
  title_variants: [],
  region: "",
  radius_km: 30,
  years_experience: 0,
  skills: [],
  skill_keywords: [],
  sectors: [],
  company_types: [],
  exclusions: [],
};

/** Zoekvelden aanpassen met een opdracht in gewone taal. Wijzigt niets in de run; de velden gaan terug naar het scherm. */
export async function POST(req: Request) {
  try {
    await requireSession();
    const body = (await req.json().catch(() => ({}))) as { fields?: Partial<SearchFieldValues>; instruction?: string };
    const instruction = String(body.instruction ?? "").trim();
    if (!instruction) return NextResponse.json({ error: "Typ wat je wilt aanpassen." }, { status: 400 });
    const current = sanitizeFields(body.fields ?? {}, EMPTY);
    const r = await refineFields(current, instruction, new CostMeter());
    const changes = r.changes.length ? r.changes : diffFields(current, r.fields);
    return NextResponse.json({ fields: r.fields, changes, notUnderstood: r.notUnderstood });
  } catch (e) {
    if (e instanceof Response) return e;
    console.warn("[refine] mislukt:", e instanceof Error ? e.message.slice(0, 160) : "onbekend");
    return NextResponse.json({ error: "Aanpassen lukte niet. Probeer het korter of pas de velden met de hand aan." }, { status: 500 });
  }
}
