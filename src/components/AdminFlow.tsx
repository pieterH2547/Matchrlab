"use client";

import { useState } from "react";

type SettingLite = { key: string; source: "admin" | "env" | "none"; value?: string };
export type AiInfo = { provider: string; ids: string[]; auto: string | null; effective: { cheap: string; scoring: string } };

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
  /** Wordt deze tool in de huidige instellingen effectief gebruikt? */
  active?: boolean;
};

type Step = { n: number; title: string; short: string; what: string; tools: Tool[]; rules?: string[] };

type Ctx = { has: (key: string) => boolean; value: (key: string) => string | undefined; ai: AiInfo | null };

const SEARCH_ALL: Tool[] = [
  { name: "Serper (Google)", key: "SERPER_API_KEY", test: "serper", domain: "serper.dev" },
  { name: "Linkup", key: "LINKUP_API_KEY", test: "linkup", domain: "linkup.so" },
  { name: "Tavily", key: "TAVILY_API_KEY", test: "tavily", domain: "tavily.com" },
  { name: "Exa", key: "EXA_API_KEY", test: "exa", domain: "exa.ai" },
];

/** Zoekketen in de echte volgorde: Serper, dan Linkup, Tavily, Exa. */
function searchChain(ctx: Ctx): Tool[] {
  let rank = 0;
  return SEARCH_ALL.map((t) => {
    const active = ctx.has(t.key!);
    return { ...t, active, note: active ? `${++rank}e` : undefined };
  });
}

/** De AI: OpenAI met het automatisch gekozen lichte model. */
function aiTools(ctx: Ctx, task: "cheap" | "scoring"): Tool[] {
  const model = ctx.ai?.effective[task];
  return [{ name: model ? `OpenAI · ${model}` : "OpenAI", key: "OPENAI_API_KEY", domain: "openai.com", test: task === "cheap" ? "openai" : undefined, active: ctx.has("OPENAI_API_KEY") }];
}

function aiLabel(): string {
  return "OpenAI";
}

function buildSteps(ctx: Ctx): Step[] {
  const on = (t: Tool): Tool => ({ ...t, active: t.free || (t.key ? ctx.has(t.key) : true) });
  const chain = searchChain(ctx);
  const chainActive = chain.some((t) => t.active);
  const ai = aiLabel();
  return [
    {
      n: 1,
      title: "Profiel opstellen",
      short: "Cv lezen",
      what: `${ai} leest het cv (pdf, docx) en je opdracht en maakt functietitels, regio en straal, uitsluitingen, de kandidaat in 3 regels en open vragen.`,
      tools: aiTools(ctx, "cheap"),
    },
    {
      n: 2,
      title: "Jobboards doorzoeken",
      short: "Jobboards",
      what: "Zoekt vacatures op functietitel en regio in de jobboards die ingesteld zijn.",
      tools: [
        on({ name: "Google Jobs", key: "SERPAPI_API_KEY", test: "googlejobs", domain: "serpapi.com" }),
        on({ name: "Adzuna", key: "ADZUNA_APP_ID", test: "adzuna", domain: "adzuna.be" }),
        on({ name: "Jooble", key: "JOOBLE_API_KEY", test: "jooble", domain: "jooble.org" }),
        { name: "VDAB", domain: "vdab.be", active: chainActive, note: chainActive ? "via de zoekketen" : "heeft een zoekmachine nodig" },
      ],
      rules: ["Plaats buiten de straal of onherkenbaar: weg", "Interim, tijdelijk, bureaus: weg"],
    },
    {
      n: 3,
      title: "Bedrijven ontdekken",
      short: "Bedrijven vinden",
      what: `${ai} bedenkt zoekopdrachten (soort bedrijf + gemeente). Google Maps geeft de lokale werkgevers met hun website; de zoekketen vult aan. Valt een zoekmachine uit, dan neemt de volgende over.`,
      tools: [...aiTools(ctx, "cheap").filter((t) => t.active), on({ name: "Google Maps", key: "SERPER_API_KEY", domain: "maps.google.com", note: "lokale werkgevers" }), ...chain],
      rules: ["Enkel gemeenten binnen de straal", "Jobboards, interim-, recruitment- en consultancybureaus: uitgesloten"],
    },
    {
      n: 4,
      title: "Jobpagina vinden",
      short: "Jobpagina vinden",
      what: "Per bedrijf: ATS herkennen, standaardpaden (/jobs, /vacatures, …) proberen, de AI een link laten kiezen op de homepage, of de zoekketen met site:.",
      tools: [
        { name: "ATS-detectie", free: true, active: true },
        ...aiTools(ctx, "cheap").filter((t) => t.active),
        { name: "Zoekketen", active: chainActive, note: "zie stap 3" },
      ],
      rules: ["Homepage van een tussenpersoon: bedrijf overslaan"],
    },
    {
      n: 5,
      title: "Vacatures lezen",
      short: "Vacatures lezen",
      what: "Eerst de publieke ATS-feed; anders de pagina zelf: gewone fetch, dan Jina, dan Firecrawl voor zware JavaScript-sites.",
      tools: [
        { name: "ATS-feeds (Recruitee, Greenhouse, Lever, …)", free: true, active: true, domain: "recruitee.com" },
        { name: "Jina Reader", free: true, active: true, note: "key optioneel", domain: "jina.ai" },
        on({ name: "Firecrawl", key: "FIRECRAWL_API_KEY", test: "firecrawl", domain: "firecrawl.dev" }),
        ...aiTools(ctx, "cheap").filter((t) => t.active),
      ],
    },
    {
      n: 6,
      title: "Scoren en filteren",
      short: "Scoren",
      what: "Een grove voorselectie, dan een score op 10: kerntaken 3, vaardigheden 3, senioriteit 2, sector 1, mobiliteit 1, met één argument en één risico.",
      tools: aiTools(ctx, "scoring"),
      rules: ["Minstens 6/10", "Vast contract, eindwerkgever bij naam", "Binnen de straal", "Max 2 per werkgever, max 10 in totaal"],
    },
  ];
}

type Status = "on" | "free" | "off";

function toolStatus(tool: Tool): Status {
  if (!tool.active) return "off";
  return tool.free ? "free" : "on";
}

const RING: Record<Status, string> = {
  on: "ring-2 ring-green-600",
  free: "ring-2 ring-accent",
  off: "ring-1 ring-line opacity-40 grayscale",
};

/** Logo van de dienst via zijn officiële favicon; valt terug op initialen als het niet laadt. */
function Logo({ tool, size = 28 }: { tool: Tool; size?: number }) {
  const [failed, setFailed] = useState(false);
  const st = toolStatus(tool);
  const initials = tool.name
    .replace(/\(.*\)/, "")
    .split(/[\s·]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join("");
  const label = `${tool.name} — ${st === "on" ? "actief" : st === "free" ? "gratis, altijd aan" : "niet actief"}`;
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

function Arrow() {
  return (
    <svg width="28" height="12" viewBox="0 0 28 12" className="shrink-0 text-ink-faint self-center" aria-hidden>
      <path d="M0 6h24M19 1l5 5-5 5" fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function Endpoint({ title, sub, kind }: { title: string; sub: string; kind: "in" | "out" }) {
  return (
    <div className="w-[104px] shrink-0 self-center text-center">
      <div className="mx-auto w-10 h-10 rounded-full border-2 border-ink flex items-center justify-center">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
          {kind === "in" ? <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5" /> : <path d="M5 12l4 4L19 6" />}
        </svg>
      </div>
      <div className="mt-2 text-sm font-medium">{title}</div>
      <div className="text-xs text-ink-faint">{sub}</div>
    </div>
  );
}

/** Kaart: enkel wat effectief draait, in de echte volgorde. */
function FlowMap({ steps }: { steps: Step[] }) {
  return (
    <div className="border border-line rounded-xl bg-paper-soft p-4 overflow-x-auto">
      <div className="flex items-stretch gap-1 min-w-[1040px]">
        <Endpoint title="Cv + opdracht" sub="pdf, docx of tekst" kind="in" />
        <Arrow />
        {steps.map((step, i) => {
          const active = step.tools.filter((t) => t.active && t.name !== "Zoekketen");
          const isChain = step.n === 3;
          const chain = isChain ? active.filter((t) => SEARCH_ALL.some((s) => s.name === t.name)) : [];
          const rest = isChain ? active.filter((t) => !chain.includes(t)) : active;
          const blocked = isChain && chain.length === 0;
          return (
            <div key={step.n} className="flex items-stretch gap-1">
              <a
                href={`#stap-${step.n}`}
                className={`w-[122px] shrink-0 rounded-lg border bg-paper p-3 flex flex-col items-center text-center hover:border-accent ${blocked ? "border-amber-400" : "border-line"}`}
              >
                <span className="mono text-xs w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center">{step.n}</span>
                <span className="mt-2 text-sm font-medium leading-tight">{step.short}</span>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {rest.map((t) => (
                    <Logo key={t.name} tool={t} size={24} />
                  ))}
                </div>
                {isChain && (
                  <div className="mt-2 flex flex-col items-center gap-0.5">
                    {chain.length > 0 ? (
                      <>
                        <span className="text-[10px] text-ink-faint">zoekketen</span>
                        {chain.map((t, k) => (
                          <div key={t.name} className="flex flex-col items-center">
                            {k > 0 && <span className="text-ink-faint text-[10px] leading-none">↓</span>}
                            <Logo tool={t} size={24} />
                          </div>
                        ))}
                      </>
                    ) : (
                      <span className="text-[11px] text-amber-800 leading-tight">geen zoekmachine: stap wordt overgeslagen</span>
                    )}
                  </div>
                )}
                {!isChain && rest.length === 0 && <span className="mt-3 text-[11px] text-amber-800 leading-tight">niets actief</span>}
              </a>
              {i < steps.length - 1 && <Arrow />}
            </div>
          );
        })}
        <Arrow />
        <Endpoint title="Tot 10 vacatures" sub="score, argument, risico" kind="out" />
      </div>
    </div>
  );
}

export function AdminFlow({ settings, ai }: { settings: SettingLite[]; ai: AiInfo | null }) {
  const byKey = new Map(settings.map((s) => [s.key, s]));
  const ctx: Ctx = {
    has: (key) => {
      const src = byKey.get(key)?.source;
      return src === "admin" || src === "env";
    },
    value: (key) => byKey.get(key)?.value,
    ai,
  };
  const steps = buildSteps(ctx);
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-3">Hoe een run loopt met deze tools</h2>
      <FlowMap steps={steps} />
      <p className="mt-2 mb-5 text-xs text-ink-faint">
        De kaart toont enkel wat nu effectief draait, in de echte volgorde. <span className="inline-block w-2.5 h-2.5 rounded-sm ring-2 ring-green-600 align-middle mx-1" />
        actief · <span className="inline-block w-2.5 h-2.5 rounded-sm ring-2 ring-accent align-middle mx-1" /> gratis zonder key. Klik op een stap voor details, testknoppen en wat je nog kan bijzetten.
      </p>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-3">Details per stap</h3>
      <ol className="relative space-y-3">
        {steps.map((step, i) => (
          <li key={step.n} id={`stap-${step.n}`} className="relative scroll-mt-4">
            <div className="border border-line rounded-lg p-4 bg-paper">
              <div className="flex items-baseline gap-3">
                <span className="mono text-xs w-6 h-6 rounded-full bg-accent text-white flex items-center justify-center shrink-0">{step.n}</span>
                <h3 className="font-medium">{step.title}</h3>
              </div>
              <p className="text-sm text-ink-soft mt-1 ml-9">{step.what}</p>
              <div className="mt-3 ml-9 flex flex-wrap gap-2">
                {step.tools.map((tool) => {
                  const st = toolStatus(tool);
                  return (
                    <span key={`${step.n}-${tool.name}`} className={`inline-flex items-center gap-2 text-xs rounded-full border px-2.5 py-1 ${st !== "off" ? "border-line bg-paper" : "border-dashed border-line bg-paper-soft text-ink-faint"}`}>
                      <Logo tool={tool} size={18} />
                      <span className={st !== "off" ? "text-ink" : ""}>{tool.name}</span>
                      {tool.note && <span className="text-ink-faint">· {tool.note}</span>}
                      <span className="text-ink-faint">· {st === "free" ? "gratis, altijd aan" : st === "on" ? "actief" : "niet actief"}</span>
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
            {i < steps.length - 1 && (
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
