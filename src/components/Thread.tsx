"use client";

import { useState } from "react";
import type { RunView, Profile, StepState, MatchView, EmployerView, RunStats } from "@/lib/pipeline/types";

export function Thread({
  runs,
  pendingUser,
  onFollowup,
  onEditProfile,
  onStart,
}: {
  runs: RunView[];
  pendingUser: { text: string; attachment?: { name: string; size: number } } | null;
  onFollowup: (text: string) => void;
  onEditProfile: (patch: Partial<Profile>) => void;
  onStart?: (runId: number, patch: Partial<Profile>) => Promise<void>;
}) {
  return (
    <div className="space-y-10">
      {runs.map((run, i) => (
        <div key={run.id} className="space-y-6">
          <UserMessage text={run.freeText ?? ""} attachment={run.attachment} />
          <AssistantMessage run={run} isLatest={i === runs.length - 1} onFollowup={onFollowup} onEditProfile={onEditProfile} onStart={onStart} />
        </div>
      ))}
      {pendingUser && (
        <div className="space-y-6">
          <UserMessage text={pendingUser.text} attachment={pendingUser.attachment} />
          <p className="text-sm text-ink-faint">Run wordt gestart…</p>
        </div>
      )}
    </div>
  );
}

function formatSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function UserMessage({ text, attachment }: { text: string; attachment?: { name: string; size: number } }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] space-y-2">
        {attachment && (
          <div className="flex justify-end">
            <span className="inline-flex items-center gap-2 text-sm border border-line rounded-md px-2.5 py-1.5 bg-paper">
              <span className="truncate max-w-[260px]">{attachment.name}</span>
              <span className="text-ink-faint">{formatSize(attachment.size)}</span>
            </span>
          </div>
        )}
        {text && <div className="bg-paper-soft rounded-2xl px-4 py-2.5 text-[15px] whitespace-pre-wrap">{text}</div>}
      </div>
    </div>
  );
}

function AssistantMessage({
  run,
  isLatest,
  onFollowup,
  onEditProfile,
  onStart,
}: {
  run: RunView;
  isLatest: boolean;
  onFollowup: (t: string) => void;
  onEditProfile: (p: Partial<Profile>) => void;
  onStart?: (runId: number, patch: Partial<Profile>) => Promise<void>;
}) {
  const running = run.status !== "done" && run.status !== "failed";
  if (run.state.answer) {
    return <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{run.state.answer}</div>;
  }
  const done = run.status === "done";
  return (
    <div className="space-y-6">
      {run.profile && <CandidateCard profile={run.profile} />}
      {run.profile && run.state.awaitingConfirm && isLatest && onStart ? (
        <SearchFields profile={run.profile} onStart={(patch) => onStart(run.id, patch)} />
      ) : run.profile && !run.state.awaitingConfirm ? (
        <Chips profile={run.profile} editable={isLatest && !running} onEdit={onEditProfile} autoOpen={Boolean(run.state.needsRegion && isLatest)} />
      ) : null}
      {run.state.steps.length > 0 && <Steps steps={run.state.steps} />}
      {run.status === "failed" && <p className="text-sm text-err">De run is gestopt: {run.state.error ?? "onbekende fout"}.</p>}
      {run.state.intro && <p className="text-[15px] leading-relaxed">{run.state.intro}</p>}

      {run.matches.length === 0 && running && (run.state.preview?.length ?? 0) > 0 && (
        <Section title="Eerste kandidaat-vacatures uit de index · nog niet beoordeeld">
          <ul className="divide-y divide-line">
            {run.state.preview!.map((p) => (
              <li key={p.url} className="py-2.5 text-[14px]">
                <a href={p.url} target="_blank" rel="noopener noreferrer" className="font-medium text-navy hover:underline underline-offset-4">
                  {p.title}
                </a>
                <span className="text-ink-soft"> — {[p.company || "werkgever onbekend", p.location].filter(Boolean).join(", ")}</span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {run.matches.length > 0 && (
        <Section title={`${run.matches.length} passende vacatures${running ? " · Deep Search loopt nog" : ""}`} action={<ExportBar run={run} />}>
          <div className="divide-y divide-line">
            {run.matches.map((m) => (
              <ResultCard key={m.jobId} m={m} running={running} />
            ))}
          </div>
        </Section>
      )}

      {done && (run.state.employers?.length ?? 0) > 0 && (
        <Section title={`${run.state.employers!.length} interessante werkgevers`}>
          <p className="text-xs text-ink-faint mt-2">Een bedrijf zonder vacature is een potentiële werkgever, geen bewezen aanwervingskans.</p>
          <div className="divide-y divide-line">
            {run.state.employers!.map((e) => (
              <EmployerCard key={e.domain} e={e} />
            ))}
          </div>
        </Section>
      )}

      {done && run.profile && (run.profile.open_questions?.length ?? 0) > 0 && run.matches.length > 0 && (
        <Section title="Nog na te vragen bij de kandidaat">
          <ol className="list-decimal pl-5 space-y-1 text-[15px]">
            {run.profile.open_questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
        </Section>
      )}

      {done && run.state.stats && <RunSummary stats={run.state.stats} cost={run.costEstimateEur} />}

      {done && run.state.followups && run.state.followups.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {run.state.followups.map((f) => (
            <button key={f} type="button" onClick={() => onFollowup(f)} className="text-sm border border-line rounded-full px-3.5 py-1.5 text-ink-soft hover:border-navy hover:text-navy">
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children, action }: { title: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section>
      <div className="flex items-center justify-between gap-3 mb-1 pb-2 border-b border-line">
        <h3 className="text-[13px] font-semibold text-navy">{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

function EmployerCard({ e }: { e: EmployerView }) {
  const status = e.hasMatchingJob ? "Passende vacature" : e.openJobs > 0 ? `${e.openJobs} open vacature${e.openJobs === 1 ? "" : "s"}, andere functies` : "Geen vacature gevonden · potentiële werkgever";
  const dot = e.hasMatchingJob ? "bg-ok" : e.openJobs > 0 ? "bg-navy" : "bg-ink-faint";
  return (
    <article className="py-5 first:pt-1">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <a href={e.website} target="_blank" rel="noopener noreferrer" className="group text-[16px] font-semibold text-navy">
          <span className="group-hover:underline underline-offset-4 decoration-1">{e.name}</span>
          <span className="ml-1 text-ink-faint group-hover:text-navy" aria-hidden>
            ↗
          </span>
        </a>
        <span className="text-sm text-ink-soft">{[e.municipality, e.distanceKm !== null ? `${e.distanceKm} km` : null].filter(Boolean).join(" · ")}</span>
      </div>
      {e.activity && <div className="mt-0.5 text-sm text-ink-soft">{e.activity}</div>}
      {e.why && <p className="mt-2 text-[14.5px] leading-relaxed">{e.why}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
        <span className="inline-flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${dot}`} aria-hidden />
          {status}
        </span>
        {e.signal && <span>{e.signal}</span>}
        {e.careersUrl && (
          <a href={e.careersUrl} target="_blank" rel="noopener noreferrer" className="text-navy hover:underline underline-offset-4">
            Jobpagina ↗
          </a>
        )}
      </div>
      <ContactLine email={e.contactEmail ?? null} name={e.contactName ?? null} source={e.contactSource ?? null} subject={`Kandidaat voor ${e.name}`} />
    </article>
  );
}

/** Contactadres om de kandidaat voor te stellen: klikbaar (mail) en kopieerbaar, met de vindplaats. */
/** Contactpersoon en mailadres om de kandidaat voor te stellen: klikbaar en kopieerbaar. */
/** Contactpersoon en mailadres om de kandidaat voor te stellen: klikbaar en kopieerbaar. */
function ContactLine({ email, name, source, subject, pending = false }: { email: string | null; name?: string | null; source: string | null; subject: string; pending?: boolean }) {
  const [copied, setCopied] = useState(false);
  if (!email && pending) return <div className="mt-1.5 text-[13px] text-ink-faint">Contact: wordt gezocht zodra Deep Search klaar is</div>;
  if (!email) return <div className="mt-1.5 text-[13px] text-ink-faint">Contact: geen mailadres op de vacature of de website</div>;
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-2 text-[13.5px]" title={source ? `gevonden op: ${source}` : undefined}>
      <span className="text-ink-soft">Contact:</span>
      {name && <span className="text-ink">{name} ·</span>}
      <a href={`mailto:${email}?subject=${encodeURIComponent(subject)}`} className="text-navy underline underline-offset-4 decoration-gold decoration-2 break-all">
        {email}
      </a>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(email).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="text-[12px] text-ink-faint hover:text-navy"
      >
        {copied ? "gekopieerd" : "kopieer"}
      </button>
    </div>
  );
}

const CALL_LABEL: Record<string, string> = {
  openai: "OpenAI",
  claude: "Claude",
  serper: "Google (Serper)",
  serper_maps: "Google Maps",
  google_jobs: "Google Jobs",
  openai_websearch: "OpenAI Web Search",
  jooble: "Jooble",
  adzuna: "Adzuna",
  linkup: "Linkup",
  tavily: "Tavily",
  exa: "Exa",
  brave: "Brave",
  jina: "Jina",
  firecrawl: "Firecrawl",
};

const FUNNEL_SOURCE: Record<string, string> = {
  google_jobs: "Google Jobs",
  jooble: "Jooble",
  adzuna: "Adzuna",
  google_zoek: "Google-zoekopdrachten",
  openai_web: "OpenAI Web Search",
};

/** Alle matches (en werkgevers) in één klik: kopiëren als tekst of downloaden als CSV voor Excel. */
function ExportBar({ run }: { run: RunView }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-3 text-[12.5px]">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(matchesAsText(run)).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1800);
          });
        }}
        className="text-ink-soft hover:text-navy"
      >
        {copied ? "✓ Gekopieerd" : "Kopieer alles"}
      </button>
      <button type="button" onClick={() => downloadCsv(run)} className="text-ink-soft hover:text-navy">
        Exporteer (Excel)
      </button>
    </div>
  );
}

export function matchesAsText(run: Pick<RunView, "candidateName" | "profile" | "matches" | "state">): string {
  const head = `${run.candidateName ?? "Kandidaat"}${run.profile ? ` — ${run.profile.job_titles[0]}, ${run.profile.region} (${run.profile.radius_km} km)` : ""}`;
  const jobs = run.matches.map((m, i) =>
    [
      `${i + 1}. ${m.title} — ${m.company || "werkgever onbekend"}${m.location ? `, ${m.location}` : ""} (${Math.round(m.score / 10)}/10)`,
      `   Match: ${m.argument || m.reason}`,
      m.risk ? `   Risico: ${m.risk}` : null,
      `   Contact: ${m.contactEmail ? `${m.contactName ? `${m.contactName}, ` : ""}${m.contactEmail}` : "niet gevonden"}`,
      `   Vacature: ${m.url}`,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  const emps = (run.state.employers ?? []).map((e) => `- ${e.name}${e.municipality ? `, ${e.municipality}` : ""} · ${e.website}${e.contactEmail ? ` · ${e.contactName ? `${e.contactName}, ` : ""}${e.contactEmail}` : ""}`);
  return [head, "", "Vacatures", ...jobs, ...(emps.length ? ["", "Interessante werkgevers (geen bewezen vacature)", ...emps] : [])].join("\n");
}

function downloadCsv(run: RunView) {
  const cell = (v: string | number | null | undefined) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [
    ["Score", "Functie", "Werkgever", "Locatie", "Waarom match", "Risico", "Contactpersoon", "E-mail", "Vacaturelink", "Verificatie"],
    ...run.matches.map((m) => [Math.round(m.score / 10), m.title, m.company, m.location, m.argument || m.reason, m.risk, m.contactName, m.contactEmail, m.url, m.verification]),
  ];
  // Puntkomma en BOM: opent correct in een Belgische Excel.
  const csv = "\ufeff" + rows.map((r) => r.map(cell).join(";")).join("\r\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `matchr-${(run.candidateName ?? "kandidaat").toLowerCase().replace(/[^a-z0-9]+/g, "-")}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const CHANNEL_LABEL: Record<string, string> = {
  lokaal: "Lokale KMO-ontdekking (Google Maps)",
  werkgeverssites_web: "Werkgeverssites (via web gevonden)",
  linkedin: "LinkedIn (zoekresultaten)",
  indeed: "Indeed (zoekresultaten)",
  vdab: "VDAB",
  google_jobs: "Google Jobs",
  google_zoek: "Google-zoekopdrachten (ATS, eigen sites)",
  openai: "OpenAI Web Search",
  jobboards: "Jooble en Adzuna",
};

const REASON_TEXT: Record<string, string> = {
  onder_drempel: "onder de matchdrempel",
  contract_tijdelijk: "tijdelijk, interim of freelance",
  tussenpersoon: "tussenpersoon",
  buiten_straal: "buiten de straal",
  harde_eis: "harde eis niet gehaald",
};

function Row({ k, v }: { k: string; v: string | number | undefined }) {
  if (v === undefined) return null;
  return (
    <div className="flex justify-between gap-4">
      <span className="text-ink-soft">{k}</span>
      <span className="mono">{v}</span>
    </div>
  );
}

function RunSummary({ stats, cost }: { stats: RunStats; cost: number }) {
  const calls = Object.entries(stats.apiCalls ?? {}).sort((a, b) => b[1] - a[1]);
  const secs = Math.round((stats.durationMs ?? 0) / 1000);
  const f = stats.funnel;
  const pf = f?.prefilter;
  const sc = f?.scoring;
  return (
    <details className="text-sm">
      <summary className="cursor-pointer list-none text-[13px] text-ink-faint hover:text-navy">
        Run-overzicht en diagnose{stats.failures?.length ? <span className="ml-2 text-warn">· {stats.failures.length} bron(nen) met problemen</span> : null}
      </summary>

      {f?.sources && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ink-faint mb-1">Per bron</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-ink-faint text-left">
                  <th className="font-normal py-1 pr-3">Bron</th>
                  <th className="font-normal py-1 pr-3 text-right">Zoekopdrachten</th>
                  <th className="font-normal py-1 pr-3 text-right">Ruw</th>
                  <th className="font-normal py-1 pr-3 text-right">Bruikbaar</th>
                  <th className="font-normal py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(f.sources).map(([k, s]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1 pr-3">{FUNNEL_SOURCE[k] ?? k}</td>
                    <td className="py-1 pr-3 text-right mono">{s.queries}</td>
                    <td className="py-1 pr-3 text-right mono">{s.raw}</td>
                    <td className="py-1 pr-3 text-right mono">{s.kept}</td>
                    <td className={`py-1 ${s.error ? "text-warn" : "text-ink-soft"}`}>{s.error ?? s.skipped ?? "ok"}</td>
                  </tr>
                ))}
                {f.siteJobs !== undefined && (
                  <tr className="border-t border-line">
                    <td className="py-1 pr-3">Bedrijfssites en ATS-feeds</td>
                    <td className="py-1 pr-3 text-right mono">{stats.employersExamined ?? 0} sites</td>
                    <td className="py-1 pr-3 text-right mono">—</td>
                    <td className="py-1 pr-3 text-right mono">{f.siteJobs}</td>
                    <td className="py-1 text-ink-soft">ok</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {f && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ink-faint mb-1">Per fase</div>
          <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
            <Row k="Gevonden (jobboards, zoekmachines, AI)" v={f.found} />
            <Row k="Gevonden op bedrijfssites" v={f.siteJobs} />
            <Row k="Dubbels verwijderd" v={f.duplicates} />
            <Row k="Weg: locatie" v={pf?.regio} />
            <Row k="Weg: tussenpersoon (bevestigd)" v={pf?.tussenpersoon} />
            <Row k="Weg: uitsluiting in de titel" v={pf?.uitsluiting} />
            <Row k="Uniek en bruikbaar" v={f.unique} />
            <Row k="Na voorselectie" v={f.preselect ? `${f.preselect.output}${f.preselect.filled ? ` (${f.preselect.filled} aangevuld)` : ""}` : undefined} />
            <Row k="Gecontroleerd op de pagina" v={f.checked} />
            <Row k="Waarvan actief bevestigd" v={f.verifiedActive} />
            <Row k="Waarvan gesloten" v={f.closed} />
            <Row k="Naar AI-scoring" v={f.toScoring} />
            <Row k="Effectief gescoord" v={sc ? `${sc.scored}${sc.missing ? ` (${sc.missing} zonder score)` : ""}` : undefined} />
            <Row k="Score ≥ drempel" v={f.aboveThreshold} />
            {f.reasons &&
              Object.entries(f.reasons)
                .filter(([, n]) => n > 0)
                .map(([k, n]) => <Row key={k} k={`Afgewezen: ${REASON_TEXT[k] ?? k}`} v={n} />)}
            <Row k="Getoond" v={f.shown} />
            <Row k="Waarvan contract te verifiëren" v={f.toVerify?.contract} />
            <Row k="Waarvan werkgever te verifiëren" v={f.toVerify?.werkgever} />
          </div>
        </div>
      )}

      {f?.channels && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ink-faint mb-1">Per ontdekkingskanaal</div>
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink-faint text-left">
                <th className="font-normal py-1 pr-3">Kanaal</th>
                <th className="font-normal py-1 pr-3 text-right">Unieke vacatures</th>
                <th className="font-normal py-1 pr-3 text-right">Werkgevers</th>
                <th className="font-normal py-1 text-right">Passend</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(f.channels)
                .sort((a, b) => b[1].jobs - a[1].jobs)
                .map(([k, c]) => (
                  <tr key={k} className="border-t border-line">
                    <td className="py-1 pr-3">{CHANNEL_LABEL[k] ?? k}</td>
                    <td className="py-1 pr-3 text-right mono">{c.jobs}</td>
                    <td className="py-1 pr-3 text-right mono">{c.employers}</td>
                    <td className="py-1 text-right mono">{c.matches}</td>
                  </tr>
                ))}
            </tbody>
          </table>
          {f.local && (
            <p className="mt-1 text-xs text-ink-faint">
              Lokaal: {f.local.mapsQueries} Google Maps-vragen over {f.local.municipalities} gemeenten, {f.local.fromLocalDb} bedrijven uit eerdere runs hergebruikt, {f.local.companies} werkgevers onderzocht.
            </p>
          )}
        </div>
      )}

      {f?.ai && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ink-faint mb-1">OpenAI Web Search</div>
          {f.ai.skipped ? (
            <div className="text-ink-soft">Niet gebruikt: {f.ai.skipped}.</div>
          ) : (
            <div className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              <Row k="Model" v={f.ai.model ?? undefined} />
              <Row k="Zoekrondes" v={f.ai.rounds} />
              <Row k="Webzoekopdrachten" v={f.ai.searches} />
              <Row k="Vacatures opgeleverd" v={f.ai.kept} />
              <Row k="Uniek na samenvoegen" v={f.ai.unique} />
              <Row k="Geverifieerd actief" v={f.ai.verifiedActive} />
              <Row k="Passend (≥ drempel)" v={f.ai.aboveThreshold} />
              <Row k="Duur" v={`${Math.round(f.ai.durationMs / 1000)} s`} />
              <Row k="Geschatte kost" v={`€ ${f.ai.costEur.toFixed(3)}`} />
              {f.ai.error ? <div className="text-warn sm:col-span-2">Fout: {f.ai.error}</div> : null}
            </div>
          )}
        </div>
      )}

      <div className="mt-3 grid gap-x-6 gap-y-1 sm:grid-cols-2">
        {!f && <Row k="Ruwe vacatures gevonden" v={stats.rawJobs} />}
        {!f && <Row k="Unieke vacatures" v={stats.uniqueJobs} />}
        <Row k="Werkgevers onderzocht" v={stats.employersExamined} />
        <Row k="Eerste matches na" v={stats.timings?.firstResult ? `${Math.round(stats.timings.firstResult / 1000)} s` : undefined} />
        <Row k="Uitvoeringstijd" v={secs ? `${Math.floor(secs / 60)} min ${secs % 60} s` : undefined} />
        <Row k="Geschatte AI-kost (totaal)" v={cost ? `€ ${cost.toFixed(3)}` : "€ 0"} />
      </div>
      {stats.timings && Object.keys(stats.timings).length > 0 && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ink-faint mb-1">Duur per fase</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.timings)
              .filter(([, ms]) => ms > 0)
              .map(([k, ms]) => (
                <span key={k} className="mono text-xs rounded-full px-2 py-0.5 bg-paper-soft">
                  {k} {(ms / 1000).toFixed(1)} s
                </span>
              ))}
          </div>
        </div>
      )}
      {stats.apiTimings && Object.keys(stats.apiTimings).length > 0 && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ink-faint mb-1">Aanroepen: aantal · gemiddeld · traagste</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.apiTimings)
              .sort((a, b) => b[1].ms - a[1].ms)
              .map(([k, t]) => (
                <span key={k} className="mono text-xs rounded-full px-2 py-0.5 bg-paper-soft">
                  {k} {t.n}× · {(t.ms / t.n / 1000).toFixed(1)} s · {(t.max / 1000).toFixed(1)} s
                </span>
              ))}
          </div>
        </div>
      )}
      {calls.length > 0 && (
        <div className="mt-3">
          <div className="text-xs uppercase tracking-wide text-ink-faint mb-1">API-aanroepen per bron</div>
          <div className="flex flex-wrap gap-2">
            {calls.map(([k, n]) => (
              <span key={k} className="mono text-xs rounded-full px-2 py-0.5 bg-paper-soft">
                {CALL_LABEL[k] ?? k} {n}
              </span>
            ))}
          </div>
        </div>
      )}
      {stats.failures && stats.failures.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-warn">
          {stats.failures.map((x) => (
            <li key={x}>— {x}</li>
          ))}
        </ul>
      )}
    </details>
  );
}

function CandidateCard({ profile }: { profile: Profile }) {
  const lines = profile.positioning ?? [];
  const unsure = profile.uncertainties ?? [];
  if (!lines.length) return null;
  return (
    <Section title="Kandidaat">
      <div className="pt-3 space-y-1.5">
        {lines.map((l) => (
          <p key={l} className="text-[15px] leading-relaxed">
            {l}
          </p>
        ))}
        {unsure.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {unsure.map((u) => (
              <span key={u} className="text-xs text-ink-soft">
                {u}
              </span>
            ))}
          </div>
        )}
      </div>
    </Section>
  );
}

function Chips({ profile, editable, onEdit, autoOpen = false }: { profile: Profile; editable: boolean; onEdit: (p: Partial<Profile>) => void; autoOpen?: boolean }) {
  const [editing, setEditing] = useState(autoOpen);
  const [regionError, setRegionError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; region: string; radius: string; exclusions: string; years: string }>({
    title: profile.job_titles.join(", "),
    region: profile.region,
    radius: String(profile.radius_km),
    exclusions: profile.exclusions.join(", "),
    years: String(profile.years_experience),
  });
  const chips: { label: string; value: string }[] = [
    { label: "Functie", value: profile.job_titles.slice(0, 2).join(" / ") },
    { label: "Regio", value: profile.region ? `${profile.region} · ${profile.radius_km} km` : "onbekend" },
    { label: "Ervaring", value: `${profile.years_experience} jaar` },
    { label: "Uitsluiten", value: profile.exclusions.length ? profile.exclusions.join(", ") : "niets" },
  ];
  function save() {
    const split = (s: string) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
    if (!draft.region.trim() || /^(vlaanderen|belgi[eë]|belgium)$/i.test(draft.region.trim())) {
      setRegionError("Vul een gemeente in, bv. Mechelen.");
      return;
    }
    setRegionError(null);
    const titles = split(draft.title);
    const radius = Math.min(150, Math.max(5, Number(draft.radius) || profile.radius_km));
    onEdit({
      job_titles: titles.length ? titles : profile.job_titles,
      region: draft.region.trim() || profile.region,
      radius_km: radius,
      exclusions: split(draft.exclusions),
      years_experience: Number(draft.years) || profile.years_experience,
    });
    setEditing(false);
  }
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {chips.map((c) => (
          <button key={c.label} type="button" disabled={!editable} onClick={() => setEditing(true)} className="text-sm border border-line rounded-full px-3 py-1 bg-paper hover:border-accent disabled:hover:border-line disabled:cursor-default">
            <span className="text-ink-faint">{c.label} </span>
            <span>{c.value}</span>
          </button>
        ))}
        {editable && (
          <button type="button" onClick={() => setEditing((e) => !e)} className="text-sm rounded-full px-3 py-1 text-accent border border-accent-soft bg-accent-soft">
            Aanpassen
          </button>
        )}
      </div>
      {editing && (
        <div className="mt-3 border border-line rounded-xl p-4 grid gap-3 sm:grid-cols-2">
          <Field label="Functietitels (komma's)" value={draft.title} onChange={(v) => setDraft({ ...draft, title: v })} />
          <div>
            <Field label="Regio (gemeente)" value={draft.region} onChange={(v) => setDraft({ ...draft, region: v })} />
            {regionError && <p className="mt-1 text-xs text-red-700">{regionError}</p>}
          </div>
          <Field label="Straal (km)" value={draft.radius} onChange={(v) => setDraft({ ...draft, radius: v })} />
          <Field label="Ervaring (jaren)" value={draft.years} onChange={(v) => setDraft({ ...draft, years: v })} />
          <Field label="Uitsluiten (komma's)" value={draft.exclusions} onChange={(v) => setDraft({ ...draft, exclusions: v })} />
          <div className="flex items-end gap-2">
            <button type="button" onClick={save} className="bg-accent text-white rounded-md px-3 py-2 text-sm">
              Opnieuw zoeken
            </button>
            <button type="button" onClick={() => setEditing(false)} className="border border-line rounded-md px-3 py-2 text-sm">
              Annuleren
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Wat uit het cv gehaald werd, als aanpasbare zoekvelden. De zoektocht start pas na "Start zoektocht". */
function SearchFields({ profile, onStart }: { profile: Profile; onStart: (patch: Partial<Profile>) => Promise<void> }) {
  const j = (xs: string[] | undefined) => (xs ?? []).join(", ");
  const [f, setF] = useState({
    titles: j(profile.job_titles),
    related: j(profile.related_titles),
    variants: j(profile.title_variants),
    region: profile.region,
    radius: String(profile.radius_km),
    years: String(profile.years_experience),
    skills: j(profile.skills),
    keywords: j(profile.skill_keywords),
    sectors: j(profile.sectors),
    companyTypes: j(profile.company_types),
    exclusions: j(profile.exclusions),
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const split = (s: string) =>
    s
      .split(/[,;\n]/)
      .map((x) => x.trim())
      .filter(Boolean);
  async function start() {
    if (!f.region.trim() || /^(vlaanderen|belgi[eë]|belgium|wallonie)$/i.test(f.region.trim())) {
      setError("Vul een gemeente in als regio, bv. Mechelen.");
      return;
    }
    if (!split(f.titles).length) {
      setError("Vul minstens één functietitel in.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onStart({
        job_titles: split(f.titles),
        related_titles: split(f.related),
        title_variants: split(f.variants),
        region: f.region.trim(),
        radius_km: Number(f.radius) || profile.radius_km,
        years_experience: Number(f.years) || 0,
        skills: split(f.skills),
        skill_keywords: split(f.keywords),
        sectors: split(f.sectors),
        company_types: split(f.companyTypes),
        exclusions: split(f.exclusions),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  return (
    <Section title="Zoekvelden · uit het cv gehaald, pas aan waar nodig">
      <div className="pt-3 grid gap-x-4 gap-y-3 sm:grid-cols-2">
        <Field label="Functietitels" value={f.titles} onChange={set("titles")} />
        <Field label="Verwante functies" value={f.related} onChange={set("related")} />
        <Field label="Ook zoeken als (EN/FR)" value={f.variants} onChange={set("variants")} />
        <div className="grid grid-cols-[1fr_90px_90px] gap-3">
          <Field label="Regio (gemeente)" value={f.region} onChange={set("region")} />
          <Field label="Straal km" value={f.radius} onChange={set("radius")} />
          <Field label="Jaren" value={f.years} onChange={set("years")} />
        </div>
        <Field label="Vaardigheden" value={f.skills} onChange={set("skills")} />
        <Field label="Kerntaken" value={f.keywords} onChange={set("keywords")} />
        <Field label="Sectoren" value={f.sectors} onChange={set("sectors")} />
        <Field label="Soorten werkgevers" value={f.companyTypes} onChange={set("companyTypes")} />
        <Field label="Uitsluiten" value={f.exclusions} onChange={set("exclusions")} />
      </div>
      <p className="mt-2 text-xs text-ink-faint">Meerdere waarden scheiden met een komma.</p>
      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={start} disabled={busy} className="rounded-lg px-4 py-2 text-sm font-medium bg-navy text-white hover:bg-navy-2 disabled:opacity-50">
          {busy ? "Zoektocht start…" : "Start zoektocht"}
        </button>
        {error && <span className="text-sm text-err">{error}</span>}
      </div>
    </Section>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="block text-ink-soft mb-1">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-line rounded-md px-2.5 py-1.5 focus:outline-none focus:border-accent" />
    </label>
  );
}

function Steps({ steps }: { steps: StepState[] }) {
  const glyph: Record<StepState["status"], string> = { done: "✓", running: "●", waiting: "·", skipped: "–", error: "!" };
  const colour: Record<StepState["status"], string> = { done: "text-ink-faint", running: "text-gold", waiting: "text-ink-faint", skipped: "text-ink-faint", error: "text-err" };
  const finished = steps.every((s) => s.status === "done" || s.status === "skipped");
  const list = (
    <ol className="text-[13px] space-y-1.5 text-ink-soft">
      {steps.map((s) => (
        <li key={s.key} className="flex gap-2.5">
          <span className={`${colour[s.status]} w-3 shrink-0 text-center ${s.status === "running" ? "pulse" : ""}`}>{glyph[s.status]}</span>
          <span className={s.status === "running" ? "text-navy" : ""}>
            {s.label}
            {s.detail ? <span className="text-ink-faint"> — {s.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
  if (!finished) return list;
  return (
    <details className="group text-[13px]">
      <summary className="cursor-pointer list-none text-ink-faint hover:text-navy">
        <span className="group-open:hidden">Toon hoe Matchr zocht ({steps.length} stappen)</span>
        <span className="hidden group-open:inline">Verberg stappen</span>
      </summary>
      <div className="mt-2">{list}</div>
    </details>
  );
}




function ResultCard({ m, running = false }: { m: MatchView; running?: boolean }) {
  const score10 = Math.round(m.score / 10);
  return (
    <article className="py-4 first:pt-2">
      <div className="flex items-baseline gap-4">
        <div className="min-w-0 flex-1">
          <a href={m.url} target="_blank" rel="noopener noreferrer" className="group text-[15.5px] font-semibold leading-snug text-navy">
            <span className="group-hover:underline underline-offset-4 decoration-1">{m.title}</span>
            <span className="ml-1 text-ink-faint group-hover:text-navy" aria-hidden>
              ↗
            </span>
          </a>
          <span className="text-[14px] text-ink-soft"> — {[m.company || "werkgever onbekend", m.location].filter(Boolean).join(", ")}</span>
        </div>
        <span className="shrink-0 tabular-nums text-[15px] font-semibold text-navy">
          {score10}
          <span className="text-xs font-normal text-ink-faint">/10</span>
        </span>
      </div>
      <p className="mt-1.5 text-[14px] leading-relaxed text-ink">{m.argument || m.reason}</p>
      <ContactLine email={m.contactEmail} name={m.contactName} source={m.contactSource} subject={`Kandidaat voor uw vacature ${m.title}`} pending={running} />
      <MetaLine m={m} />
    </article>
  );
}

/** Eén stille regel: verificatie en wat nog na te gaan is. Risico en bron staan in de export. */
function MetaLine({ m }: { m: MatchView }) {
  const [main, flagPart] = (m.verification || "niet geverifieerd").split(" | ");
  const active = main.startsWith("actief");
  const flags = (flagPart ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 text-[12px] text-ink-faint">
      <span className="inline-flex items-center gap-1.5" title={main.split(":").slice(1).join(":").trim() || undefined}>
        <span className={`w-1.5 h-1.5 rounded-full ${active ? "bg-ok" : "bg-gold"}`} aria-hidden />
        {active ? "open bevestigd" : "niet geverifieerd"}
      </span>
      {flags.map((f) => (
        <span key={f} className="text-warn">
          {f}
        </span>
      ))}
    </div>
  );
}

