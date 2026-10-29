"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { RunsIndex } from "./api";
import type { RunListItem } from "@/lib/runs";

function groupLabel(iso: string): "Vandaag" | "Gisteren" | "Eerder" {
  const d = new Date(iso);
  const now = new Date();
  const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (d.getTime() >= startToday) return "Vandaag";
  if (d.getTime() >= startToday - 24 * 3600 * 1000) return "Gisteren";
  return "Eerder";
}

function timeLabel(iso: string, group: string): string {
  const d = new Date(iso);
  if (group === "Eerder") return d.toLocaleDateString("nl-BE", { day: "numeric", month: "short" });
  return d.toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" });
}

export function Sidebar({ index, me, activeThreadId, onOpen, onNewRun }: { index: RunsIndex | null; me: string; activeThreadId: string | null; onOpen: (runId: number) => void; onNewRun: () => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const items = (index?.runs ?? []).filter((r) => !q || `${r.candidateName} ${r.summary} ${r.author}`.toLowerCase().includes(q.toLowerCase()));
    const out: Record<string, RunListItem[]> = { Vandaag: [], Gisteren: [], Eerder: [] };
    for (const r of items) out[groupLabel(r.createdAt)].push(r);
    return out;
  }, [index, q]);

  return (
    <aside className="w-full md:w-[280px] shrink-0 bg-sidebar text-white flex flex-col md:h-screen md:sticky md:top-0">
      <div className="px-4 pt-5 pb-3 space-y-4">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-white.png" alt="RecruitrLAB" width={64} height={40} className="h-9 w-auto" />
          <div className="leading-tight">
            <div className="font-semibold tracking-tight text-[17px]">
              Matchr<span className="text-gold">.</span>
            </div>
            <div className="eyebrow text-white/50 !text-[9px]">by RecruitrLAB</div>
          </div>
        </div>
        <button type="button" onClick={onNewRun} className="w-full flex items-center justify-center gap-2 text-sm font-semibold rounded-full px-3 py-2.5 bg-gold text-navy hover:bg-gold-deep transition-colors">
          <span aria-hidden>＋</span> Nieuwe run
        </button>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Zoek kandidaat of functie"
          className="w-full text-sm bg-white/10 text-white placeholder:text-white/40 border border-white/10 rounded-lg px-3 py-1.5 focus:outline-none focus:border-gold"
        />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {(["Vandaag", "Gisteren", "Eerder"] as const).map((g) =>
          groups[g].length ? (
            <div key={g} className="mb-3">
              <div className="px-2.5 py-1 eyebrow text-white/40">{g}</div>
              {groups[g].map((r) => (
                <button
                  key={r.threadId}
                  type="button"
                  onClick={() => onOpen(r.id)}
                  className={`w-full text-left px-2.5 py-2 rounded-lg transition-colors hover:bg-white/5 border-l-2 ${r.threadId === activeThreadId ? "bg-white/10 border-gold" : "border-transparent"}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium truncate">{r.candidateName}</span>
                    <span className="text-xs text-white/40 shrink-0">{timeLabel(r.createdAt, g)}</span>
                  </div>
                  <div className="text-xs text-white/55 truncate">
                    {r.summary || "profiel wordt opgesteld"}
                    {r.status === "done" ? ` · ${r.hits} treffers` : r.status === "failed" ? " · mislukt" : " · bezig"}
                  </div>
                </button>
              ))}
            </div>
          ) : null,
        )}
        {index && index.runs.length === 0 && <p className="px-2 text-sm text-white/50">Nog geen runs.</p>}
      </div>
      <div className="p-4 border-t border-white/10 text-xs text-white/55 space-y-1">
        <div className="flex items-center justify-between">
          <span className="font-medium text-white">{me}</span>
          <Link href="/admin" className="rounded-md px-2 py-1 text-white/70 hover:bg-white/10 hover:text-white">
            ⚙ Instellingen
          </Link>
        </div>
        <div>
          {index ? `${index.week.runs} runs deze week · € ${index.week.cost.toFixed(2)}` : "…"}
        </div>
        {index && (
          <div className="text-white/40 mt-1">
            Team deze maand: € {index.month.spent.toFixed(2)} van € {index.month.budget.toFixed(0)} aan OpenAI · {index.month.braveQueries} zoekopdrachten (gratis)
          </div>
        )}
      </div>
    </aside>
  );
}
