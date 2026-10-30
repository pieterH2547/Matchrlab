/**
 * Orchestrator: voert telkens één korte stap uit en schrijft het resultaat
 * weg. De client roept `advanceRun` herhaaldelijk aan tot de status "done"
 * of "failed" is; een afgebroken run gaat gewoon verder bij de volgende aanroep.
 * Voortgang gaat via `emit` naar de SSE-stream.
 */
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Run, Company, Job } from "@/lib/db/schema";
import { CostMeter } from "@/lib/llm";
import { LIMITS } from "@/lib/config";
import { buildProfile, isVagueRegion } from "./profile";
import { searchOpenAIJobs } from "./aisearch";
import { buildXrayPlan, normalizeXray, orderByYield, type XrayItem } from "./xray";
import { runSource, runWebQueries, searchJobboards, searchTitles, searchPlaces, searchTargetedWeb, searchJooble, searchAdzuna } from "./jobboards";
import { discoverCompanies, type DiscoveredCompany } from "./discover";
import { verifyMany } from "./verify";
import { buildEmployers } from "./employers";
import { withUsage, mergeCalls, mergeTimings } from "@/lib/usage";
import { minScore100 } from "@/lib/settings";
import { findJobsPage } from "./findJobsPage";
import { extractFromAts, extractFromPage } from "./extract";
import { preselect, scoreJobs, quickShortlist, type RawScore } from "./score";
import { contentHash, freshVerification, profileFingerprint, readCache, saveVerifications, scoreKey, sha, writeCache } from "./index-cache";
import { prefilterJobs, prefilterWithReasons, upsertJobs, loadJobs, dedupeJobs } from "./jobstore";
import { applyHardFilters, explainNoMatches, toVerifyFlags } from "./filters";
import { findContact, employerDomainFor, type Contact } from "./contact";
import type { Funnel } from "./types";
import { redactSecrets } from "@/lib/redact";
import { getAdapter } from "@/lib/ats";
import type { JobsPageResult } from "./findJobsPage";
import { fetchPage } from "@/lib/fetch";
import { countCall } from "@/lib/usage";
import { isIntermediaryCompany } from "@/lib/blocklist";
import { withinProfileRadius } from "@/lib/geo";
import type { RunState, StepState, NormalizedJob, Profile, EmployerView } from "./types";

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
  // Idempotent hervatten: loopt deze run al ergens (andere tab, of de vorige aanroep na een afgebroken
  // verbinding), dan wachten we tot die klaar is in plaats van dezelfde stap dubbel te doen.
  const deadline = Date.now() + 250_000;
  while (!(await acquireLock(runId))) {
    if (Date.now() > deadline) {
      const row = (await db().select({ status: schema.runs.status }).from(schema.runs).where(eq(schema.runs.id, runId)).limit(1))[0];
      return row?.status ?? "failed";
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  try {
    return await advanceRunLocked(runId, emit);
  } finally {
    await db().update(schema.runs).set({ lockedUntil: null }).where(eq(schema.runs.id, runId)).catch(() => undefined);
  }
}

async function acquireLock(runId: number): Promise<boolean> {
  const rows = await db()
    .update(schema.runs)
    .set({ lockedUntil: sql`now() + interval '295 seconds'` })
    .where(and(eq(schema.runs.id, runId), sql`(${schema.runs.lockedUntil} is null or ${schema.runs.lockedUntil} < now())`))
    .returning({ id: schema.runs.id });
  return rows.length > 0;
}

async function advanceRunLocked(runId: number, emit: Emit): Promise<Run["status"]> {
  const { result, usage } = await withUsage(() => advanceRunInner(runId, emit));
  // API-aanroepen per bron en mislukte bronnen bijschrijven in het run-overzicht.
  if (Object.keys(usage.calls).length || usage.failures.length || Object.keys(usage.timings).length) {
    const row = (await db().select().from(schema.runs).where(eq(schema.runs.id, runId)).limit(1))[0];
    if (row) {
      const st = row.state ?? { steps: [] };
      const stats = st.stats ?? {};
      st.stats = {
        ...stats,
        apiCalls: mergeCalls(stats.apiCalls, usage.calls),
        apiTimings: mergeTimings(stats.apiTimings, usage.timings),
        failures: Array.from(new Set([...(stats.failures ?? []), ...usage.failures])).slice(0, 12),
      };
      await saveRun(runId, { state: st });
    }
  }
  return result;
}

async function advanceRunInner(runId: number, emit: Emit): Promise<Run["status"]> {
  const run = (await db().select().from(schema.runs).where(eq(schema.runs.id, runId)).limit(1))[0];
  if (!run) throw new Error("Run niet gevonden.");
  if (run.status === "done" || run.status === "failed") return run.status;

  const meter = new CostMeter();
  let state: RunState = run.state ?? { steps: [] };
  try {
    switch (run.status) {
      case "profile": {
        const tProfile = Date.now();
        state = setStep(state, "profile", { status: "running", detail: "cv en opdracht lezen" });
        emit({ type: "steps", steps: state.steps });
        // Zelfde cv + opdracht al eens gelezen (bv. opnieuw zoeken): profiel uit de cache, geen AI-wachttijd.
        const profileKey = `profile:${sha(`${run.cvText ?? ""}\n${run.freeText ?? ""}`)}`;
        const cachedProfile = run.profile ? null : (await readCache<Profile>([profileKey], 30)).get(profileKey);
        const profile = cachedProfile ?? (await buildProfile({ cvText: run.cvText ?? "", freeText: run.freeText ?? "", previousProfile: run.profile }, meter));
        if (!cachedProfile && !run.profile) await writeCache("profile", [{ key: profileKey, value: profile }]);
        if (cachedProfile) countCall("profile_cache");
        if (isVagueRegion(profile.region)) {
          // Zonder woonplaats zoeken we niet in heel Vlaanderen: eerst de regio vragen (snel en goedkoop).
          state = {
            ...setStep(state, "profile", { status: "done", detail: `${profile.job_titles[0]} · regio onbekend` }),
            steps: setStep(state, "profile", { status: "done", detail: `${profile.job_titles[0]} · regio onbekend` }).steps.map((s) => (s.key === "profile" ? s : { ...s, status: "skipped" as const })),
            intro: "Ik vind geen woonplaats in het cv. Vul de regio in (bv. Mechelen) bij Aanpassen of in het regioveld onderaan, dan zoek ik gericht.",
            followups: [],
            needsRegion: true,
          };
          await saveRun(runId, { profile, candidateName: profile.candidate_name || run.candidateName, status: "done", state });
          await addCost(runId, meter);
          emit({ type: "status", status: "done", state });
          return "done";
        }
        state = setStep(state, "profile", { status: "done", detail: `${profile.job_titles[0]} · ${profile.region} · ${profile.radius_km} km` });
        state = timed(state, "profile", Date.now() - tProfile);
        // Warme index: vacatures die we al kennen en die voor dit profiel al gescoord zijn, meteen tonen
        // (enkel als hun controle recent is). Anders een voorlopige lijst uit de index, nog niet beoordeeld.
        const tWarm = Date.now();
        const warm = await warmStart(runId, profile).catch(() => ({ shown: 0, preview: [] as PreviewItem[], ids: [] as number[] }));
        state = timed(state, "warmIndex", Date.now() - tWarm);
        if (warm.shown) state = timed(state, "firstResult", Date.now() - (state.stats?.startedAt ?? run.createdAt.getTime()));
        state = { ...state, preview: warm.preview, jobIds: [...(state.jobIds ?? []), ...warm.ids], stats: { ...(state.stats ?? {}), startedAt: state.stats?.startedAt ?? run.createdAt.getTime() } };
        await saveRun(runId, { profile, candidateName: profile.candidate_name || run.candidateName, status: "jobboards", state });
        await addCost(runId, meter);
        emit({ type: "status", status: "jobboards", state });
        return "jobboards";
      }
      case "jobboards": {
        if (isVagueRegion(run.profile?.region)) {
          state = { ...state, steps: state.steps.map((st) => (st.key === "profile" ? st : { ...st, status: "skipped" as const })), intro: "Er is nog geen regio. Vul ze in bij Aanpassen (bv. Mechelen), dan zoek ik gericht.", followups: [], needsRegion: true };
          await saveRun(runId, { status: "done", state });
          emit({ type: "status", status: "done", state });
          return "done";
        }
        const profile = run.profile!;
        // Fast Search: enkel de snelle vacaturebronnen. Bedrijfsontdekking, websites en OpenAI Web Search
        // lopen daarna in Deep Search, terwijl de eerste matches al zichtbaar zijn.
        const t0 = Date.now();
        state = setStep(state, "jobboards", { status: "running", detail: "Google Jobs, Jooble, Adzuna en gerichte Google-zoekopdrachten (VDAB, Indeed, LinkedIn, ATS)" });
        emit({ type: "steps", steps: state.steps });
        // Warme vacature-index: recent geziene vacatures uit eerdere runs, meteen beschikbaar (geen API).
        const indexedPromise = indexedCandidates(profile).catch(() => [] as Job[]);
        // X-ray-zoekplan (AI) loopt mee, maar Fast Search wacht er niet op: het wordt in Deep Search gebruikt.
        let xrayPlan: XrayItem[] | null = null;
        const xrayPromise = buildXrayPlan(profile, meter)
          .then((p) => (xrayPlan = p))
          .catch(() => null);
        const boards = await searchJobboards(profile, {
          ai: async () => ({ jobs: [], rounds: 0, searches: 0, raw: 0, costEur: 0, durationMs: 0, model: null, queries: [], skipped: "loopt in Deep Search" }),
          timeoutMs: LIMITS.fastSourceTimeoutMs,
        });
        state.slowSources = boards.slow ?? [];
        await Promise.race([xrayPromise, new Promise((r) => setTimeout(r, 1500))]);
        if (xrayPlan) state.xrayPlan = xrayPlan;
        const unique = dedupeJobs(boards.jobs);
        const pf = prefilterWithReasons(unique, profile);
        const filtered = pf.kept;
        const stored = await upsertJobs(filtered);
        if (boards.ai) meter.eur += boards.ai.costEur;
        const perSource = Object.entries(boards.perSource)
          .filter(([, n]) => n > 0)
          .map(([k, n]) => `${SOURCE_LABEL[k] ?? k} ${n}`)
          .join(", ");
        const funnel: Funnel = {
          ...(state.stats?.funnel ?? {}),
          sources: boards.sources,
          found: (state.stats?.funnel?.found ?? 0) + boards.jobs.length,
          duplicates: (state.stats?.funnel?.duplicates ?? 0) + (boards.jobs.length - unique.length),
          prefilter: pf.dropped,
          ai: boards.ai
            ? { rounds: boards.ai.rounds, searches: boards.ai.searches, raw: boards.ai.raw, kept: boards.ai.jobs.length, costEur: boards.ai.costEur, durationMs: boards.ai.durationMs, model: boards.ai.model, error: boards.ai.error, skipped: boards.ai.skipped }
            : undefined,
        };
        state = {
          ...setStep(state, "jobboards", {
            status: "done",
            detail: `${stored.length} bruikbaar · ${boards.jobs.length} gevonden${perSource ? ` (${perSource})` : ""} · ${boards.jobs.length - unique.length} dubbel · ${pf.dropped.regio} buiten regio, ${pf.dropped.tussenpersoon} tussenpersoon${pf.dropped.uitsluiting ? `, ${pf.dropped.uitsluiting} uitgesloten` : ""}${boards.notes.length ? ` · ${boards.notes.join(" ")}` : ""}`,
          }),
          stats: { ...(state.stats ?? {}), startedAt: state.stats?.startedAt ?? run.createdAt.getTime(), rawJobs: (state.stats?.rawJobs ?? 0) + boards.jobs.length, funnel },
          jobIds: [...(state.jobIds ?? []), ...stored.map((j) => j.id), ...(await indexedPromise).map((j) => j.id)],
          boardJobsFound: stored.length,
          braveQueriesUsed: (state.braveQueriesUsed ?? 0) + boards.braveQueries,
          phase: "fast",
        };
        state = timed(state, "jobboards", Date.now() - t0);
        await saveRun(runId, { status: "score", state });
        await addCost(runId, meter);
        emit({ type: "status", status: "score", state });
        return "score";
      }
      case "discover": {
        const profile = run.profile!;
        const tDisc = Date.now();
        state = setStep(state, "discover", { status: "running", detail: "lokale werkgevers zoeken per gemeente" });
        emit({ type: "steps", steps: state.steps });
        // Bedrijven die < 7 dagen geleden gecrawld zijn: overslaan en hun jobs meenemen.
        const fresh = await recentlyCrawledCompanies();
        const freshDomains = new Set(fresh.map((c) => c.domain));
        const remainingBrave = Math.max(0, LIMITS.braveQueriesPerRun - (state.braveQueriesUsed ?? 0));
        const disc = state.prefetchedDiscovery ?? (await discoverCompanies(profile, meter, { maxQueries: Math.min(8, remainingBrave) }));
        state.prefetchedDiscovery = undefined;
        await saveDiscovered(disc.companies);
        const reused = fresh.filter((c) => disc.domains.includes(c.domain));
        const toCrawl = disc.domains.filter((d) => !freshDomains.has(d));
        const reusedJobs = reused.length ? await jobsOfCompanies(reused.map((c) => c.id)) : [];
        const reusedPf = prefilterWithReasons(reusedJobs, profile);
        const reusedFiltered = reusedPf.kept;
        state = {
          ...setStep(state, "discover", {
            status: "done",
            detail: `${disc.domains.length} werkgevers (${disc.companies.filter((c) => c.via === "maps").length} via Google Maps in ${disc.municipalities ?? 0} gemeenten, ${disc.fromLocalDb ?? 0} al bekend in de buurt) · ${disc.outOfRadius} buiten de straal · ${reused.length} recent al bekeken${disc.note ? ` · ${disc.note}` : ""}`,
          }),
          domains: toCrawl,
          companyDomains: disc.domains,
          crawlIndex: 0,
          companiesWithJobs: reused.filter((c) => c.openJobsCount > 0).length,
          siteJobsFound: reusedFiltered.length,
          jobIds: [...(state.jobIds ?? []), ...reusedFiltered.map((j) => j.id)],
          braveQueriesUsed: (state.braveQueriesUsed ?? 0) + disc.braveQueries,
        };
        {
          const f = state.stats?.funnel ?? {};
          const p0 = f.prefilter ?? { regio: 0, tussenpersoon: 0, uitsluiting: 0 };
          state.stats = {
            ...(state.stats ?? {}),
            funnel: {
              ...f,
              local: { municipalities: disc.municipalities ?? 0, mapsQueries: disc.mapsQueries ?? 0, fromLocalDb: disc.fromLocalDb ?? 0, companies: disc.domains.length },
              prefilter: { regio: p0.regio + reusedPf.dropped.regio, tussenpersoon: p0.tussenpersoon + reusedPf.dropped.tussenpersoon, uitsluiting: p0.uitsluiting + reusedPf.dropped.uitsluiting } },
          };
        }
        // Ook zonder websites om te bekijken naar de crawlstap: daar loopt OpenAI Web Search mee.
        const next: Run["status"] = toCrawl.length || !state.aiDone ? "crawl" : "score";
        state = timed(state, "discover", Date.now() - tDisc);
        await saveRun(runId, { status: next, state });
        await addCost(runId, meter);
        emit({ type: "status", status: next, state });
        return next;
      }
      case "crawl": {
        const profile = run.profile!;
        const domains = state.domains ?? [];
        const done = new Set(state.crawlDone ?? domains.slice(0, state.crawlIndex ?? 0));
        const todo = domains.filter((d) => !done.has(d));
        const started = Date.now();
        const total = domains.length;
        const report = () => {
          state = setStep(state, "crawl", {
            status: "running",
            detail: `${done.size} / ${total} · ${state.companiesWithJobs ?? 0} met open vacatures · ${state.siteJobsFound ?? 0} vacatures`,
          });
          emit({ type: "steps", steps: state.steps });
        };
        report();
        // OpenAI Web Search loopt tegelijk met het bekijken van de websites (één keer per run).
        const aiRun = !state.aiDone ? runAiSearch(profile, state.slowSources ?? [], state.xrayPlan ?? null, meter) : null;
        let aiPending = Boolean(aiRun);
        void aiRun?.then(() => {
          aiPending = false;
        });
        let cursor = 0;
        const worker = async () => {
          // Zolang OpenAI Web Search loopt, gewoon verder crawlen (die tijd is er toch); hard plafond 150 s.
          while (cursor < todo.length && (Date.now() - started < LIMITS.stepTimeBudgetMs || aiPending) && Date.now() - started < 150_000) {
            const d = todo[cursor++];
            const allowSearch = (state.braveQueriesUsed ?? 0) < LIMITS.braveQueriesPerRun;
            const r = await withTimeout(crawlDomain(d, profile, meter, allowSearch), LIMITS.perDomainTimeoutMs).catch(
              (e: unknown) => ({ domain: d, jobs: [] as Job[], hadJobs: false, braveUsed: false, error: String(e) }) as CrawlOutcome,
            );
            done.add(d);
            if (r.hadJobs) state.companiesWithJobs = (state.companiesWithJobs ?? 0) + 1;
            state.stats = { ...(state.stats ?? {}), rawJobs: (state.stats?.rawJobs ?? 0) + (r.rawCount ?? 0), employersExamined: (state.stats?.employersExamined ?? 0) + 1 };
            state.siteJobsFound = (state.siteJobsFound ?? 0) + r.jobs.length;
            state.jobIds = [...(state.jobIds ?? []), ...r.jobs.map((j) => j.id)];
            if (r.braveUsed) state.braveQueriesUsed = (state.braveQueriesUsed ?? 0) + 1;
            state.crawlDone = Array.from(done);
            state.crawlIndex = done.size;
            report();
            await saveRun(runId, { state });
          }
        };
        await Promise.all(Array.from({ length: Math.min(LIMITS.crawlConcurrency, todo.length) }, worker));
        if (aiRun) {
          state = setStep(state, "jobboards", { status: "done", detail: `${state.steps.find((s) => s.key === "jobboards")?.detail ?? ""} · OpenAI Web Search loopt` });
          const ai = await aiRun;
          meter.eur += ai.result.costEur;
          state = applyAi(state, ai);
        }
        state = timed(state, "crawl", Date.now() - started, true);
        await addCost(runId, meter);
        if (done.size >= total) {
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
        // Fasen: fast (vacaturebanken) → ai (OpenAI Web Search + X-ray, zoals ChatGPT) → deep (lokale werkgevers, websites).
        const aiPhase = state.phase === "ai";
        const fast = state.phase === "fast" || aiPhase;
        const tScore = Date.now();
        let aiJobIds = new Set<number>();
        if (aiPhase && !state.aiDone) {
          state = setStep(state, "ai", { status: "running", detail: "AI zoekt op het web (vacaturesites, bedrijfssites, LinkedIn Jobs via zoekresultaten)" });
          emit({ type: "steps", steps: state.steps });
          const ai = await runAiSearch(profile, state.slowSources ?? [], state.xrayPlan ?? null, meter);
          meter.eur += ai.result.costEur;
          state = applyAi(state, ai);
          aiJobIds = new Set(ai.stored.map((j) => j.id));
        }
        state = setStep(state, aiPhase ? "ai" : fast ? "first" : "score", {
          status: "running",
          detail: aiPhase ? `${aiJobIds.size} nieuwe vacatures van het AI-zoeken controleren en scoren` : fast ? "beste vacatures uit de bronnen controleren en scoren" : "alles samenvoegen",
        });
        emit({ type: "steps", steps: state.steps });
        const funnel: Funnel = { ...(state.stats?.funnel ?? {}) };
        const ids = Array.from(new Set(state.jobIds ?? []));
        const all = await loadJobs(ids);
        const names = await companyNames(all);
        funnel.siteJobs = all.filter((j) => j.source === "company_site").length;
        // Deterministisch dedupliceren; bij dubbels wint de pagina van de eindwerkgever.
        const deduped = dedupeJobs(
          all.map((j) => ({ ...j, companyName: names.get(j.id) ?? "", externalId: j.externalId, location: j.location, raw: j.raw })),
        );
        const dedupedJobs = deduped.map((d) => all.find((j) => j.id === d.id)!).filter(Boolean);
        funnel.duplicates = (funnel.duplicates ?? 0) + (all.length - dedupedJobs.length);
        funnel.unique = dedupedJobs.length;
        const preInfo = { input: 0, aiKept: 0, filled: 0, output: 0, aiFailed: false };
        const tPre = Date.now();
        // Fast Search: geen AI-voorselectie (die kostte in productie ±90 s), wel een deterministische top 12.
        let shortlistRaw: Job[];
        if (fast) {
          // Top 12 + alles wat voor dit profiel al een score heeft (kost niets en verdwijnt dan niet uit beeld).
          // AI-fase: de nieuwe AI-vacatures eerst (die zijn al gericht gezocht), aangevuld met de beste andere.
          const fromAi = dedupedJobs.filter((j) => aiJobIds.has(j.id));
          const top = aiPhase
            ? [...quickShortlist(profile, fromAi, 12), ...quickShortlist(profile, dedupedJobs.filter((j) => !aiJobIds.has(j.id)), 8)]
            : quickShortlist(profile, dedupedJobs, 12);
          const keys = new Map(dedupedJobs.map((j) => [j.id, scoreKey(profile, j.contentHash ?? contentHash(j))]));
          const known = await readCache<RawScore>(Array.from(keys.values()), 14);
          const already = dedupedJobs.filter((j) => known.has(keys.get(j.id)!) && !top.includes(j));
          shortlistRaw = [...top, ...already.slice(0, 20)];
        } else {
          shortlistRaw = await preselect(profile, dedupedJobs, names, meter, preInfo);
        }
        state = timed(state, fast ? "preselectFast" : "preselect", Date.now() - tPre);
        funnel.preselect = preInfo;

        // Verificatie vóór de eindscoring: gesloten vacatures vallen weg, de rest krijgt een status.
        state = setStep(state, "score", { status: "running", detail: `${dedupedJobs.length} uniek · ${shortlistRaw.length} controleren of ze nog open zijn` });
        emit({ type: "steps", steps: state.steps });
        // Fast Search: de 20 beste eerst, zodat er snel iets bruikbaars staat.
        const toVerify = shortlistRaw.slice(0, fast ? 20 : LIMITS.maxVerifyPerRun);
        const tVerify = Date.now();
        // Al gecontroleerd in een eerdere stap van deze run: niet opnieuw ophalen.
        const vCache = state.verifyCache ?? {};
        const checkNow = toVerify.filter((j) => !vCache[String(j.id)]);
        const verdicts = await verifyMany(checkNow, 8, state.stats?.startedAt ?? run.createdAt.getTime());
        // In de vacature-index bewaren, maar enkel wat nu echt gecontroleerd werd (niet wat uit de index kwam).
        await saveVerifications(
          checkNow
            .filter((j) => !freshVerification(j))
            .map((j) => ({ id: j.id, ...(verdicts.get(j.id) ?? { status: "niet geverifieerd", reason: "controle mislukt" }) })),
        );
        for (const j of toVerify) if (vCache[String(j.id)] && !verdicts.has(j.id)) verdicts.set(j.id, vCache[String(j.id)]);
        state.verifyCache = Object.fromEntries(Array.from(verdicts.entries()).map(([id, v]) => [String(id), v]));
        const shortlist = toVerify.filter((j) => verdicts.get(j.id)?.status !== "gesloten");
        const closed = toVerify.length - shortlist.length;
        funnel.checked = toVerify.length;
        funnel.closed = closed;
        funnel.verifiedActive = Array.from(verdicts.values()).filter((v) => v.status === "actief").length;
        funnel.toScoring = shortlist.length;
        state = timed(state, fast ? "verifyFast" : "verify", Date.now() - tVerify);
        const tScoring = Date.now();

        state = setStep(state, "score", { status: "running", detail: `${dedupedJobs.length} uniek · ${closed} gesloten · ${shortlist.length} naar eindscoring` });
        emit({ type: "steps", steps: state.steps });
        const scoreInfo = { requested: 0, scored: 0, missing: 0, batches: 0, failedBatches: 0 };
        // Voorlopige Fast-scores (lichte AI-instelling) worden in Deep Search opnieuw en grondiger beoordeeld.
        const provisional = new Set(state.provisionalScores ?? []);
        const scoreCache = new Map(
          Object.entries(state.scoreCache ?? {})
            .filter(([k]) => fast || !provisional.has(Number(k)))
            .map(([k, v]) => [Number(k), v]),
        );
        // Scores uit eerdere runs: enkel bij hetzelfde profiel, dezelfde vacaturetekst en dezelfde scoringsversie.
        const keyOf = new Map(shortlist.map((j) => [j.id, scoreKey(profile, j.contentHash ?? contentHash(j))]));
        const crossRun = await readCache<RawScore>(Array.from(keyOf.values()), 14);
        let fromCrossRun = 0;
        for (const j of shortlist) {
          const hit = crossRun.get(keyOf.get(j.id)!);
          if (hit && !scoreCache.has(j.id)) {
            scoreCache.set(j.id, { ...hit, id: j.id });
            fromCrossRun += 1;
          }
        }
        const result = await scoreJobs(profile, shortlist, names, meter, scoreInfo, undefined, scoreCache, fast ? 4 : LIMITS.scoreBatchSize, fast ? "low" : "medium");
        const fresh = new Set((result.raw ?? []).filter((r) => !scoreCache.has(r.id)).map((r) => r.id));
        state.scoreCache = Object.fromEntries((result.raw ?? []).map((r) => [String(r.id), r]));
        state.provisionalScores = fast ? Array.from(new Set([...(state.provisionalScores ?? []), ...fresh])) : [];
        // Enkel grondige (Deep) scores gaan in de cache over runs heen.
        if (!fast) {
          await writeCache(
            "score",
            (result.raw ?? []).filter((r) => keyOf.has(r.id) && !crossRun.has(keyOf.get(r.id)!)).map((r) => ({ key: keyOf.get(r.id)!, value: r })),
          );
        }
        funnel.scoreCacheHits = fromCrossRun;
        funnel.scoring = scoreInfo;
        state = timed(state, fast ? "scoringFast" : "scoring", Date.now() - tScoring);
        const threshold = await minScore100();
        // Harde zeef: tijdelijk/interim, bevestigde tussenpersoon, buiten straal, harde eis, onder de drempel.
        // Onbekend contract of onbekende werkgever blijft, met het label 'te verifiëren'.
        const scoredCount = result.scored.length;
        const { kept: passing, reasons } = applyHardFilters(result.scored, names, profile, threshold);
        funnel.reasons = reasons;

        // Weinig relevante resultaten: één beperkte tweede zoekronde met andere titels en gemeenten.
        // De straal, regio en harde voorwaarden blijven dezelfde; vacatures die al gescoord zijn, worden niet opnieuw beoordeeld.
        if (!fast && passing.length < LIMITS.secondRoundBelow && !state.secondRoundDone) {
          state.secondRoundDone = true;
          state = setStep(state, "score", { status: "running", detail: `${passing.length} passend: tweede zoekronde met verwante titels en andere gemeenten` });
          emit({ type: "steps", steps: state.steps });
          const extra = await secondRound(profile).catch(() => ({ jobs: [] as Job[], queries: 0 }));
          const known = new Set(state.jobIds ?? []);
          const fresh = extra.jobs.filter((j) => !known.has(j.id));
          funnel.secondRound = { queries: extra.queries, newJobs: fresh.length };
          state.stats = { ...(state.stats ?? {}), funnel };
          if (fresh.length) {
            state.jobIds = [...(state.jobIds ?? []), ...fresh.map((j) => j.id)];
            await saveRun(runId, { status: "score", state });
            await addCost(runId, meter);
            emit({ type: "status", status: "score", state });
            return "score";
          }
        }
        funnel.aboveThreshold = result.scored.filter((s) => s.score >= threshold).length;
        // Max 2 vacatures per werkgever, max 10 in totaal; bij gelijke score wint een geverifieerde, dan een bevestigde.
        const perEmployer = new Map<string, number>();
        const verifiedFirst = (x: (typeof passing)[number]) => (verdicts.get(x.job.id)?.status === "actief" ? 2 : 0) + (x.contract === "vast" && x.employerStatus === "rechtstreeks" ? 1 : 0);
        const employerKey = (s: (typeof passing)[number]) => {
          const n = (names.get(s.job.id) ?? "").toLowerCase().replace(/\b(nv|bv|bvba|sa|srl|cvba)\b/g, "").replace(/[^a-z0-9]/g, "");
          if (n) return n;
          try {
            return new URL(s.job.url).hostname;
          } catch {
            return `#${s.job.id}`;
          }
        };
        result.scored = passing
          .sort((x, y) => y.score - x.score || verifiedFirst(y) - verifiedFirst(x))
          .filter((s) => {
            const key = employerKey(s);
            const n = perEmployer.get(key) ?? 0;
            if (n >= LIMITS.maxPerEmployer) return false;
            perEmployer.set(key, n + 1);
            return true;
          })
          .slice(0, LIMITS.maxResults);
        funnel.shown = result.scored.length;
        funnel.toVerify = {
          contract: result.scored.filter((s) => s.contract === "onbekend").length,
          werkgever: result.scored.filter((s) => s.employerStatus === "onbekend" || !(names.get(s.job.id) ?? "").trim()).length,
        };
        funnel.channels = await channelStats(dedupedJobs, names, new Set(passing.map((s) => s.job.id)));
        if (funnel.ai) {
          const aiIds = new Set(dedupedJobs.filter((j) => j.source === "openai_web").map((j) => j.id));
          funnel.ai = {
            ...funnel.ai,
            unique: aiIds.size,
            verifiedActive: Array.from(verdicts.entries()).filter(([id, v]) => aiIds.has(id) && v.status === "actief").length,
            aboveThreshold: passing.filter((s) => aiIds.has(s.job.id)).length,
          };
        }
        if (result.scored.length > 0) {
          // De AI-intro komt uit één scoringsbatch; de tekst moet kloppen met wat er echt getoond wordt.
          const top = result.scored[0];
          const topName = names.get(top.job.id) ?? "";
          const toCheck = (funnel.toVerify?.contract ?? 0) + (funnel.toVerify?.werkgever ?? 0);
          result.intro = `${result.scored.length} ${result.scored.length === 1 ? "vacature haalt" : "vacatures halen"} ${threshold / 10}/10 of meer (uit ${dedupedJobs.length} unieke). De sterkste: ${top.job.title}${topName ? ` bij ${topName}` : ""} (${Math.round(top.score / 10)}/10).${toCheck ? " Bij sommige moet je contract of werkgever nog nagaan: zie de labels." : ""}`;
        }
        if (result.scored.length === 0) {
          result.intro = explainNoMatches({ found: funnel.found ?? 0, siteJobs: funnel.siteJobs ?? 0, unique: dedupedJobs.length, checked: toVerify.length, closed, toScoring: shortlist.length, scored: scoredCount, reasons }, threshold);
          result.followups = ["Zoek in een grotere straal", "Zoek met een verwante functietitel"];
        }
        // Contactadres per match (vacaturetekst, vacaturepagina, site van de werkgever), parallel en begrensd.
        state = setStep(state, "score", { status: "running", detail: "contactadressen zoeken" });
        emit({ type: "steps", steps: state.steps });
        const tContacts = Date.now();
        const contacts = fast ? new Map<number, Contact>() : await contactsForJobs(result.scored.map((s) => s.job));
        state = timed(state, "contacts", fast ? 0 : Date.now() - tContacts);
        await db().delete(schema.matches).where(eq(schema.matches.runId, runId));
        if (result.scored.length) {
          await db()
            .insert(schema.matches)
            .values(
              result.scored.map((s, i) => {
                const v = verdicts.get(s.job.id);
                const flags = toVerifyFlags(s, names.get(s.job.id) ?? "", profile);
                const verification = `${v ? `${v.status}: ${v.reason}` : "niet geverifieerd"}${flags.length ? ` | ${flags.join(", ")}` : ""}`;
                const c = contacts.get(s.job.id) ?? null;
                return { runId, jobId: s.job.id, score: s.score, reason: s.reason, argument: s.argument, risk: s.risk, rank: i + 1, verification, contactEmail: c?.email ?? null, contactSource: c?.source ?? null, contactName: c?.name ?? null };
              }),
            );
        }

        if (fast && !aiPhase) {
          // Eerste matches staan er; meteen daarna het AI-zoeken (zoals ChatGPT), dan Deep Search.
          const firstMs = Date.now() - (state.stats?.startedAt ?? run.createdAt.getTime());
          state = setStep(state, "first", { status: "done", detail: `${result.scored.length} matches uit ${dedupedJobs.length} vacatures · na ${Math.round(firstMs / 1000)} s` });
          state = timed(state, "firstResult", firstMs);
          state = timed(state, "scoreFastTotal", Date.now() - tScore);
          state = {
            ...state,
            phase: "ai",
            intro: result.scored.length
              ? `${result.intro} De AI zoekt nu verder op het web; daarna lokale werkgevers en hun websites.`
              : "Nog geen match uit de vacaturebronnen. De AI zoekt nu verder op het web; daarna lokale werkgevers en hun websites.",
            followups: [],
            stats: { ...(state.stats ?? {}), funnel },
          };
          await saveRun(runId, { status: "score", state });
          await addCost(runId, meter);
          emit({ type: "status", status: "score", state });
          return "score";
        }
        if (aiPhase) {
          const ms = Date.now() - (state.stats?.startedAt ?? run.createdAt.getTime());
          state = setStep(state, "ai", { status: "done", detail: `${aiJobIds.size} vacatures via AI-zoeken · ${result.scored.length} matches in totaal · na ${Math.round(ms / 1000)} s` });
          state = timed(state, "aiResult", ms);
          state = {
            ...state,
            phase: "deep",
            intro: result.scored.length
              ? `${result.intro} Ik zoek nu verder bij lokale werkgevers en op hun websites; nieuwe matches komen erbij.`
              : "Nog geen match uit de vacaturebronnen. Ik zoek nu verder bij lokale werkgevers en op hun websites.",
            followups: [],
            stats: { ...(state.stats ?? {}), funnel },
          };
          await saveRun(runId, { status: "discover", state });
          await addCost(runId, meter);
          emit({ type: "status", status: "discover", state });
          return "discover";
        }

        // Werkgevers (spoor B-resultaat): ook zonder passende vacature, strikt feitelijk.
        state = setStep(state, "score", { status: "running", detail: "interessante werkgevers selecteren" });
        emit({ type: "steps", steps: state.steps });
        const matchedCompanyIds = new Set(result.scored.map((s) => s.job.companyId).filter((x): x is number => x !== null));
        const employersRaw = await buildEmployers(profile, state.companyDomains ?? [], matchedCompanyIds, meter).catch(() => []);
        const employers = await withContacts(employersRaw);

        const verifiedActive = result.scored.filter((s) => verdicts.get(s.job.id)?.status === "actief").length;
        state = {
          ...setStep(state, "score", {
            status: "done",
            detail: `${dedupedJobs.length} uniek · ${shortlist.length} naar AI · ${scoredCount} gescoord · ${result.scored.length} passend (≥ ${threshold / 10}/10) · ${verifiedActive} geverifieerd actief`,
          }),
          intro: result.intro,
          followups: result.followups,
          employers,
          stats: {
            ...(state.stats ?? {}),
            uniqueJobs: dedupedJobs.length,
            verifiedActive: funnel.verifiedActive,
            closedOrRejected: dedupedJobs.length - result.scored.length,
            aboveThreshold: passing.length,
            durationMs: Date.now() - (state.stats?.startedAt ?? run.createdAt.getTime()),
            funnel,
          },
        };
        state = timed(state, "scoreTotal", Date.now() - tScore);
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
    const message = redactSecrets(e instanceof Error ? e.message : String(e));
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

const SOURCE_LABEL: Record<string, string> = { google_jobs: "Google Jobs", jooble: "Jooble", adzuna: "Adzuna", google_zoek: "Google-zoekopdrachten", openai_web: "OpenAI Web Search" };

/** Bedrijfsgegevens uit Google Maps bewaren (naam, adres, categorie, coördinaten), zonder crawlstatus te raken. */
async function saveDiscovered(companies: DiscoveredCompany[]): Promise<void> {
  const rows = companies;
  if (!rows.length) return;
  await db()
    .insert(schema.companies)
    .values(rows.map((c) => ({ domain: c.domain, name: c.name ?? null, address: c.address ?? null, category: c.category ?? null, lat: c.lat ?? null, lng: c.lng ?? null, discoveredVia: c.via })))
    .onConflictDoUpdate({
      target: schema.companies.domain,
      set: {
        name: sql`coalesce(excluded.name, ${schema.companies.name})`,
        address: sql`coalesce(excluded.address, ${schema.companies.address})`,
        category: sql`coalesce(excluded.category, ${schema.companies.category})`,
        lat: sql`coalesce(excluded.lat, ${schema.companies.lat})`,
        lng: sql`coalesce(excluded.lng, ${schema.companies.lng})`,
        discoveredVia: sql`coalesce(${schema.companies.discoveredVia}, excluded.discovered_via)`,
      },
    })
    .catch(() => undefined);
}

/** Duur per fase bijhouden (ms). `add` telt op over meerdere stap-aanroepen (crawl). Geen persoonsgegevens. */
function timed(state: RunState, key: string, ms: number, add = false): RunState {
  const t = { ...(state.stats?.timings ?? {}) };
  t[key] = add ? (t[key] ?? 0) + ms : ms;
  return { ...state, stats: { ...(state.stats ?? {}), timings: t } };
}

/**
 * Vacatures uit de eigen index (eerdere runs, < 14 dagen gezien) die op de functietitels lijken en niet
 * bevestigd buiten de straal liggen. Ze gaan door dezelfde verificatie: oud = opnieuw gecontroleerd.
 */
async function indexedCandidates(profile: Profile, max = 60): Promise<Job[]> {
  const words = Array.from(
    new Set([...profile.job_titles, ...(profile.related_titles ?? []), ...(profile.title_variants ?? [])].flatMap((t) => t.toLowerCase().split(/[^a-zà-ÿ0-9]+/)).filter((w) => w.length >= 5)),
  ).slice(0, 8);
  if (!words.length) return [];
  const since = new Date(Date.now() - 14 * 24 * 3600 * 1000);
  const rows = await db()
    .select()
    .from(schema.jobs)
    .where(and(gt(schema.jobs.lastSeenAt, since), sql`(${sql.join(words.map((w) => sql`lower(${schema.jobs.title}) like ${`%${w}%`}`), sql` or `)})`, sql`coalesce(${schema.jobs.verificationStatus}, '') <> 'gesloten'`))
    .limit(300);
  const names = await companyNames(rows);
  const kept = prefilterWithReasons(rows.map((j) => ({ ...j, companyName: names.get(j.id) ?? "" })), profile).kept;
  return kept.filter((j) => withinProfileRadius(j.location, profile) !== false).slice(0, max) as Job[];
}

type PreviewItem = { title: string; company: string; location: string; url: string };

/**
 * Warme start na het profiel: kandidaat-vacatures uit de eigen index. Met een geldige score uit de cache
 * (zelfde profiel, vacaturetekst en scoringsversie) en een recente controle die niet 'gesloten' is,
 * worden ze meteen matches. Geen API- of AI-calls.
 */
async function warmStart(runId: number, profile: Profile): Promise<{ shown: number; preview: PreviewItem[]; ids: number[] }> {
  const candidates = await indexedCandidates(profile, 80);
  if (!candidates.length) return { shown: 0, preview: [], ids: [] };
  const names = await companyNames(candidates);
  const keys = new Map(candidates.map((j) => [j.id, scoreKey(profile, j.contentHash ?? contentHash(j))]));
  const cached = await readCache<RawScore>(Array.from(keys.values()), 14);
  const threshold = await minScore100();
  const ready = candidates
    .map((j) => ({ j, s: cached.get(keys.get(j.id)!), v: freshVerification(j) }))
    .filter((x) => x.s && x.v && x.v.status !== "gesloten")
    .map((x) => {
      const s = x.s!;
      const total = Math.max(0, Math.min(10, s.kerntaken + s.vaardigheden + s.senioriteit + s.sector + s.mobiliteit)) * 10;
      return { ...x, total };
    })
    .filter((x) => x.total >= threshold && x.s!.contract !== "tijdelijk" && x.s!.contract !== "interim" && x.s!.contract !== "freelance" && x.s!.employer_status !== "tussenpersoon")
    .sort((a, b) => b.total - a.total)
    .slice(0, LIMITS.maxResults);
  if (ready.length) {
    await db().delete(schema.matches).where(eq(schema.matches.runId, runId));
    await db()
      .insert(schema.matches)
      .values(
        ready.map((x, i) => ({
          runId,
          jobId: x.j.id,
          score: x.total,
          reason: x.s!.argument,
          argument: x.s!.argument,
          risk: x.s!.risk,
          rank: i + 1,
          verification: `${x.v!.status}: ${x.v!.reason}`,
        })),
      );
  }
  const preview = quickShortlist(profile, candidates, 8).map((j) => ({ title: j.title, company: names.get(j.id) ?? "", location: j.location ?? "", url: j.url }));
  return { shown: ready.length, preview: ready.length ? [] : preview, ids: candidates.map((j) => j.id) };
}

type XrayStats = { planned: number; run: number; hits: Record<string, number> };

/**
 * Boolean X-ray (Deep Search): het AI-zoekplan in twee golven van max 4 zoekopdrachten. De tweede golf geeft voorrang
 * aan intenties die in de eerste golf vacatures opleverden (adaptief, zonder extra AI-call).
 */
async function runXray(profile: Profile, plan: XrayItem[] | null, meter: CostMeter): Promise<{ jobs: NormalizedJob[]; stats: XrayStats }> {
  const items = plan ?? (await buildXrayPlan(profile, meter).catch(() => [] as XrayItem[]));
  const queries = normalizeXray(items, profile);
  if (!queries.length) return { jobs: [], stats: { planned: 0, run: 0, hits: {} } };
  // Golf 1: per intentie de eerste zoekopdracht (breed proeven).
  const firstPerIntent = Array.from(new Map(queries.map((q) => [q.intent, q])).values()).slice(0, 4);
  const w1 = await runWebQueries(firstPerIntent, 4);
  const hits: Record<string, number> = {};
  for (const x of w1.perQuery) hits[x.query.intent] = (hits[x.query.intent] ?? 0) + x.hits;
  const rest = queries.filter((q) => !firstPerIntent.includes(q));
  const w2 = await runWebQueries(orderByYield(rest, hits, 4), 4);
  for (const x of w2.perQuery) hits[x.query.intent] = (hits[x.query.intent] ?? 0) + x.hits;
  return { jobs: [...w1.jobs, ...w2.jobs], stats: { planned: queries.length, run: w1.perQuery.length + w2.perQuery.length, hits } };
}

/** Resultaat van het AI-zoeken (OpenAI Web Search, X-ray, late bronnen) in de run-toestand verwerken. */
function applyAi(state: RunState, ai: Awaited<ReturnType<typeof runAiSearch>>): RunState {
  const f = state.stats?.funnel ?? {};
  let next: RunState = {
    ...state,
    aiDone: true,
    jobIds: [...(state.jobIds ?? []), ...ai.stored.map((j) => j.id)],
    stats: {
      ...(state.stats ?? {}),
      funnel: {
        ...f,
        found: (f.found ?? 0) + ai.result.jobs.length,
        sources: { ...(f.sources ?? {}), openai_web: { queries: ai.result.searches, raw: ai.result.raw, kept: ai.result.jobs.length, error: ai.result.error, skipped: ai.result.skipped } },
        ai: { rounds: ai.result.rounds, searches: ai.result.searches, raw: ai.result.raw, kept: ai.result.jobs.length, costEur: ai.result.costEur, durationMs: ai.result.durationMs, model: ai.result.model, error: ai.result.error, skipped: ai.result.skipped },
        xray: ai.xray,
      },
    },
  };
  next = timed(next, "aiSearch", ai.result.durationMs);
  return next;
}

/** OpenAI Web Search voor Deep Search: resultaten door dezelfde dedup en voorfilter, dan bewaren. */
async function runAiSearch(
  profile: Profile,
  slowSources: string[] = [],
  plan: XrayItem[] | null = null,
  meter: CostMeter = new CostMeter(),
): Promise<{ result: Awaited<ReturnType<typeof searchOpenAIJobs>>; stored: Job[]; xray: XrayStats }> {
  const xrayRun = runXray(profile, plan, meter).catch(() => ({ jobs: [] as NormalizedJob[], stats: { planned: 0, run: 0, hits: {} } as XrayStats }));
  // OpenAI Web Search is de duurste stap (±€ 0,2): zelfde profiel binnen 24 u = resultaat uit de cache.
  const aiKey = `aiweb:${profileFingerprint(profile)}`;
  const aiCached = (await readCache<Awaited<ReturnType<typeof searchOpenAIJobs>>>([aiKey], 1)).get(aiKey);
  if (aiCached) countCall("cache:openai_websearch");
  const [result, ...late] = await Promise.all([
    aiCached ? Promise.resolve({ ...aiCached, costEur: 0, durationMs: 0 }) : searchOpenAIJobs(profile).catch(
      (e: unknown) => ({ jobs: [], rounds: 0, searches: 0, raw: 0, costEur: 0, durationMs: 0, model: null, queries: [], error: redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 120) }) as Awaited<ReturnType<typeof searchOpenAIJobs>>,
    ),
    // Bronnen die in Fast Search te traag waren: nu alsnog, zonder tijdslimiet.
    ...slowSources.map((k) => runSource(k, profile).catch(() => ({ jobs: [] as NormalizedJob[], queries: 0, raw: 0 }))),
  ]);
  if (!aiCached && !result.error && result.jobs.length) await writeCache("aiweb", [{ key: aiKey, value: result }]);
  const xr = await xrayRun;
  const lateJobs = [...late.flatMap((x) => x.jobs), ...xr.jobs];
  const pf = prefilterWithReasons(dedupeJobs([...result.jobs, ...lateJobs]), profile);
  const stored = await upsertJobs(pf.kept).catch(() => [] as Job[]);
  return { result, stored, xray: xr.stats };
}

/** Laat een trage taak niet langer dan `ms` duren. */
/** Contact per vacature; per werkgever onthouden in companies zodat een volgende run het niet opnieuw zoekt. */
async function contactsForJobs(jobsIn: Job[]): Promise<Map<number, Contact>> {
  const ids = Array.from(new Set(jobsIn.map((j) => j.companyId).filter((x): x is number => x !== null)));
  const comps = ids.length ? await db().select().from(schema.companies).where(inArray(schema.companies.id, ids)) : [];
  const byId = new Map(comps.map((c) => [c.id, c]));
  const out = new Map<number, Contact>();
  await Promise.all(
    jobsIn.map(async (j) => {
      const c = j.companyId !== null ? byId.get(j.companyId) : undefined;
      const domain = employerDomainFor(j.url, c?.domain ?? null);
      const found = await withTimeout(findContact({ jobText: j.descriptionText, jobUrl: j.url, employerDomain: domain, careersUrl: c?.jobsUrl }), 15_000).catch(() => null);
      const contact = found ?? (c?.contactEmail ? { email: c.contactEmail, source: c.contactSource ?? "website werkgever", name: c.contactName } : null);
      if (contact) out.set(j.id, contact);
      if (found && c && !c.contactEmail) {
        await db().update(schema.companies).set({ contactEmail: found.email, contactSource: found.source, contactName: found.name ?? null }).where(eq(schema.companies.id, c.id)).catch(() => undefined);
      }
    }),
  );
  return out;
}

async function withContacts(list: EmployerView[]): Promise<EmployerView[]> {
  if (!list.length) return list;
  const comps = await db().select().from(schema.companies).where(inArray(schema.companies.domain, list.map((e) => e.domain)));
  const byDomain = new Map(comps.map((c) => [c.domain, c]));
  return Promise.all(
    list.map(async (e) => {
      const c = byDomain.get(e.domain);
      if (c?.contactEmail) return { ...e, contactEmail: c.contactEmail, contactSource: c.contactSource, contactName: c.contactName };
      const found = await withTimeout(findContact({ employerDomain: e.domain, careersUrl: e.careersUrl }), 15_000).catch(() => null);
      if (found && c) await db().update(schema.companies).set({ contactEmail: found.email, contactSource: found.source, contactName: found.name ?? null }).where(eq(schema.companies.id, c.id)).catch(() => undefined);
      return { ...e, contactEmail: found?.email ?? null, contactSource: found?.source ?? null, contactName: found?.name ?? null };
    }),
  );
}

/**
 * Tweede zoekronde: titels die in ronde 1 niet aan bod kwamen (verwante titels, EN/FR-varianten) en
 * gemeenten verder in de straal. Enkel gratis of goedkope bronnen (Jooble, Adzuna, gerichte Google-vragen).
 */
async function secondRound(profile: Profile): Promise<{ jobs: Job[]; queries: number }> {
  const used = new Set(searchTitles(profile, LIMITS.titlesPerSource).map((t) => t.toLowerCase()));
  const titles = [...(profile.related_titles ?? []), ...(profile.title_variants ?? [])].filter((t) => !used.has(t.toLowerCase())).slice(0, 3);
  const places = searchPlaces(profile, 8).slice(3, 6);
  const alt: Profile = { ...profile, job_titles: titles.length ? titles : profile.job_titles, related_titles: [] };
  const [web, jooble, adzuna] = await Promise.all([
    searchTargetedWeb(profile, { budget: 5, titles: titles.length ? titles : undefined, places: places.length ? [profile.region, ...places] : undefined }).catch(() => null),
    titles.length ? searchJooble(alt).catch(() => null) : null,
    titles.length ? searchAdzuna(alt).catch(() => null) : null,
  ]);
  const all = [...(web?.jobs ?? []), ...(jooble?.jobs ?? []), ...(adzuna?.jobs ?? [])];
  const pf = prefilterWithReasons(dedupeJobs(all), profile);
  const stored = await upsertJobs(pf.kept);
  return { jobs: stored, queries: (web?.queries ?? 0) + (jooble?.queries ?? 0) + (adzuna?.queries ?? 0) };
}

/** Kanaal van een vacature, voor de meting per ontdekkingskanaal. */
export function channelOf(j: { source: string; raw?: unknown }, companyVia: string | null | undefined): string {
  const via = ((j.raw ?? {}) as { via?: string }).via;
  if (j.source === "company_site") return companyVia === "web" ? "werkgeverssites_web" : "lokaal";
  if (j.source === "web" && via === "linkedin") return "linkedin";
  if (j.source === "web" && via === "indeed") return "indeed";
  if (j.source === "vdab") return "vdab";
  if (j.source === "google_jobs") return "google_jobs";
  if (j.source === "web") return "google_zoek";
  if (j.source === "openai_web") return "openai";
  return "jobboards";
}

/** Per kanaal: unieke vacatures, unieke werkgevers en hoeveel er de drempel haalden. */
async function channelStats(jobsIn: Job[], names: Map<number, string>, passingIds: Set<number>): Promise<Record<string, { jobs: number; employers: number; matches: number }>> {
  const ids = Array.from(new Set(jobsIn.map((j) => j.companyId).filter((x): x is number => x !== null)));
  const comps = ids.length ? await db().select({ id: schema.companies.id, via: schema.companies.discoveredVia }).from(schema.companies).where(inArray(schema.companies.id, ids)) : [];
  const viaById = new Map(comps.map((c) => [c.id, c.via]));
  const out: Record<string, { jobs: number; employers: Set<string>; matches: number }> = {};
  for (const j of jobsIn) {
    const ch = channelOf(j, j.companyId !== null ? viaById.get(j.companyId) : null);
    const e = (out[ch] ??= { jobs: 0, employers: new Set(), matches: 0 });
    e.jobs += 1;
    const name = (names.get(j.id) ?? "").toLowerCase().replace(/\b(nv|bv|bvba|sa|srl|cvba)\b/g, "").replace(/[^a-z0-9]/g, "");
    if (name) e.employers.add(name);
    if (passingIds.has(j.id)) e.matches += 1;
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, { jobs: v.jobs, employers: v.employers.size, matches: v.matches }]));
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout na ${Math.round(ms / 1000)} s`)), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

type CrawlOutcome = { domain: string; jobs: Job[]; hadJobs: boolean; braveUsed: boolean; rawCount?: number; error?: string };

/** Stap 4 + 5 voor één domein, met opslag in companies en jobs. */
/**
 * Gekende jobpagina of ATS hergebruiken: niet opnieuw de homepage en tot 18 paden verkennen.
 * Geeft null als het bedrijf (nog) geen bruikbare jobpagina heeft.
 */
async function knownJobsPage(domain: string): Promise<JobsPageResult | null> {
  const c = (await db().select().from(schema.companies).where(eq(schema.companies.domain, domain)).limit(1))[0];
  if (!c?.jobsUrl) return null;
  const name = c.name ?? domain;
  if (c.atsSlug && c.ats !== "unknown" && c.ats !== "none") {
    const adapter = getAdapter(c.ats);
    if (adapter) return { kind: "ats", detection: { adapter, slug: c.atsSlug }, jobsUrl: c.jobsUrl, companyName: name };
  }
  const page = await fetchPage(c.jobsUrl, { allowJina: true });
  if (page.status >= 200 && page.status < 300 && page.text) return { kind: "page", jobsUrl: c.jobsUrl, text: page.text, links: page.links, companyName: name, how: "standard-path" };
  return null;
}

export async function crawlDomain(domain: string, profile: Profile | null, meter: CostMeter, allowBrave: boolean): Promise<CrawlOutcome> {
  // Werkgever uit een officieel register (sector gezet): nooit als tussenpersoon behandelen.
  const trusted = Boolean((await db().select({ sector: schema.companies.sector }).from(schema.companies).where(eq(schema.companies.domain, domain)).limit(1))[0]?.sector);
  const known = await knownJobsPage(domain).catch(() => null);
  if (known) countCall("jobpagina_hergebruikt");
  const found = known ?? (await findJobsPage(domain, meter, { allowBrave, trusted }));
  const base = { domain, name: found.companyName, lastCrawledAt: new Date() };
  let normalized: NormalizedJob[] = [];
  let atsValue: Company["ats"] = "unknown";
  let jobsUrl: string | null = null;
  let notes: string | null = null;
  let braveUsed = false;

  let atsSlug: string | null = null;
  if (found.kind === "ats") {
    atsValue = found.detection.adapter.id;
    atsSlug = found.detection.slug;
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
      .values({ ...base, ats: atsValue, atsSlug, jobsUrl, openJobsCount: normalized.length, notes })
      .onConflictDoUpdate({
        target: schema.companies.domain,
        // De naam uit Google Maps is betrouwbaarder dan de paginatitel: die houden we als ze er al is.
        set: { name: sql`coalesce(${schema.companies.name}, excluded.name)`, ats: atsValue, atsSlug, jobsUrl, lastCrawledAt: base.lastCrawledAt, openJobsCount: normalized.length, notes },
      })
      .returning()
  )[0];

  // Zonder profiel (geplande herinventarisatie): alles bewaren behalve tussenpersonen.
  if (trusted) normalized = normalized.map((j) => ({ ...j, raw: { ...((j.raw as Record<string, unknown>) ?? {}), trustedEmployer: true } }));
  const filtered = profile ? prefilterJobs(normalized, profile) : normalized.filter((j) => trusted || !isIntermediaryCompany(j.companyName, j.url));
  const stored = await upsertJobs(filtered.map((j) => ({ ...j, companyId: company.id })));
  // Vacatures die niet meer op de jobpagina staan: als gesloten markeren in de index (enkel als de pagina wel vacatures gaf).
  if (normalized.length > 0) {
    const seen = new Set(normalized.map((j) => j.url));
    const previous = await db().select({ id: schema.jobs.id, url: schema.jobs.url }).from(schema.jobs).where(and(eq(schema.jobs.companyId, company.id), eq(schema.jobs.source, "company_site")));
    const gone = previous.filter((p) => !seen.has(p.url)).map((p) => p.id);
    if (gone.length) {
      await db()
        .update(schema.jobs)
        .set({ verificationStatus: "gesloten", verificationReason: "niet meer op de jobpagina van de werkgever", verifiedAt: new Date() })
        .where(inArray(schema.jobs.id, gone))
        .catch(() => undefined);
    }
  }
  return { domain, jobs: stored, hadJobs: normalized.length > 0, braveUsed, rawCount: normalized.length };
}

async function recentlyCrawledCompanies(): Promise<Company[]> {
  const since = new Date(Date.now() - LIMITS.cacheTtlDays * 24 * 3600 * 1000);
  // Ook bedrijven met een gewone jobpagina (ats 'unknown') hergebruiken: die werden vroeger elke run opnieuw gecrawld.
  return db().select().from(schema.companies).where(gt(schema.companies.lastCrawledAt, since));
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

