"use client";

import { useState } from "react";
import type { RunView, Profile, StepState, MatchView, EmployerView, RunStats } from "@/lib/pipeline/types";

export function Thread({
  runs,
  pendingUser,
  onFollowup,
  onEditProfile,
}: {
  runs: RunView[];
  pendingUser: { text: string; attachment?: { name: string; size: number } } | null;
  onFollowup: (text: string) => void;
  onEditProfile: (patch: Partial<Profile>) => void;
}) {
  return (
    <div className="space-y-10">
      {runs.map((run, i) => (
        <div key={run.id} className="space-y-6">
          <UserMessage text={run.freeText ?? ""} attachment={run.attachment} />
          <AssistantMessage run={run} isLatest={i === runs.length - 1} onFollowup={onFollowup} onEditProfile={onEditProfile} />
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
        {text && <div className="bg-paper-soft rounded-xl px-4 py-3 text-[15px] whitespace-pre-wrap">{text}</div>}
      </div>
    </div>
  );
}

function AssistantMessage({ run, isLatest, onFollowup, onEditProfile }: { run: RunView; isLatest: boolean; onFollowup: (t: string) => void; onEditProfile: (p: Partial<Profile>) => void }) {
  const running = run.status !== "done" && run.status !== "failed";
  if (run.state.answer) {
    return <div className="text-[15px] leading-relaxed whitespace-pre-wrap">{run.state.answer}</div>;
  }
  const done = run.status === "done";
  return (
    <div className="space-y-6">
      {run.profile && <CandidateCard profile={run.profile} />}
      {run.profile && <Chips profile={run.profile} editable={isLatest && !running} onEdit={onEditProfile} autoOpen={Boolean(run.state.needsRegion && isLatest)} />}
      {run.state.steps.length > 0 && <Steps steps={run.state.steps} />}
      {run.status === "failed" && <p className="text-sm text-err">De run is gestopt: {run.state.error ?? "onbekende fout"}.</p>}
      {run.state.intro && <p className="text-[15px] leading-relaxed">{run.state.intro}</p>}

      {run.matches.length > 0 && (
        <Section title={`A · Top ${run.matches.length} passende vacatures`}>
          <div className="space-y-2">
            {run.matches.map((m) => (
              <ResultCard key={m.jobId} m={m} />
            ))}
          </div>
        </Section>
      )}

      {done && (run.state.employers?.length ?? 0) > 0 && (
        <Section title={`B · ${run.state.employers!.length} interessante werkgevers`}>
          <p className="text-xs text-ink-faint mb-2">Ook zonder passende vacature. Enkel wat Matchr zelf zag; een bedrijf zonder vacature is een potentiële werkgever, geen bewezen aanwervingskans.</p>
          <div className="space-y-2">
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
            <button key={f} type="button" onClick={() => onFollowup(f)} className="text-sm border border-line rounded-full px-3 py-1.5 hover:border-accent hover:text-accent">
              {f}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-2">{title}</h3>
      {children}
    </section>
  );
}

function EmployerCard({ e }: { e: EmployerView }) {
  const badge = e.hasMatchingJob
    ? { text: "Passende vacature", cls: "bg-green-50 text-green-800" }
    : e.openJobs > 0
      ? { text: `Bewezen: ${e.openJobs} open vacature${e.openJobs === 1 ? "" : "s"}, andere functies`, cls: "bg-accent-soft text-accent" }
      : { text: "Potentiële werkgever · geen vacature gevonden", cls: "bg-paper-soft text-ink-soft" };
  return (
    <div className="border border-line rounded-xl p-4">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{e.name}</span>
        <span className="text-sm text-ink-soft">{[e.municipality, e.distanceKm !== null ? `${e.distanceKm} km` : null].filter(Boolean).join(" · ")}</span>
      </div>
      {e.activity && <div className="text-sm text-ink-soft">{e.activity}</div>}
      {e.why && <div className="text-sm mt-1">{e.why}</div>}
      {e.signal && <div className="text-xs mt-1 text-ink-soft">{e.signal}</div>}
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className={`rounded-full px-2 py-0.5 ${badge.cls}`}>{badge.text}</span>
        <a href={e.website} target="_blank" rel="noopener noreferrer" className="rounded-full px-2 py-0.5 bg-paper-soft text-accent hover:underline">
          Website →
        </a>
        {e.careersUrl && (
          <a href={e.careersUrl} target="_blank" rel="noopener noreferrer" className="rounded-full px-2 py-0.5 bg-paper-soft text-accent hover:underline">
            Jobpagina →
          </a>
        )}
      </div>
      <ContactLine email={e.contactEmail ?? null} source={e.contactSource ?? null} subject={`Kandidaat voor ${e.name}`} />
    </div>
  );
}

/** Contactadres om de kandidaat voor te stellen: klikbaar (mail) en kopieerbaar, met de vindplaats. */
function ContactLine({ email, source, subject }: { email: string | null; source: string | null; subject: string }) {
  const [copied, setCopied] = useState(false);
  if (!email) return <div className="mt-2 text-xs text-ink-faint">Geen mailadres gevonden op de vacature of de website.</div>;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
      <a href={`mailto:${email}?subject=${encodeURIComponent(subject)}`} className="font-medium text-accent hover:underline break-all">
        ✉ {email}
      </a>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(email).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="text-xs rounded-md border border-line px-2 py-0.5 hover:bg-paper-soft"
      >
        {copied ? "Gekopieerd" : "Kopieer"}
      </button>
      {source && <span className="text-xs text-ink-faint">gevonden op: {source}</span>}
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
    <details className="border border-line rounded-xl px-4 py-3 text-sm">
      <summary className="cursor-pointer text-ink-soft">
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
        <Row k="Uitvoeringstijd" v={secs ? `${Math.floor(secs / 60)} min ${secs % 60} s` : undefined} />
        <Row k="Geschatte AI-kost (totaal)" v={cost ? `€ ${cost.toFixed(3)}` : "€ 0"} />
      </div>
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
      <div className="border border-line rounded-xl p-4 bg-paper-soft space-y-2">
        {lines.map((l) => (
          <p key={l} className="text-[15px] leading-snug">
            {l}
          </p>
        ))}
        {unsure.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {unsure.map((u) => (
              <span key={u} className="text-xs rounded-full px-2 py-0.5 bg-paper border border-line text-ink-soft">
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

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block text-sm">
      <span className="block text-ink-soft mb-1">{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} className="w-full border border-line rounded-md px-2.5 py-1.5 focus:outline-none focus:border-accent" />
    </label>
  );
}

function Steps({ steps }: { steps: StepState[] }) {
  const glyph: Record<StepState["status"], string> = { done: "✓", running: "●", waiting: "○", skipped: "–", error: "!" };
  const colour: Record<StepState["status"], string> = { done: "text-ok", running: "text-accent", waiting: "text-ink-faint", skipped: "text-ink-faint", error: "text-err" };
  return (
    <ol className="mono text-[13px] border-l-2 border-line pl-4 space-y-1.5">
      {steps.map((s) => (
        <li key={s.key} className="flex gap-2">
          <span className={`${colour[s.status]} w-3 shrink-0 ${s.status === "running" ? "pulse" : ""}`}>{glyph[s.status]}</span>
          <span className={s.status === "waiting" ? "text-ink-faint" : "text-ink"}>
            {s.label}
            {s.detail ? <span className="text-ink-soft"> · {s.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  );
}

function sourceLabel(source: MatchView["source"]): { text: string; cls: string } {
  switch (source) {
    case "company_site":
      return { text: "Rechtstreeks van jobsite", cls: "bg-accent-soft text-accent" };
    case "vdab":
      return { text: "VDAB", cls: "bg-paper-soft text-ink-soft" };
    case "adzuna":
      return { text: "Adzuna", cls: "bg-paper-soft text-ink-soft" };
    case "jooble":
      return { text: "Jooble", cls: "bg-paper-soft text-ink-soft" };
    case "google_jobs":
      return { text: "Google Jobs", cls: "bg-paper-soft text-ink-soft" };
    case "openai_web":
      return { text: "OpenAI Web Search", cls: "bg-paper-soft text-ink-soft" };
    case "web":
      return { text: "Google-zoekopdracht", cls: "bg-paper-soft text-ink-soft" };
    default:
      return { text: "Web", cls: "bg-paper-soft text-ink-soft" };
  }
}

function age(iso: string): string {
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / (24 * 3600 * 1000));
  if (days <= 0) return "vandaag gezien";
  if (days === 1) return "gisteren gezien";
  return `${days} dagen geleden gezien`;
}

function VerificationBadge({ v }: { v: string }) {
  const [main, flagPart] = (v || "niet geverifieerd").split(" | ");
  const [status, ...rest] = main.split(":");
  const reason = rest.join(":").trim();
  const active = status.trim() === "actief";
  const flags = (flagPart ?? "").split(",").map((f) => f.trim()).filter(Boolean);
  return (
    <>
      <span title={reason || undefined} className={`rounded-full px-2 py-0.5 ${active ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
        {active ? "✓ Gecontroleerd: open" : "Niet geverifieerd"}
      </span>
      {flags.map((f) => (
        <span key={f} className="rounded-full px-2 py-0.5 bg-amber-50 text-amber-800">
          {f.charAt(0).toUpperCase() + f.slice(1)}
        </span>
      ))}
    </>
  );
}

function ResultCard({ m }: { m: MatchView }) {
  const src = sourceLabel(m.source);
  const score10 = Math.round(m.score / 10);
  return (
    <div className="flex gap-4 items-start border border-line rounded-xl p-4 bg-paper transition-shadow hover:shadow-[0_2px_12px_rgba(17,24,39,0.06)]">
      <div className="mono w-12 h-12 shrink-0 rounded-md bg-accent-soft text-accent flex flex-col items-center justify-center leading-none">
        <span className="text-lg font-semibold">{score10}</span>
        <span className="text-[10px]">/10</span>
      </div>
      <div className="min-w-0 flex-1">
        <a href={m.url} target="_blank" rel="noopener noreferrer" className="font-medium leading-snug hover:text-accent hover:underline">
          {m.title}
        </a>
        <div className="text-sm text-ink-soft truncate">{[m.company, m.location].filter(Boolean).join(" · ")}</div>
        <div className="text-sm mt-1">
          <span className="text-ok">+</span> {m.argument || m.reason}
        </div>
        {m.risk && (
          <div className="text-sm mt-0.5 text-ink-soft">
            <span className="text-warn">!</span> {m.risk}
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 ${src.cls}`}>{src.text}</span>
          <VerificationBadge v={m.verification} />
          <span className="rounded-full px-2 py-0.5 bg-paper-soft text-ink-soft">peildatum: {age(m.firstSeenAt)}</span>
          <a href={m.url} target="_blank" rel="noopener noreferrer" className="rounded-full px-2 py-0.5 bg-paper-soft text-accent hover:underline">
            Vacature openen →
          </a>
        </div>
        <ContactLine email={m.contactEmail} source={m.contactSource} subject={`Kandidaat voor uw vacature ${m.title}`} />
      </div>
    </div>
  );
}
