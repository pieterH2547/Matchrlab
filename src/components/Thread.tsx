"use client";

import { useState } from "react";
import type { RunView, Profile, StepState, MatchView, SignalView, ActionView } from "@/lib/pipeline/types";

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
  const signals = run.state.signals ?? [];
  const actions = run.state.actions ?? [];
  const done = run.status === "done";
  return (
    <div className="space-y-6">
      {run.profile && <CandidateCard profile={run.profile} />}
      {run.profile && <Chips profile={run.profile} editable={isLatest && !running} onEdit={onEditProfile} />}
      {run.state.steps.length > 0 && <Steps steps={run.state.steps} />}
      {run.status === "failed" && <p className="text-sm text-err">De run is gestopt: {run.state.error ?? "onbekende fout"}.</p>}
      {run.state.intro && <p className="text-[15px] leading-relaxed">{run.state.intro}</p>}

      {(run.matches.length > 0 || signals.length > 0) && (
        <Section title={`Top ${run.matches.length + signals.length} werkgevers`}>
          <div className="space-y-2">
            {run.matches.map((m) => (
              <ResultCard key={m.jobId} m={m} />
            ))}
            {signals.map((s) => (
              <SignalCard key={s.domain} s={s} />
            ))}
          </div>
        </Section>
      )}
      {done && run.matches.length === 0 && signals.length === 0 && run.state.intro && (
        <p className="text-sm text-ink-soft">Geen gekwalificeerde werkgevers gevonden. Liever nul dan een opgevulde lijst.</p>
      )}

      {actions.length > 0 && (
        <Section title={`Deze ${actions.length} ${actions.length === 1 ? "actie" : "acties"} nu`}>
          <div className="space-y-2">
            {actions.map((a, i) => (
              <ActionCard key={`${a.employer}-${i}`} a={a} />
            ))}
          </div>
        </Section>
      )}

      {done && run.profile && (run.profile.open_questions?.length ?? 0) > 0 && (
        <Section title="Nog te bevestigen">
          <ol className="list-decimal pl-5 space-y-1 text-[15px]">
            {run.profile.open_questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ol>
          <p className="mt-2 text-xs text-ink-faint">Relatiecheck in Outlook/CRM is niet uitgevoerd: er is nog geen koppeling.</p>
        </Section>
      )}

      {done && run.state.kpi && (
        <p className="mono text-xs text-ink-soft border-t border-line pt-3">
          {run.state.kpi.verifiedJobs} bewezen vacature(s) · {run.state.kpi.proactive} proactieve werkgever(s) · {run.state.kpi.relationsChecked} relaties nagekeken ·{" "}
          {run.state.kpi.draftsSaved} drafts opgeslagen
        </p>
      )}

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

function CandidateCard({ profile }: { profile: Profile }) {
  const lines = profile.positioning ?? [];
  const unsure = profile.uncertainties ?? [];
  if (!lines.length && !unsure.length) return null;
  return (
    <Section title="Kandidaat in 3 regels">
      <div className="border border-line rounded-xl p-4 bg-paper-soft space-y-2">
        {lines.map((l) => (
          <p key={l} className="text-[15px] leading-snug">
            {l}
          </p>
        ))}
        <div className="flex flex-wrap gap-2 pt-1">
          {unsure.map((u) => (
            <span key={u} className="text-xs rounded-full px-2 py-0.5 bg-paper border border-line text-ink-soft">
              {u}
            </span>
          ))}
          <span className={`text-xs rounded-full px-2 py-0.5 ${profile.consent === "bevestigd" ? "bg-green-50 text-green-800" : "bg-amber-50 text-amber-800"}`}>
            {profile.consent === "bevestigd" ? "Mandaat: bevestigd" : "Mandaat: TE BEVESTIGEN — geen persoonsgegevens extern delen"}
          </span>
        </div>
      </div>
    </Section>
  );
}

function SignalCard({ s }: { s: SignalView }) {
  const fitCls = s.fit === "sterk" ? "bg-green-50 text-green-800" : s.fit === "middel" ? "bg-amber-50 text-amber-800" : "bg-paper-soft text-ink-soft";
  return (
    <div className="flex gap-4 items-start border border-dashed border-line rounded-xl p-4">
      <div className="w-12 h-12 shrink-0 rounded-md bg-paper-soft flex items-center justify-center text-[11px] font-semibold text-ink-soft text-center leading-tight">B</div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <span className="font-medium">{s.company}</span>
          <span className="text-sm text-ink-soft">
            {s.kind} · {s.date}
          </span>
        </div>
        <div className="mt-1 text-xs font-semibold tracking-wide text-amber-800">PROACTIEF — geen vacature bevestigd</div>
        <div className="text-sm mt-1">{s.evidence}</div>
        <div className="text-sm mt-1 text-ink-soft">{s.fitReason}</div>
        <div className="mt-2 flex flex-wrap gap-2 text-xs">
          <span className={`rounded-full px-2 py-0.5 ${fitCls}`}>bedrijfsfit {s.fit}</span>
          <a href={s.sourceUrl} target="_blank" rel="noopener noreferrer" className="rounded-full px-2 py-0.5 bg-paper-soft text-accent hover:underline truncate max-w-[320px]">
            Bron: {s.sourceTitle || s.sourceUrl}
          </a>
        </div>
      </div>
    </div>
  );
}

function ActionCard({ a }: { a: ActionView }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const cls: Record<ActionView["action"], string> = {
    BEL: "bg-accent-soft text-accent",
    DRAFT: "bg-accent-soft text-accent",
    "INTERN AFSTEMMEN": "bg-amber-50 text-amber-800",
    "NIET CONTACTEREN": "bg-red-50 text-red-800",
  };
  async function copy() {
    if (!a.draft) return;
    try {
      await navigator.clipboard.writeText(`${a.draft.subject}\n\n${a.draft.body}`);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* klembord niet beschikbaar */
    }
  }
  return (
    <div className="border border-line rounded-xl p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`mono text-xs font-semibold rounded px-2 py-0.5 ${cls[a.action]}`}>{a.action}</span>
        <span className="font-medium">{a.employer}</span>
        <span className="text-xs text-ink-faint">spoor {a.track}</span>
        <span className="ml-auto text-xs rounded-full px-2 py-0.5 bg-amber-50 text-amber-800">{a.relation}</span>
      </div>
      <p className="text-sm mt-2">{a.reason}</p>
      {a.draft && (
        <div className="mt-3">
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => setOpen((o) => !o)} className="text-sm text-accent hover:underline">
              {open ? "Draft verbergen" : "Draft tonen"}
            </button>
            <button type="button" onClick={copy} className="text-sm text-ink-soft hover:text-ink">
              {copied ? "Gekopieerd" : "Kopiëren"}
            </button>
            <span className="text-xs text-ink-faint">NIET OPGESLAGEN · nooit verzonden</span>
          </div>
          {open && (
            <div className="mt-2 border border-line rounded-lg p-3 bg-paper-soft text-sm">
              <div className="font-medium mb-2">{a.draft.subject}</div>
              <div className="whitespace-pre-wrap leading-relaxed">{a.draft.body}</div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Chips({ profile, editable, onEdit }: { profile: Profile; editable: boolean; onEdit: (p: Partial<Profile>) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ title: string; region: string; radius: string; exclusions: string; years: string }>({
    title: profile.job_titles.join(", "),
    region: profile.region,
    radius: String(profile.radius_km),
    exclusions: profile.exclusions.join(", "),
    years: String(profile.years_experience),
  });
  const chips: { label: string; value: string }[] = [
    { label: "Functie", value: profile.job_titles.slice(0, 2).join(" / ") },
    { label: "Regio", value: `${profile.region} · ${profile.radius_km} km` },
    { label: "Ervaring", value: `${profile.years_experience} jaar` },
    { label: "Uitsluiten", value: profile.exclusions.length ? profile.exclusions.join(", ") : "niets" },
  ];
  function save() {
    const split = (s: string) =>
      s
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
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
          <Field label="Regio" value={draft.region} onChange={(v) => setDraft({ ...draft, region: v })} />
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

function ResultCard({ m }: { m: MatchView }) {
  const src = sourceLabel(m.source);
  const score10 = Math.round(m.score / 10);
  return (
    <div className="flex gap-4 items-start border border-line rounded-xl p-4">
      <div className="mono w-12 h-12 shrink-0 rounded-md bg-accent-soft text-accent flex flex-col items-center justify-center leading-none">
        <span className="text-lg font-semibold">{score10}</span>
        <span className="text-[10px]">/10</span>
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-medium leading-snug">{m.title}</div>
        <div className="text-sm text-ink-soft truncate">{[m.company, m.location].filter(Boolean).join(" · ")}</div>
        <div className="mt-1 text-xs font-semibold tracking-wide text-accent">A — OPEN VACATURE</div>
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
          <span className="rounded-full px-2 py-0.5 bg-paper-soft text-ink-soft">peildatum: {age(m.firstSeenAt)}</span>
          <a href={m.url} target="_blank" rel="noopener noreferrer" className="rounded-full px-2 py-0.5 bg-paper-soft text-accent hover:underline">
            Vacature openen →
          </a>
        </div>
      </div>
    </div>
  );
}
