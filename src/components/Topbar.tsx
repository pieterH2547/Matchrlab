"use client";

import Link from "next/link";

export function Topbar({ onNewRun, onToggleSidebar, sidebarOpen }: { onNewRun: () => void; onToggleSidebar: () => void; sidebarOpen: boolean }) {
  return (
    <header className="h-14 shrink-0 border-b border-line flex items-center px-4 gap-3">
      <span className="inline-block w-6 h-6 rounded-md bg-accent" aria-hidden />
      <span className="font-semibold">Matchr</span>
      <span className="text-xs text-ink-faint">RecruitrLAB</span>
      <div className="ml-auto flex items-center gap-2">
        <Link href="/admin" className="text-sm text-ink-soft hover:text-ink px-2 py-1.5">
          Instellingen
        </Link>
        <button type="button" onClick={onNewRun} className="text-sm border border-line rounded-md px-3 py-1.5 hover:bg-paper-soft">
          Nieuwe run
        </button>
        <button type="button" onClick={onToggleSidebar} aria-label={sidebarOpen ? "Zijbalk inklappen" : "Zijbalk uitklappen"} className="w-8 h-8 rounded-md border border-line flex items-center justify-center hover:bg-paper-soft">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
            <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
            <line x1="10" y1="2.5" x2="10" y2="13.5" />
          </svg>
        </button>
      </div>
    </header>
  );
}
