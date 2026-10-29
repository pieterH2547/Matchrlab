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
import { buildProfile, isVagueRegion } from "./profile";
import { searchJobboards } from "./jobboards";
import { discoverCompanies, type DiscoveredCompany } from "./discover";
import { verifyMany } from "./verify";
import { buildEmployers } from "./employers";
import { withUsage, mergeCalls } from "@/lib/usage";
import { minScore100 } from "@/lib/settings";
import { findJobsPage } from "./findJobsPage";
import { extractFromAts, extractFromPage } from "./extract";
import { preselect, scoreJobs } from "./score";
import { prefilterJobs, prefilterWithReasons, upsertJobs, loadJobs, dedupeJobs } from "./jobstore";
import { applyHardFilters, explainNoMatches, toVerifyFlags } from "./filters";
import { findContact, employerDomainFor, type Contact } from "./contact";
import type { Funnel } from "./types";
import { redactSecrets } from "@/lib/redact";
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
  const { result, usage } = await withUsage(() => advanceRunInner(runId, emit));
  // API-aanroepen per bron en mislukte bronnen bijschrijven in het run-overzicht.
  if (Object.keys(usage.calls).length || usage.failures.length) {
    const row = (await db().select().from(schema.runs).where(eq(schema.runs.id, runId)).limit(1))[0];
    if (row) {
      const st = row.state ?? { steps: [] };
      const stats = st.stats ?? {};
      st.stats = {
        ...stats,
        apiCalls: mergeCalls(stats.apiCalls, usage.calls),
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
        state = setStep(state, "profile", { status: "running", detail: "cv en opdracht lezen" });
        emit({ type: "steps", steps: state.steps });
        const profile = await buildProfile({ cvText: run.cvText ?? "", freeText: run.freeText ?? "", previousProfile: run.profile }, meter);
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
        state = setStep(state, "jobboards", { status: "running", detail: "Google Jobs, Jooble, Adzuna, gerichte Google-zoekopdrachten en OpenAI Web Search" });
        emit({ type: "steps", steps: state.steps });
        // Spoor B (werkgevers via Google Maps) loopt tegelijk mee: wacht niet op de vacaturebronnen.
        state = setStep(state, "discover", { status: "running", detail: "loopt mee met de vacaturebronnen" });
        emit({ type: "steps", steps: state.steps });
        const remainingBraveB = Math.max(0, LIMITS.braveQueriesPerRun - (state.braveQueriesUsed ?? 0));
        const [boards, prefetched] = await Promise.all([
          searchJobboards(profile),
          discoverCompanies(profile, meter, { maxQueries: Math.min(8, remainingBraveB) }).catch(() => null),
        ]);
        if (prefetched) state.prefetchedDiscovery = prefetched;
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
          jobIds: [...(state.jobIds ?? []), ...stored.map((j) => j.id)],
          boardJobsFound: stored.length,
          braveQueriesUsed: (state.braveQueriesUsed ?? 0) + boards.braveQueries,
        };
        await saveRun(runId, { status: "discover", state });
        await addCost(runId, meter);
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
        const next: Run["status"] = toCrawl.length ? "crawl" : "score";
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
        // Pool: tot crawlConcurrency bedrijven tegelijk; na het tijdsbudget starten we geen nieuwe meer.
        let cursor = 0;
        const worker = async () => {
          while (cursor < todo.length && Date.now() - started < LIMITS.stepTimeBudgetMs) {
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
        state = setStep(state, "score", { status: "running", detail: "dubbels samenvoegen" });
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
        const shortlistRaw = await preselect(profile, dedupedJobs, names, meter, preInfo);
        funnel.preselect = preInfo;

        // Verificatie vóór de eindscoring: gesloten vacatures vallen weg, de rest krijgt een status.
        state = setStep(state, "score", { status: "running", detail: `${dedupedJobs.length} uniek · ${shortlistRaw.length} controleren of ze nog open zijn` });
        emit({ type: "steps", steps: state.steps });
        const toVerify = shortlistRaw.slice(0, LIMITS.maxVerifyPerRun);
        const verdicts = await verifyMany(toVerify);
        const shortlist = toVerify.filter((j) => verdicts.get(j.id)?.status !== "gesloten");
        const closed = toVerify.length - shortlist.length;
        funnel.checked = toVerify.length;
        funnel.closed = closed;
        funnel.verifiedActive = Array.from(verdicts.values()).filter((v) => v.status === "actief").length;
        funnel.toScoring = shortlist.length;

        state = setStep(state, "score", { status: "running", detail: `${dedupedJobs.length} uniek · ${closed} gesloten · ${shortlist.length} naar eindscoring` });
        emit({ type: "steps", steps: state.steps });
        const scoreInfo = { requested: 0, scored: 0, missing: 0, batches: 0, failedBatches: 0 };
        const result = await scoreJobs(profile, shortlist, names, meter, scoreInfo);
        funnel.scoring = scoreInfo;
        const threshold = await minScore100();
        // Harde zeef: tijdelijk/interim, bevestigde tussenpersoon, buiten straal, harde eis, onder de drempel.
        // Onbekend contract of onbekende werkgever blijft, met het label 'te verifiëren'.
        const scoredCount = result.scored.length;
        const { kept: passing, reasons } = applyHardFilters(result.scored, names, profile, threshold);
        funnel.reasons = reasons;
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
        const contacts = await contactsForJobs(result.scored.map((s) => s.job));
        await db().delete(schema.matches).where(eq(schema.matches.runId, runId));
        if (result.scored.length) {
          await db()
            .insert(schema.matches)
            .values(
              result.scored.map((s, i) => {
                const v = verdicts.get(s.job.id);
                const flags = toVerifyFlags(s, names.get(s.job.id) ?? "");
                const verification = `${v ? `${v.status}: ${v.reason}` : "niet geverifieerd"}${flags.length ? ` | ${flags.join(", ")}` : ""}`;
                const c = contacts.get(s.job.id) ?? null;
                return { runId, jobId: s.job.id, score: s.score, reason: s.reason, argument: s.argument, risk: s.risk, rank: i + 1, verification, contactEmail: c?.email ?? null, contactSource: c?.source ?? null };
              }),
            );
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
      const contact = found ?? (c?.contactEmail ? { email: c.contactEmail, source: c.contactSource ?? "website werkgever" } : null);
      if (contact) out.set(j.id, contact);
      if (found && c && !c.contactEmail) {
        await db().update(schema.companies).set({ contactEmail: found.email, contactSource: found.source }).where(eq(schema.companies.id, c.id)).catch(() => undefined);
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
      if (c?.contactEmail) return { ...e, contactEmail: c.contactEmail, contactSource: c.contactSource };
      const found = await withTimeout(findContact({ employerDomain: e.domain, careersUrl: e.careersUrl }), 15_000).catch(() => null);
      if (found && c) await db().update(schema.companies).set({ contactEmail: found.email, contactSource: found.source }).where(eq(schema.companies.id, c.id)).catch(() => undefined);
      return { ...e, contactEmail: found?.email ?? null, contactSource: found?.source ?? null };
    }),
  );
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
        // De naam uit Google Maps is betrouwbaarder dan de paginatitel: die houden we als ze er al is.
        set: { name: sql`coalesce(${schema.companies.name}, excluded.name)`, ats: atsValue, jobsUrl, lastCrawledAt: base.lastCrawledAt, openJobsCount: normalized.length, notes },
      })
      .returning()
  )[0];

  const filtered = prefilterJobs(normalized, profile);
  const stored = await upsertJobs(filtered.map((j) => ({ ...j, companyId: company.id })));
  return { domain, jobs: stored, hadJobs: normalized.length > 0, braveUsed, rawCount: normalized.length };
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

