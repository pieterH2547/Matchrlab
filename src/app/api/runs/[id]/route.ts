import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { requireSession } from "@/lib/session";
import { db, schema } from "@/lib/db";
import { threadView } from "@/lib/runs";

/** Geeft de hele thread waar deze run in zit. */
export async function GET(_req: Request, ctx: RouteContext<"/api/runs/[id]">) {
  try {
    await requireSession();
    const { id } = await ctx.params;
    const run = (await db().select().from(schema.runs).where(eq(schema.runs.id, Number(id))).limit(1))[0];
    if (!run) return NextResponse.json({ error: "Run niet gevonden." }, { status: 404 });
    const runs = await threadView(run.threadId);
    return NextResponse.json({ threadId: run.threadId, runs });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e instanceof Error ? e.message : "Er ging iets mis." }, { status: 500 });
  }
}
