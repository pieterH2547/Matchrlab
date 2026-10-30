import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { confirmAndStart } from "@/lib/pipeline/orchestrator";
import type { Profile } from "@/lib/pipeline/types";

/** Zoekvelden bevestigen (met aanpassingen) en de zoektocht starten. */
export async function POST(req: Request, ctx: RouteContext<"/api/runs/[id]/start">) {
  try {
    await requireSession();
    const { id } = await ctx.params;
    const body = (await req.json().catch(() => ({}))) as { profile?: Partial<Profile> };
    const p = body.profile ?? {};
    const list = (v: unknown, max: number) => (Array.isArray(v) ? v.map((x) => String(x).trim().slice(0, 80)).filter(Boolean).slice(0, max) : undefined);
    const patch: Partial<Profile> = {};
    const t = list(p.job_titles, 6);
    if (t?.length) patch.job_titles = t;
    for (const [k, max] of [["related_titles", 5], ["title_variants", 6], ["skills", 20], ["skill_keywords", 6], ["sectors", 6], ["company_types", 8], ["exclusions", 10], ["nearby_municipalities", 10]] as const) {
      const v = list(p[k], max);
      if (v) (patch as Record<string, unknown>)[k] = v;
    }
    if (typeof p.region === "string") patch.region = p.region.trim().slice(0, 80);
    if (p.radius_km !== undefined) patch.radius_km = Math.min(150, Math.max(5, Number(p.radius_km) || 30));
    if (p.years_experience !== undefined) patch.years_experience = Math.min(50, Math.max(0, Number(p.years_experience) || 0));
    if (patch.region !== undefined) {
      // Nieuwe regio = AI-coördinaten niet meer geldig; onze gemeentelijst bepaalt dan het middelpunt.
      patch.region_lat = 0;
      patch.region_lng = 0;
    }
    const run = await confirmAndStart(Number(id), patch);
    if (!run) return NextResponse.json({ error: "Run niet gevonden." }, { status: 404 });
    return NextResponse.json({ ok: true, status: run.status });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
}
