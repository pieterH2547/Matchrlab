import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { requireSession } from "@/lib/session";
import { db, schema } from "@/lib/db";
import { summarizeTimings } from "@/lib/perf";

/** Snelheid per fase (p50/p95) over de laatste 50 afgeronde runs. */
export async function GET() {
  try {
    await requireSession();
    const rows = await db().select({ state: schema.runs.state }).from(schema.runs).where(eq(schema.runs.status, "done")).orderBy(desc(schema.runs.id)).limit(50);
    const timings = rows.map((r) => {
      const t = { ...(r.state?.stats?.timings ?? {}) };
      if (r.state?.stats?.durationMs) t.total = r.state.stats.durationMs;
      return t;
    });
    return NextResponse.json({ runs: rows.length, phases: summarizeTimings(timings) });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
