/**
 * Runs aanmaken en uitlezen voor de UI. Een thread = reeks runs met dezelfde thread_id.
 */
import { desc, eq, inArray, and, gte, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Run } from "@/lib/db/schema";
import { initialSteps, type RunView, type MatchView, type AttachmentInfo, type Profile, type RunState } from "@/lib/pipeline/types";
import { CostMeter } from "@/lib/llm";
import { decideFollowup } from "@/lib/pipeline/followup";
import { companyNames } from "@/lib/pipeline/orchestrator";
import { budgetExceeded } from "@/lib/budget";
import { profileSummary } from "@/lib/pipeline/profile";

export class BudgetError extends Error {}

export async function assertBudget() {
  const b = await budgetExceeded();
  if (b.exceeded) {
    throw new BudgetError(`Het AI-maandbudget van € ${b.budget.toFixed(0)} is op (€ ${b.spent.toFixed(2)} gebruikt). Nieuwe runs zijn geblokkeerd tot volgende maand of tot het budget verhoogd wordt.`);
  }
}

export function newThreadId(): string {
  return crypto.randomUUID().slice(0, 12);
}

export async function createRun(input: { author: string; cvText: string; freeText: string; attachment?: AttachmentInfo; threadId?: string }): Promise<Run> {
  await assertBudget();
  const threadId = input.threadId ?? newThreadId();
  const run = (
    await db()
      .insert(schema.runs)
      .values({
        author: input.author,
        cvText: input.cvText || null,
        freeText: input.freeText || null,
        status: "profile",
        threadId,
        state: { steps: initialSteps() },
      })
      .returning()
  )[0];
  await db()
    .insert(schema.messages)
    .values([
      { runId: run.id, role: "user", content: { kind: "user", text: input.freeText, attachment: input.attachment } },
      { runId: run.id, role: "assistant", content: { kind: "assistant" } },
    ]);
  return run;
}

/** Run opnieuw starten met aangepaste parameters (chips) of een vervolgbericht in dezelfde thread. */
export async function createFollowupRun(input: { author: string; threadId: string; text: string; profileOverride?: Partial<Profile> }): Promise<Run> {
  await assertBudget();
  const previous = await latestRunInThread(input.threadId);
  if (!previous?.profile) throw new Error("Geen eerdere run met profiel in deze thread.");
  const meter = new CostMeter();

  let profile: Profile;
  let answer: string | undefined;
  if (input.profileOverride) {
    profile = { ...previous.profile, ...input.profileOverride };
  } else {
    const matches = await matchesForRun(previous.id);
    const decision = await decideFollowup({ text: input.text, profile: previous.profile, matches }, meter);
    if (decision.kind === "question") {
      answer = decision.answer;
      profile = previous.profile;
    } else {
      profile = decision.profile;
    }
  }

  const isQuestion = answer !== undefined;
  const state: RunState = isQuestion ? { steps: [], answer } : { steps: initialSteps(true) };
  const run = (
    await db()
      .insert(schema.runs)
      .values({
        author: input.author,
        cvText: previous.cvText,
        freeText: input.text,
        candidateName: previous.candidateName,
        profile,
        status: isQuestion ? "done" : "jobboards",
        threadId: input.threadId,
        costEstimateEur: meter.eur,
        state,
      })
      .returning()
  )[0];
  await db()
    .insert(schema.messages)
    .values([
      { runId: run.id, role: "user", content: { kind: "user", text: input.text } },
      { runId: run.id, role: "assistant", content: isQuestion ? { kind: "assistant", answer } : { kind: "assistant" } },
    ]);
  return run;
}

/** De laatste zoekrun in de thread (vragen tellen niet mee: die hebben geen eigen resultaten). */
export async function latestRunInThread(threadId: string): Promise<Run | null> {
  const rows = await db().select().from(schema.runs).where(eq(schema.runs.threadId, threadId)).orderBy(desc(schema.runs.id)).limit(10);
  return rows.find((r) => r.state.answer === undefined) ?? rows[0] ?? null;
}

export async function matchesForRun(runId: number): Promise<MatchView[]> {
  const rows = await db()
    .select({ m: schema.matches, j: schema.jobs })
    .from(schema.matches)
    .innerJoin(schema.jobs, eq(schema.matches.jobId, schema.jobs.id))
    .where(eq(schema.matches.runId, runId))
    .orderBy(schema.matches.rank);
  const names = await companyNames(rows.map((r) => r.j));
  return rows.map(({ m, j }) => ({
    jobId: j.id,
    score: m.score,
    reason: m.reason,
    rank: m.rank,
    title: j.title,
    company: names.get(j.id) ?? "",
    location: j.location ?? "",
    url: j.url,
    source: j.source,
    firstSeenAt: j.firstSeenAt.toISOString(),
    argument: m.argument ?? m.reason,
    risk: m.risk ?? "",
  }));
}

export async function runView(run: Run): Promise<RunView> {
  const msgs = await db().select().from(schema.messages).where(eq(schema.messages.runId, run.id));
  const userMsg = msgs.find((m) => m.content.kind === "user")?.content;
  const matches = run.status === "done" ? await matchesForRun(run.id) : [];
  return {
    id: run.id,
    createdAt: run.createdAt.toISOString(),
    author: run.author,
    candidateName: run.candidateName,
    freeText: run.freeText,
    profile: run.profile,
    status: run.status,
    costEstimateEur: run.costEstimateEur,
    threadId: run.threadId,
    state: run.state,
    attachment: userMsg && userMsg.kind === "user" ? userMsg.attachment : undefined,
    matches,
  };
}

export async function threadView(threadId: string): Promise<RunView[]> {
  const rows = await db().select().from(schema.runs).where(eq(schema.runs.threadId, threadId)).orderBy(schema.runs.id);
  return Promise.all(rows.map(runView));
}

export type RunListItem = {
  id: number;
  threadId: string;
  createdAt: string;
  author: string;
  candidateName: string;
  summary: string;
  hits: number;
  status: string;
  costEstimateEur: number;
};

/** Lijst voor de zijbalk: enkel de eerste run per thread, met het aantal treffers van de laatste run. */
export async function listRuns(limit = 200): Promise<RunListItem[]> {
  const rows = await db().select().from(schema.runs).orderBy(desc(schema.runs.id)).limit(limit);
  const byThread = new Map<string, Run[]>();
  for (const r of rows) {
    const arr = byThread.get(r.threadId) ?? [];
    arr.push(r);
    byThread.set(r.threadId, arr);
  }
  const latestIds = Array.from(byThread.values()).map((rs) => rs[0].id);
  const counts = latestIds.length
    ? await db()
        .select({ runId: schema.matches.runId, n: sql<number>`count(*)` })
        .from(schema.matches)
        .where(inArray(schema.matches.runId, latestIds))
        .groupBy(schema.matches.runId)
    : [];
  const countMap = new Map(counts.map((c) => [c.runId, Number(c.n)]));
  return Array.from(byThread.values()).map((rs) => {
    const first = rs[rs.length - 1];
    const latest = rs[0];
    const withMatches = rs.find((r) => countMap.get(r.id)) ?? latest;
    return {
      id: first.id,
      threadId: first.threadId,
      createdAt: latest.createdAt.toISOString(),
      author: first.author,
      candidateName: latest.candidateName || first.candidateName || "Onbekende kandidaat",
      summary: profileSummary(latest.profile ?? first.profile),
      hits: countMap.get(withMatches.id) ?? 0,
      status: latest.status,
      costEstimateEur: rs.reduce((s, r) => s + r.costEstimateEur, 0),
    };
  });
}

export async function weekStats(author: string): Promise<{ runs: number; cost: number }> {
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = await db()
    .select({ n: sql<number>`count(*)`, cost: sql<number>`coalesce(sum(${schema.runs.costEstimateEur}), 0)` })
    .from(schema.runs)
    .where(and(gte(schema.runs.createdAt, since), eq(schema.runs.author, author)));
  return { runs: Number(rows[0]?.n ?? 0), cost: Number(rows[0]?.cost ?? 0) };
}
