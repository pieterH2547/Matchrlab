"use client";

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

export function Sidebar({ index, me, activeThreadId, onOpen }: { index: RunsIndex | null; me: string; activeThreadId: string | null; onOpen: (runId: number) => void }) {
  const [q, setQ] = useState("");
  const groups = useMemo(() => {
    const items = (index?.runs ?? []).filter((r) => !q || `${r.candidateName} ${r.summary} ${r.author}`.toLowerCase().includes(q.toLowerCase()));
    const out: Record<string, RunListItem[]> = { Vandaag: [], Gisteren: [], Eerder: [] };
    for (const r of items) out[groupLabel(r.createdAt)].push(r);
    return out;
  }, [index, q]);

  return (
    <aside className="w-full md:w-[300px] shrink-0 border-t md:border-t-0 md:border-l border-line bg-sidebar flex flex-col md:max-h-[calc(100vh-56px)]">
      <div className="p-4 border-b border-line">
        <h2 className="font-medium mb-2">Runs</h2>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Zoek op kandidaat of functie" className="w-full text-sm bg-paper border border-line rounded-md px-2.5 py-1.5 focus:outline-none focus:border-accent" />
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {(["Vandaag", "Gisteren", "Eerder"] as const).map((g) =>
          groups[g].length ? (
            <div key={g} className="mb-3">
              <div className="px-2 py-1 text-xs uppercase tracking-wide text-ink-faint">{g}</div>
              {groups[g].map((r) => (
                <button
                  key={r.threadId}
                  type="button"
                  onClick={() => onOpen(r.id)}
                  className={`w-full text-left px-2 py-2 rounded-md hover:bg-paper ${r.threadId === activeThreadId ? "bg-paper border border-line" : ""}`}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-sm font-medium truncate">{r.candidateName}</span>
                    <span className="text-xs text-ink-faint shrink-0">{timeLabel(r.createdAt, g)}</span>
                  </div>
                  <div className="text-xs text-ink-soft truncate">
                    {r.summary || "profiel wordt opgesteld"}
                    {r.status === "done" ? ` · ${r.hits} treffers` : r.status === "failed" ? " · mislukt" : " · bezig"}
                  </div>
                </button>
              ))}
            </div>
          ) : null,
        )}
        {index && index.runs.length === 0 && <p className="px-2 text-sm text-ink-faint">Nog geen runs.</p>}
      </div>
      <div className="p-4 border-t border-line text-xs text-ink-soft">
        <div className="font-medium text-ink">{me}</div>
        <div>
          {index ? `${index.week.runs} runs deze week · € ${index.week.cost.toFixed(2)}` : "…"}
        </div>
        {index && (
          <div className="text-ink-faint mt-1">
            Team deze maand: € {index.month.spent.toFixed(2)} van € {index.month.budget.toFixed(0)} · {index.month.braveQueries} zoekopdrachten
          </div>
        )}
      </div>
    </aside>
  );
}
