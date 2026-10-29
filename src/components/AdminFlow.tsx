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
  /** Domein voor het logo (officiële favicon van de dienst). */
  domain?: string;
};

type Step = { n: number; title: string; short: string; what: string; tools: Tool[]; rules?: string[] };

const SEARCH_CHAIN: Tool[] = [
  { name: "Linkup", key: "LINKUP_API_KEY", test: "linkup", note: "1e keuze", domain: "linkup.so" },
  { name: "Tavily", key: "TAVILY_API_KEY", test: "tavily", note: "2e", domain: "tavily.com" },
  { name: "Exa", key: "EXA_API_KEY", test: "exa", note: "3e", domain: "exa.ai" },
  { name: "Brave", key: "BRAVE_SEARCH_API_KEY", test: "brave", note: "4e", domain: "brave.com" },
  { name: "Claude web search", key: "ANTHROPIC_API_KEY", test: "anthropic", note: "vangnet, betalend", domain: "claude.ai" },
];

const STEPS: Step[] = [
  {
    n: 1,
    title: "Profiel opstellen",
    short: "Cv lezen",
    what: "Leest het cv (pdf, docx) en je opdracht. Maakt functietitels, regio en straal, uitsluitingen, de kandidaat in 3 regels en open vragen.",
    tools: [{ name: "Claude Haiku", key: "ANTHROPIC_API_KEY", domain: "claude.ai", test: "claude" }, { name: "OpenAI (mini)", key: "OPENAI_API_KEY", domain: "openai.com", test: "openai" }],
  },
  {
    n: 2,
    title: "Jobboards doorzoeken",
    short: "Jobboards",
    what: "Zoekt vacatures op functietitel en regio.",
    tools: [
      { name: "Adzuna", key: "ADZUNA_APP_ID", test: "adzuna", domain: "adzuna.be" },
      { name: "Jooble", key: "JOOBLE_API_KEY", test: "jooble", domain: "jooble.org" },
      { name: "VDAB (via zoekketen)", free: true, domain: "vdab.be" },
    ],
    rules: ["Plaats buiten de straal of onherkenbaar: weg", "Interim, tijdelijk, bureaus: weg"],
  },
  {
    n: 3,
    title: "Bedrijven ontdekken",
    short: "Bedrijven vinden",
    what: "Claude bedenkt zoekopdrachten naar eindwerkgevers in de regio; de zoekketen haalt bedrijfssites op. Valt een zoekmachine uit, dan neemt de volgende over.",
    tools: [{ name: "Claude Haiku", key: "ANTHROPIC_API_KEY", domain: "claude.ai", test: "claude" }, { name: "OpenAI (mini)", key: "OPENAI_API_KEY", domain: "openai.com", test: "openai" }, ...SEARCH_CHAIN],
    rules: ["Enkel gemeenten binnen de straal", "Jobboards, interim-, recruitment- en consultancybureaus: uitgesloten"],
  },
  {
    n: 4,
    title: "Jobpagina vinden",
    short: "Jobpagina vinden",
    what: "Per bedrijf: ATS herkennen, standaardpaden (/jobs, /vacatures, …) proberen, de homepage-links laten kiezen, of de zoekketen met site:.",
    tools: [{ name: "ATS-detectie", free: true }, { name: "Claude Haiku", key: "ANTHROPIC_API_KEY", domain: "claude.ai", test: "claude" }, { name: "OpenAI (mini)", key: "OPENAI_API_KEY", domain: "openai.com", test: "openai" }, { name: "Zoekketen", free: true, note: "zie stap 3" }],
    rules: ["Homepage van een tussenpersoon: bedrijf overslaan"],
  },
  {
    n: 5,
    title: "Vacatures lezen",
    short: "Vacatures lezen",
    what: "Haalt de vacatures op: eerst de publieke ATS-feed, anders de pagina zelf (gewone fetch, dan Jina, dan Firecrawl voor zware JavaScript-sites).",
    tools: [
      { name: "ATS-feeds (Recruitee, Greenhouse, Lever, …)", free: true, domain: "recruitee.com" },
      { name: "Jina Reader", free: true, note: "key optioneel", domain: "jina.ai" },
      { name: "Firecrawl", key: "FIRECRAWL_API_KEY", test: "firecrawl", domain: "firecrawl.dev" },
      { name: "Claude Haiku", key: "ANTHROPIC_API_KEY", domain: "claude.ai", test: "claude" }, { name: "OpenAI (mini)", key: "OPENAI_API_KEY", domain: "openai.com", test: "openai" },
    ],
  },
  {
    n: 6,
    title: "Scoren en filteren",
    short: "Scoren",
    what: "Haiku doet een grove voorselectie; Sonnet scoort op 10: kerntaken 3, vaardigheden 3, senioriteit 2, sector 1, mobiliteit 1, met één argument en één risico.",
    tools: [
      { name: "Claude Haiku", key: "ANTHROPIC_API_KEY", domain: "claude.ai", test: "claude" }, { name: "OpenAI (mini)", key: "OPENAI_API_KEY", domain: "openai.com", test: "openai" },
      { name: "Claude Sonnet", key: "ANTHROPIC_API_KEY", domain: "claude.ai" }, { name: "OpenAI (scoring)", key: "OPENAI_API_KEY", domain: "openai.com" },
    ],
    rules: ["Minstens 6/10", "Vast contract, eindwerkgever bij naam", "Binnen de straal", "Max 2 per werkgever, max 10 in totaal"],
  },
];

type Status = "on" | "free" | "off";

function toolStatus(tool: Tool, status: Map<string, string>): Status {
  if (tool.free) return "free";
  const src = tool.key ? status.get(tool.key) ?? "none" : "none";
  return src === "admin" || src === "env" ? "on" : "off";
}

const RING: Record<Status, string> = {
  on: "ring-2 ring-green-600",
  free: "ring-2 ring-accent",
  off: "ring-1 ring-line opacity-40 grayscale",
};

/** Logo van de dienst via zijn officiële favicon; valt terug op initialen als het niet laadt. */
function Logo({ tool, size = 28, st }: { tool: Tool; size?: number; st: Status }) {
  const [failed, setFailed] = useState(false);
  const initials = tool.name
    .replace(/\(.*\)/, "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const label = `${tool.name} — ${st === "on" ? "ingesteld" : st === "free" ? "gratis, altijd aan" : "niet ingesteld"}`;
  return (
    <span title={label} aria-label={label} role="img" className={`inline-flex items-center justify-center rounded-md bg-white shrink-0 ${RING[st]}`} style={{ width: size, height: size }}>
      {tool.domain && !failed ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.google.com/s2/favicons?domain=${tool.domain}&sz=64`}
          alt=""
          width={size - 8}
          height={size - 8}
          className="rounded-sm"
          onError={() => setFailed(true)}
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="mono text-[10px] font-semibold text-ink-soft">{initials || "•"}</span>
      )}
    </span>
  );
}

function uniqueByName(tools: Tool[]): Tool[] {
  const seen = new Set<string>();
  return tools.filter((t) => (seen.has(t.name) ? false : (seen.add(t.name), true)));
}

function Arrow() {
  return (
    <svg width="28" height="12" viewBox="0 0 28 12" className="shrink-0 text-ink-faint self-center" aria-hidden>
      <path d="M0 6h24M19 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Endpoint({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="w-[104px] shrink-0 self-center text-center">
      <div className="mx-auto w-10 h-10 rounded-full border-2 border-ink flex items-center justify-center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          {title.startsWith("Cv") ? <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" /> : <path d="M5 12l4 4L19 6" />}
        </svg>
      </div>
      <div className="mt-2 text-sm font-medium">{title}</div>
      <div className="text-xs text-ink-faint">{sub}</div>
    </div>
  );
}

/** Kaart van de run: cv → zes stappen → resultaat, met per stap de logo's van de tools. */
function FlowMap({ status }: { status: Map<string, string> }) {
  return (
    <div className="border border-line rounded-xl bg-paper-soft p-4 overflow-x-auto">
      <div className="flex items-stretch gap-1 min-w-[1000px]">
        <Endpoint title="Cv + opdracht" sub="pdf, docx of tekst" />
        <Arrow />
        {STEPS.map((step, i) => {
          const tools = uniqueByName(step.tools.filter((t) => t.name !== "Zoekketen" && t.name !== "ATS-detectie"));
          const isChain = step.n === 3;
          return (
            <div key={step.n} className="flex items-stretch gap-1">
              <a href={`#stap-${step.n}`} className="w-[118px] shrink-0 rounded-lg border border-line bg-paper p-3 flex flex-col items-center text-center hover:border-accent">
                <span className="mono text-xs w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center">{step.n}</span>
                <span className="mt-2 text-sm font-medium leading-tight">{step.short}</span>
                {isChain ? (
                  <div className="mt-3 flex flex-col items-center gap-1">
                    <Logo tool={tools[0]} st={toolStatus(tools[0], status)} size={24} />
                    <span className="text-[10px] text-ink-faint">zoekketen</span>
                    <div className="flex flex-col items-center gap-1">
                      {tools.slice(1).map((t, k) => (
                        <div key={t.name} className="flex flex-col items-center">
                          {k > 0 && <span className="text-ink-faint text-[10px] leading-none">↓</span>}
                          <Logo tool={t} st={toolStatus(t, status)} size={24} />
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                    {tools.map((t) => (
                      <Logo key={t.name} tool={t} st={toolStatus(t, status)} size={24} />
                    ))}
                  </div>
                )}
              </a>
              {i < STEPS.length - 1 && <Arrow />}
            </div>
          );
        })}
        <Arrow />
        <Endpoint title="Tot 10 vacatures" sub="score, argument, risico" />
      </div>
    </div>
  );
}

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
      <FlowMap status={status} />
      <p className="mt-2 mb-5 text-xs text-ink-faint">
        <span className="inline-block w-2.5 h-2.5 rounded-sm ring-2 ring-green-600 align-middle mr-1" /> ingesteld ·{" "}
        <span className="inline-block w-2.5 h-2.5 rounded-sm ring-2 ring-accent align-middle mr-1 ml-1" /> gratis zonder key ·{" "}
        <span className="inline-block w-2.5 h-2.5 rounded-sm ring-1 ring-line align-middle mr-1 ml-1" /> niet ingesteld (grijs). Klik op een stap voor details en testknoppen.
      </p>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-3">Details per stap</h3>
      <ol className="relative space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.n} id={`stap-${step.n}`} className="relative scroll-mt-4">
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
                      <Logo tool={tool} st={toolStatus(tool, status)} size={18} />
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
                          {t.ok ? `ok · ${(t.ms / 1000).toFixed(1)} s${t.count > 1 ? ` · ${t.count} resultaten` : ""}` : `faalt${t.error ? `: ${t.error}` : ""}`}
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

    </section>
  );
}
