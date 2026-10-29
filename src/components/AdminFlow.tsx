"use client";

import { useState } from "react";

type SettingLite = { key: string; source: "admin" | "env" | "none" };

type Tool = {
  name: string;
  /** Instelling die deze tool aanzet; zonder = altijd aan. */
  key?: string;
  /** Gratis zonder key. */
  free?: boolean;
  /** Tool-id voor de testknop. */
  test?: string;
  note?: string;
};

type Step = { n: number; title: string; what: string; tools: Tool[]; rules?: string[] };

const SEARCH_CHAIN: Tool[] = [
  { name: "Linkup", key: "LINKUP_API_KEY", test: "linkup", note: "1e keuze" },
  { name: "Tavily", key: "TAVILY_API_KEY", test: "tavily", note: "2e" },
  { name: "Exa", key: "EXA_API_KEY", test: "exa", note: "3e" },
  { name: "Brave", key: "BRAVE_SEARCH_API_KEY", test: "brave", note: "4e" },
  { name: "Claude web search", key: "ANTHROPIC_API_KEY", test: "anthropic", note: "vangnet, betalend" },
];

const STEPS: Step[] = [
  {
    n: 1,
    title: "Profiel opstellen",
    what: "Leest het cv (pdf, docx) en je opdracht. Maakt functietitels, regio en straal, uitsluitingen, de kandidaat in 3 regels en open vragen.",
    tools: [{ name: "Claude Haiku", key: "ANTHROPIC_API_KEY" }],
  },
  {
    n: 2,
    title: "Jobboards doorzoeken",
    what: "Zoekt vacatures op functietitel en regio.",
    tools: [
      { name: "Adzuna", key: "ADZUNA_APP_ID", test: "adzuna" },
      { name: "Jooble", key: "JOOBLE_API_KEY", test: "jooble" },
      { name: "VDAB (via zoekketen)", free: true },
    ],
    rules: ["Plaats buiten de straal of onherkenbaar: weg", "Interim, tijdelijk, bureaus: weg"],
  },
  {
    n: 3,
    title: "Bedrijven ontdekken",
    what: "Claude bedenkt zoekopdrachten naar eindwerkgevers in de regio; de zoekketen haalt bedrijfssites op. Valt een zoekmachine uit, dan neemt de volgende over.",
    tools: [{ name: "Claude Haiku", key: "ANTHROPIC_API_KEY" }, ...SEARCH_CHAIN],
    rules: ["Enkel gemeenten binnen de straal", "Jobboards, interim-, recruitment- en consultancybureaus: uitgesloten"],
  },
  {
    n: 4,
    title: "Jobpagina vinden",
    what: "Per bedrijf: ATS herkennen, standaardpaden (/jobs, /vacatures, …) proberen, de homepage-links laten kiezen, of de zoekketen met site:.",
    tools: [{ name: "ATS-detectie", free: true }, { name: "Claude Haiku", key: "ANTHROPIC_API_KEY" }, { name: "Zoekketen", free: true, note: "zie stap 3" }],
    rules: ["Homepage van een tussenpersoon: bedrijf overslaan"],
  },
  {
    n: 5,
    title: "Vacatures lezen",
    what: "Haalt de vacatures op: eerst de publieke ATS-feed, anders de pagina zelf (gewone fetch, dan Jina, dan Firecrawl voor zware JavaScript-sites).",
    tools: [
      { name: "ATS-feeds (Recruitee, Greenhouse, Lever, …)", free: true },
      { name: "Jina Reader", free: true, note: "key optioneel" },
      { name: "Firecrawl", key: "FIRECRAWL_API_KEY", test: "firecrawl" },
      { name: "Claude Haiku", key: "ANTHROPIC_API_KEY" },
    ],
  },
  {
    n: 6,
    title: "Scoren en filteren",
    what: "Haiku doet een grove voorselectie; Sonnet scoort op 10: kerntaken 3, vaardigheden 3, senioriteit 2, sector 1, mobiliteit 1, met één argument en één risico.",
    tools: [
      { name: "Claude Haiku", key: "ANTHROPIC_API_KEY" },
      { name: "Claude Sonnet", key: "ANTHROPIC_API_KEY" },
    ],
    rules: ["Minstens 6/10", "Vast contract, eindwerkgever bij naam", "Binnen de straal", "Max 2 per werkgever, max 10 in totaal"],
  },
];

type TestResult = { ok: boolean; count: number; ms: number; sample?: string[]; error?: string };

export function AdminFlow({ settings }: { settings: SettingLite[] }) {
  const status = new Map(settings.map((s) => [s.key, s.source]));
  const [tests, setTests] = useState<Record<string, TestResult | "busy">>({});

  async function runTest(tool: string) {
    setTests((t) => ({ ...t, [tool]: "busy" }));
    try {
      const res = await fetch(`/api/admin/test?tool=${encodeURIComponent(tool)}`, { cache: "no-store" });
      const data = (await res.json()) as TestResult;
      setTests((t) => ({ ...t, [tool]: res.ok ? data : { ok: false, count: 0, ms: 0, error: data.error ?? `HTTP ${res.status}` } }));
    } catch {
      setTests((t) => ({ ...t, [tool]: { ok: false, count: 0, ms: 0, error: "netwerkfout" } }));
    }
  }

  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-3">Hoe een run loopt</h2>
      <ol className="relative space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.n} className="relative">
            <div className="border border-line rounded-lg p-4 bg-paper">
              <div className="flex items-baseline gap-3">
                <span className="mono text-xs w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center shrink-0">{step.n}</span>
                <h3 className="font-medium">{step.title}</h3>
              </div>
              <p className="text-sm text-ink-soft mt-1 ml-9">{step.what}</p>
              <div className="mt-3 ml-9 flex flex-wrap gap-2">
                {step.tools.map((tool) => {
                  const src = tool.key ? status.get(tool.key) ?? "none" : undefined;
                  const on = tool.free || src === "admin" || src === "env";
                  const t = tool.test ? tests[tool.test] : undefined;
                  return (
                    <span key={`${step.n}-${tool.name}`} className={`inline-flex items-center gap-2 text-xs rounded-full border px-2.5 py-1 ${on ? "border-line bg-paper" : "border-dashed border-line bg-paper-soft text-ink-faint"}`}>
                      <span className={`w-2 h-2 rounded-full ${tool.free ? "bg-accent" : on ? "bg-green-600" : "bg-gray-300"}`} aria-hidden />
                      <span className={on ? "text-ink" : ""}>{tool.name}</span>
                      {tool.note && <span className="text-ink-faint">· {tool.note}</span>}
                      <span className="text-ink-faint">· {tool.free ? "gratis, altijd aan" : on ? (src === "env" ? "via Vercel" : "ingesteld") : "niet ingesteld"}</span>
                      {tool.test && on && (
                        <button type="button" onClick={() => runTest(tool.test!)} disabled={t === "busy"} className="text-accent hover:underline disabled:opacity-50">
                          {t === "busy" ? "test…" : "test"}
                        </button>
                      )}
                      {t && t !== "busy" && (
                        <span className={t.ok ? "text-green-700" : "text-red-700"}>
                          {t.ok ? `ok · ${t.count} resultaten · ${(t.ms / 1000).toFixed(1)} s` : `faalt${t.error ? `: ${t.error}` : ""}`}
                        </span>
                      )}
                    </span>
                  );
                })}
              </div>
              {step.rules && (
                <ul className="mt-3 ml-9 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-soft">
                  {step.rules.map((r) => (
                    <li key={r}>— {r}</li>
                  ))}
                </ul>
              )}
            </div>
            {i < STEPS.length - 1 && (
              <div className="flex justify-start ml-7 h-3" aria-hidden>
                <div className="w-px bg-line" />
              </div>
            )}
          </li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-ink-faint">
        <span className="inline-block w-2 h-2 rounded-full bg-green-600 align-middle" /> ingesteld · <span className="inline-block w-2 h-2 rounded-full bg-accent align-middle" /> gratis zonder key ·{" "}
        <span className="inline-block w-2 h-2 rounded-full bg-gray-300 align-middle" /> niet ingesteld
      </p>
    </section>
  );
}
