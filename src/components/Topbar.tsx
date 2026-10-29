"use client";

/** Dunne balk boven de thread: zijbalk tonen/verbergen en de huidige kandidaat. Merk staat in de zijbalk. */
export function Topbar({ onNewRun, onToggleSidebar, sidebarOpen, title }: { onNewRun: () => void; onToggleSidebar: () => void; sidebarOpen: boolean; title?: string | null }) {
  return (
    <header className="h-12 shrink-0 flex items-center px-3 gap-2 bg-paper">
      <button
        type="button"
        onClick={onToggleSidebar}
        aria-label={sidebarOpen ? "Zijbalk inklappen" : "Zijbalk uitklappen"}
        className="w-8 h-8 rounded-md flex items-center justify-center text-ink-soft hover:bg-paper-soft hover:text-ink"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <rect x="1.5" y="2.5" width="13" height="11" rx="1.5" />
          <line x1="6" y1="2.5" x2="6" y2="13.5" />
        </svg>
      </button>
      {!sidebarOpen && (
        <span className="flex items-center gap-2 mr-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo-navy-sm.png" alt="RecruitrLAB" width={40} height={23} className="h-6 w-auto" />
          <span className="font-semibold text-sm">
            Matchr<span className="text-gold">.</span>
          </span>
        </span>
      )}
      <span className="text-[13px] text-ink-faint truncate">{title ?? ""}</span>
      {!sidebarOpen && (
        <button type="button" onClick={onNewRun} className="ml-auto text-sm font-medium rounded-lg px-3 py-1.5 bg-navy text-white hover:bg-navy-2">
          Nieuwe run
        </button>
      )}
    </header>
  );
}
