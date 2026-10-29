/**
 * Orchestrator: voert telkens één korte stap uit en schrijft het resultaat
 * weg. De client roept `advanceRun` herhaaldelijk aan tot de status "done"
 * of "failed" is; een afgebroken run gaat gewoon verder bij de volgende aanroep.
 * Voortgang gaat via `emit` naar de SSE-stream.
 */
import { and, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Run, Company, Job } from "@/lib/db/schema";
import { CostMeter } from "@/lib/llm";
import { LIMITS } from "@/lib/config";
import { buildProfile } from "./profile";
import { searchJobboards } from "./jobboards";
import { discoverCompanies } from "./discover";
import { findJobsPage } from "./findJobsPage";
import { extractFromAts, extractFromPage } from "./extract";
import { preselect, scoreJobs } from "./score";
import { prefilterJobs, upsertJobs, loadJobs, dedupeJobs } from "./jobstore";
import { withinRadius } from "@/lib/geo";
import { isIntermediaryCompany } from "@/lib/blocklist";
import type { RunState, StepState, NormalizedJob, Profile } from "./types";

export type Emit = (event: { type: "steps"; steps: StepState[] } | { type: "status"; status: Run["status"]; state: RunState } | { type: "error"; message: string }) => void;

function setStep(state: RunState, key: StepState["key"], patch: Partial<StepState>): RunState {
  return { ...state, steps: state.steps.map((s) => (s.key === key ? { ...s, ...patch } : s)) };
}

async function saveRun(id: number, patch: Partial<Run>) {
  await db().update(schema.runs).set(patch).where(eq(schema.runs.id, id));
}

async function addCost(id: number, meter: CostMeter) {
  if (meter.eur <= 0) return;
  await db()
    .update(schema.runs)
    .set({ costEstimateEur: sql`${schema.runs.costEstimateEur} + ${meter.eur}` })
    .where(eq(schema.runs.id, id));
}

function companyLabel(c: Pick<Company, "name" | "domain">): string {
  return c.name ?? c.domain;
}

/** Eén stap uitvoeren. Geeft de nieuwe status terug. */
export async function advanceRun(runId: number, emit: Emit): Promise<Run["status"]> {
  const run = (await db().select().from(schema.runs).where(eq(schema.runs.id, runId)).limit(1))[0];
  if (!run) throw new Error("Run niet gevonden.");
  if (run.status === "done" || run.status === "failed") return run.status;

  const meter = new CostMeter();
  let state: RunState = run.state ?? { steps: [] };
  try {
    switch (run.status) {
      case "profile": {
        state = setStep(state, "profile", { status: "running", detail: "cv en opdracht lezen" });
        emit({ type: "steps", steps: state.steps });
        const profile = await buildProfile({ cvText: run.cvText ?? "", freeText: run.freeText ?? "", previousProfile: run.profile }, meter);
        state = setStep(state, "profile", { status: "done", detail: `${profile.job_titles[0]} · ${profile.region} · ${profile.radius_km} km` });
        await saveRun(runId, { profile, candidateName: profile.candidate_name || run.candidateName, status: "jobboards", state });
        await addCost(runId, meter);
        emit({ type: "status", status: "jobboards", state });
        return "jobboards";
      }
      case "jobboards": {
        const profile = run.profile!;
        state = setStep(state, "jobboards", { status: "running", detail: "VDAB en Adzuna" });
        emit({ type: "steps", steps: state.steps });
        const boards = await searchJobboards(profile);
        const filtered = prefilterJobs(dedupeJobs(boards.jobs), profile);
        const stored = await upsertJobs(filtered);
        state = {
          ...setStep(state, "jobboards", {
            status: "done",
            detail: `${stored.length} vacatures · ${boards.jobs.length} gevonden, ${boards.jobs.length - filtered.length} buiten regio${boards.notes.length ? ` · ${boards.notes.join(" ")}` : ""}`,
          }),
          jobIds: [...(state.jobIds ?? []), ...stored.map((j) => j.id)],
          boardJobsFound: stored.length,
          braveQueriesUsed: (state.braveQueriesUsed ?? 0) + boards.braveQueries,
        };
        await saveRun(runId, { status: "discover", state });
        emit({ type: "status", status: "discover", state });
        return "discover";
      }
      case "discover": {
        const profile = run.profile!;
        state = setStep(state, "discover", { status: "running", detail: "zoekopdrachten bedenken" });
        emit({ type: "steps", steps: state.steps });
        // Bedrijven die < 7 dagen geleden gecrawld zijn: overslaan en hun jobs meenemen.
        const fresh = await recentlyCrawledCompanies();
        const freshDomains = new Set(fresh.map((c) => c.domain));
        const remainingBrave = Math.max(0, LIMITS.braveQueriesPerRun - (state.braveQueriesUsed ?? 0));
        const disc = await discoverCompanies(profile, meter, { maxQueries: Math.min(8, remainingBrave) });
        const reused = fresh.filter((c) => disc.domains.includes(c.domain));
        const toCrawl = disc.domains.filter((d) => !freshDomains.has(d));
        const reusedJobs = reused.length ? await jobsOfCompanies(reused.map((c) => c.id)) : [];
        const reusedFiltered = prefilterJobs(reusedJobs, profile);
        state = {
          ...setStep(state, "discover", {
            status: "done",
            detail: `${disc.domains.length} bedrijven · ${reused.length} recent al bekeken${disc.note ? ` · ${disc.note}` : ""}`,
          }),
          domains: toCrawl,
          crawlIndex: 0,
          companiesWithJobs: reused.filter((c) => c.openJobsCount > 0).length,
          siteJobsFound: reusedFiltered.length,
          jobIds: [...(state.jobIds ?? []), ...reusedFiltered.map((j) => j.id)],
          braveQueriesUsed: (state.braveQueriesUsed ?? 0) + disc.braveQueries,
        };
        const next: Run["status"] = toCrawl.length ? "crawl" : "score";
        await saveRun(runId, { status: next, state });
        await addCost(runId, meter);
        emit({ type: "status", status: next, state });
        return next;
      }
      case "crawl": {
        const profile = run.profile!;
        const domains = state.domains ?? [];
        let index = state.crawlIndex ?? 0;
        const started = Date.now();
        const total = domains.length;
        const report = () => {
          state = setStep(state, "crawl", {
            status: "running",
            detail: `${index} / ${total} · ${state.companiesWithJobs ?? 0} met open vacatures · ${state.siteJobsFound ?? 0} vacatures`,
          });
          emit({ type: "steps", steps: state.steps });
        };
        report();
        while (index < total && Date.now() - started < LIMITS.stepTimeBudgetMs) {
          const batch = domains.slice(index, index + LIMITS.crawlConcurrency);
          const allowBrave = (state.braveQueriesUsed ?? 0) < LIMITS.braveQueriesPerRun;
          const results = await Promise.all(batch.map((d) => crawlDomain(d, profile, meter, allowBrave).catch((e: unknown) => ({ domain: d, jobs: [] as Job[], hadJobs: false, braveUsed: false, error: String(e) }))));
          for (const r of results) {
            if (r.hadJobs) state.companiesWithJobs = (state.companiesWithJobs ?? 0) + 1;
            state.siteJobsFound = (state.siteJobsFound ?? 0) + r.jobs.length;
            state.jobIds = [...(state.jobIds ?? []), ...r.jobs.map((j) => j.id)];
            if (r.braveUsed) state.braveQueriesUsed = (state.braveQueriesUsed ?? 0) + 1;
          }
          index += batch.length;
          state.crawlIndex = index;
          await saveRun(runId, { state });
          report();
        }
        await addCost(runId, meter);
        if (index >= total) {
          state = setStep(state, "crawl", { status: "done", detail: `${total} bedrijven · ${state.companiesWithJobs ?? 0} met open vacatures · ${state.siteJobsFound ?? 0} vacatures` });
          await saveRun(runId, { status: "score", state });
          emit({ type: "status", status: "score", state });
          return "score";
        }
        await saveRun(runId, { state });
        emit({ type: "status", status: "crawl", state });
        return "crawl";
      }
      case "score": {
        const profile = run.profile!;
        state = setStep(state, "score", { status: "running", detail: "voorselectie" });
        emit({ type: "steps", steps: state.steps });
        const ids = Array.from(new Set(state.jobIds ?? []));
        const all = await loadJobs(ids);
        const names = await companyNames(all);
        const deduped = dedupeJobs(all.map((j) => ({ ...j, companyName: names.get(j.id) ?? "" })));
        const dedupedJobs = deduped.map((d) => all.find((j) => j.id === d.id)!).filter(Boolean);
        const shortlist = await preselect(profile, dedupedJobs, names, meter);
        state = setStep(state, "score", { status: "running", detail: `${dedupedJobs.length} uniek · ${shortlist.length} naar eindscoring` });
        emit({ type: "steps", steps: state.steps });
        const result = await scoreJobs(profile, shortlist, names, meter);
        // Harde zeef volgens de RecruitrLAB-methode, los van wat het model vond.
        const scoredCount = result.scored.length;
        const passing = result.scored.filter(
          (s) =>
            s.score >= LIMITS.minScoreToShow &&
            s.contract !== "interim" &&
            s.contract !== "freelance" &&
            s.contract !== "tijdelijk" &&
            s.employerIdentifiable &&
            !s.hardBlocker &&
            Boolean((names.get(s.job.id) ?? "").trim()) &&
            withinRadius(s.job.location, profile.region, profile.radius_km) !== false &&
            !isIntermediaryCompany(names.get(s.job.id) ?? "", s.job.url),
        );
        // Max 2 vacatures per werkgever, max 10 in totaal, beste eerst.
        const perEmployer = new Map<string, number>();
        result.scored = passing
          .sort((x, y) => y.score - x.score)
          .filter((s) => {
            const key = (names.get(s.job.id) ?? "").toLowerCase().replace(/\b(nv|bv|bvba|sa|srl|cvba)\b/g, "").replace(/[^a-z0-9]/g, "");
            const n = perEmployer.get(key) ?? 0;
            if (n >= LIMITS.maxPerEmployer) return false;
            perEmployer.set(key, n + 1);
            return true;
          })
          .slice(0, LIMITS.maxResults);
        if (scoredCount > 0 && result.scored.length === 0) {
          result.intro = `Ik bekeek ${scoredCount} vacatures, maar geen enkele haalt 6/10 bij een rechtstreekse werkgever met vast contract.`;
          result.followups = ["Zoek in een grotere straal", "Zoek met een verwante functietitel"];
        }
        await db().delete(schema.matches).where(eq(schema.matches.runId, runId));
        if (result.scored.length) {
          await db()
            .insert(schema.matches)
            .values(result.scored.map((s, i) => ({ runId, jobId: s.job.id, score: s.score, reason: s.reason, argument: s.argument, risk: s.risk, rank: i + 1 })));
        }
        state = {
          ...setStep(state, "score", { status: "done", detail: `${scoredCount} gescoord · ${result.scored.length} passend (≥ 6/10)` }),
          intro: result.intro,
          followups: result.followups,
        };
        await saveRun(runId, { status: "done", state });
        await addCost(runId, meter);
        await db()
          .update(schema.messages)
          .set({ content: { kind: "assistant", intro: result.intro, followups: result.followups } })
          .where(and(eq(schema.messages.runId, runId), eq(schema.messages.role, "assistant")));
        emit({ type: "status", status: "done", state });
        return "done";
      }
      case "signals": {
        // Oude runs die nog in deze stap stonden: gewoon afronden.
        await saveRun(runId, { status: "done", state });
        emit({ type: "status", status: "done", state });
        return "done";
      }
      default:
        return run.status;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const current = state.steps.find((s) => s.status === "running");
    if (current) state = setStep(state, current.key, { status: "error", detail: message.slice(0, 160) });
    state.error = message;
    await saveRun(runId, { status: "failed", state });
    await addCost(runId, meter);
    emit({ type: "error", message });
    emit({ type: "status", status: "failed", state });
    return "failed";
  }
}

type CrawlOutcome = { domain: string; jobs: Job[]; hadJobs: boolean; braveUsed: boolean; error?: string };

/** Stap 4 + 5 voor één domein, met opslag in companies en jobs. */
async function crawlDomain(domain: string, profile: Profile, meter: CostMeter, allowBrave: boolean): Promise<CrawlOutcome> {
  const found = await findJobsPage(domain, meter, { allowBrave });
  const base = { domain, name: found.companyName, lastCrawledAt: new Date() };
  let normalized: NormalizedJob[] = [];
  let atsValue: Company["ats"] = "unknown";
  let jobsUrl: string | null = null;
  let notes: string | null = null;
  let braveUsed = false;

  if (found.kind === "ats") {
    atsValue = found.detection.adapter.id;
    jobsUrl = found.jobsUrl;
    const fromFeed = await extractFromAts(found.detection, found.companyName);
    if (fromFeed) {
      normalized = fromFeed;
    } else {
      // Geen feed: de career site van het ATS door de generieke extractie.
      const { fetchPage } = await import("@/lib/fetch");
      const page = await fetchPage(found.jobsUrl, { allowJina: true });
      if (page.status >= 200 && page.status < 300 && page.text) {
        const r = await extractFromPage({ jobsUrl: found.jobsUrl, text: page.text, links: page.links, companyName: found.companyName }, meter);
        normalized = r.jobs;
      }
    }
  } else if (found.kind === "page") {
    atsValue = "unknown";
    jobsUrl = found.jobsUrl;
    notes = `gevonden via ${found.how}`;
    braveUsed = found.how === "brave";
    const r = await extractFromPage({ jobsUrl: found.jobsUrl, text: found.text, links: found.links, companyName: found.companyName }, meter);
    normalized = r.jobs;
  } else {
    atsValue = "none";
    notes = found.reason;
    braveUsed = found.braveUsed;
  }

  const company = (
    await db()
      .insert(schema.companies)
      .values({ ...base, ats: atsValue, jobsUrl, openJobsCount: normalized.length, notes })
      .onConflictDoUpdate({
        target: schema.companies.domain,
        set: { name: base.name, ats: atsValue, jobsUrl, lastCrawledAt: base.lastCrawledAt, openJobsCount: normalized.length, notes },
      })
      .returning()
  )[0];

  const filtered = prefilterJobs(normalized, profile);
  const stored = await upsertJobs(filtered.map((j) => ({ ...j, companyId: company.id })));
  return { domain, jobs: stored, hadJobs: normalized.length > 0, braveUsed };
}

async function recentlyCrawledCompanies(): Promise<Company[]> {
  const since = new Date(Date.now() - LIMITS.cacheTtlDays * 24 * 3600 * 1000);
  return db().select().from(schema.companies).where(and(gt(schema.companies.lastCrawledAt, since), ne(schema.companies.ats, "unknown")));
}

async function jobsOfCompanies(ids: number[]): Promise<Job[]> {
  if (!ids.length) return [];
  return db().select().from(schema.jobs).where(inArray(schema.jobs.companyId, ids));
}

/** Bedrijfsnaam per job: uit companies, anders uit raw. */
export async function companyNames(jobsIn: Job[]): Promise<Map<number, string>> {
  const ids = Array.from(new Set(jobsIn.map((j) => j.companyId).filter((x): x is number => x !== null)));
  const rows = ids.length ? await db().select().from(schema.companies).where(inArray(schema.companies.id, ids)) : [];
  const byCompany = new Map(rows.map((c) => [c.id, companyLabel(c)]));
  const out = new Map<number, string>();
  for (const j of jobsIn) {
    const raw = (j.raw ?? {}) as { companyName?: string; company?: string };
    out.set(j.id, (j.companyId && byCompany.get(j.companyId)) || raw.companyName || raw.company || "");
  }
  return out;
}

