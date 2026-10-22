import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { parseCv } from "@/lib/pipeline/cv";
import { BudgetError, createFollowupRun, createRun, listRuns, weekStats } from "@/lib/runs";
import { braveQueriesUsedThisMonth, monthlySpendEur } from "@/lib/budget";
import { env } from "@/lib/env";
import type { Profile } from "@/lib/pipeline/types";

export const maxDuration = 60;

const MAX_FILE_BYTES = 8 * 1024 * 1024;

export async function GET() {
  try {
    const session = await requireSession();
    const [runs, week, spent, brave] = await Promise.all([listRuns(), weekStats(session.name), monthlySpendEur(), braveQueriesUsedThisMonth()]);
    return NextResponse.json({ runs, me: session.name, week, month: { spent, budget: env.ANTHROPIC_MONTHLY_BUDGET_EUR, braveQueries: brave } });
  } catch (e) {
    return errorResponse(e);
  }
}

export async function POST(request: Request) {
  try {
    const session = await requireSession();
    const form = await request.formData();
    const text = String(form.get("text") ?? "").trim();
    const threadId = String(form.get("threadId") ?? "").trim() || undefined;
    const overrideRaw = form.get("profileOverride");
    const file = form.get("file");

    if (threadId) {
      const profileOverride = typeof overrideRaw === "string" && overrideRaw ? (JSON.parse(overrideRaw) as Partial<Profile>) : undefined;
      if (!text && !profileOverride) return NextResponse.json({ error: "Typ een bericht." }, { status: 400 });
      const run = await createFollowupRun({ author: session.name, threadId, text: text || "Parameters aangepast", profileOverride });
      return NextResponse.json({ runId: run.id, threadId: run.threadId, status: run.status });
    }

    let cvText = "";
    let attachment: { name: string; size: number } | undefined;
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_FILE_BYTES) return NextResponse.json({ error: "Bestand is groter dan 8 MB." }, { status: 400 });
      const bytes = Buffer.from(await file.arrayBuffer());
      const parsed = await parseCv({ name: file.name, bytes });
      cvText = parsed.text;
      attachment = { name: file.name, size: file.size };
    }
    if (!cvText && !text) return NextResponse.json({ error: "Laad een cv op of typ wat je zoekt." }, { status: 400 });
    const run = await createRun({ author: session.name, cvText, freeText: text, attachment });
    return NextResponse.json({ runId: run.id, threadId: run.threadId, status: run.status });
  } catch (e) {
    return errorResponse(e);
  }
}

function errorResponse(e: unknown) {
  if (e instanceof Response) return e;
  if (e instanceof BudgetError) return NextResponse.json({ error: e.message }, { status: 402 });
  const message = e instanceof Error ? e.message : "Er ging iets mis.";
  return NextResponse.json({ error: message }, { status: 500 });
}
