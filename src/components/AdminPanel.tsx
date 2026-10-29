"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminFlow, type AiInfo } from "./AdminFlow";

type Setting = { key: string; source: "admin" | "env" | "none"; value?: string; updatedAt?: string; updatedBy?: string | null };

type ToolRow = {
  id: string;
  name: string;
  domain: string;
  what: string;
  /** Eén of meer key-velden (Adzuna heeft er twee). */
  fields: { key: string; label?: string }[];
  url: string;
  test?: string;
  required?: boolean;
};

/** De tools die je in Matchr zelf beheert. Eén regel per tool. */
const TOOLS: ToolRow[] = [
  { id: "openai", name: "OpenAI", domain: "openai.com", what: "De AI: leest het cv, leest vacatures uit en scoort ze.", fields: [{ key: "OPENAI_API_KEY" }], url: "https://platform.openai.com/api-keys", test: "openai", required: true },
  { id: "serper", name: "Serper (Google + Google Maps)", domain: "serper.dev", what: "Google en Google Maps: vindt lokale werkgevers met hun website. Sterkste bron, 2.500 gratis.", fields: [{ key: "SERPER_API_KEY" }], url: "https://serper.dev/api-keys", test: "serper" },
  { id: "serpapi", name: "SerpApi (Google Jobs)", domain: "serpapi.com", what: "Vacatures die Google van alle sites verzamelt. Gratis ±100–250 per maand.", fields: [{ key: "SERPAPI_API_KEY" }], url: "https://serpapi.com/manage-api-key", test: "googlejobs" },
  { id: "linkup", name: "Linkup", domain: "linkup.so", what: "Reserve-zoekmachine als Serper op is. Gratis.", fields: [{ key: "LINKUP_API_KEY" }], url: "https://app.linkup.so/api-keys", test: "linkup" },
  { id: "tavily", name: "Tavily", domain: "tavily.com", what: "Reserve-zoekmachine als Linkup op is. Gratis.", fields: [{ key: "TAVILY_API_KEY" }], url: "https://app.tavily.com", test: "tavily" },
  { id: "exa", name: "Exa", domain: "exa.ai", what: "Tweede reserve-zoekmachine. Gratis.", fields: [{ key: "EXA_API_KEY" }], url: "https://dashboard.exa.ai/api-keys", test: "exa" },
  { id: "jooble", name: "Jooble", domain: "jooble.org", what: "Vacaturebank. Key per mail na aanvraag op be.jooble.org.", fields: [{ key: "JOOBLE_API_KEY" }], url: "https://be.jooble.org/api/about", test: "jooble" },
  { id: "adzuna", name: "Adzuna", domain: "adzuna.be", what: "Vacaturebank. Heeft een app-ID én een key.", fields: [{ key: "ADZUNA_APP_ID", label: "App-ID" }, { key: "ADZUNA_APP_KEY", label: "Key" }], url: "https://developer.adzuna.com/admin/access_details", test: "adzuna" },
  { id: "firecrawl", name: "Firecrawl", domain: "firecrawl.dev", what: "Leest jobsites die anders leeg lijken. Gratis tot 1.000 per maand.", fields: [{ key: "FIRECRAWL_API_KEY" }], url: "https://www.firecrawl.dev/app/api-keys", test: "firecrawl" },
];

type Test = { ok: boolean; ms: number; count?: number; error?: string } | "busy";

export function AdminPanel({ me }: { me: string }) {
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [ai, setAi] = useState<AiInfo | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/settings", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { settings: Setting[] };
    setSettings(data.settings);
    const m = await fetch("/api/admin/openai-models", { cache: "no-store" });
    if (m.ok) setAi(await m.json());
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  if (!settings) return <p className="text-sm text-ink-faint">Laden…</p>;
  const byKey = new Map(settings.map((s) => [s.key, s]));

  return (
    <div className="space-y-10">
      <section>
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-3">Tools en keys</h2>
        <div className="divide-y divide-line border border-line rounded-xl bg-paper">
          {TOOLS.map((tool) => (
            <ToolLine key={tool.id} tool={tool} byKey={byKey} onChanged={load} />
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-faint">
          Keys worden versleuteld opgeslagen en nooit meer getoond. Iedereen die aangemeld is kan ze vervangen. Aangemeld als {me}.
        </p>
      </section>
      <ThresholdLine current={byKey.get("MIN_SCORE")?.value} onChanged={load} />
      <WebSearchSection byKey={byKey} model={ai?.effective.cheap} onChanged={load} />
      <AdminFlow settings={settings} ai={ai} />
    </div>
  );
}

/** OpenAI Web Search: gebruikt de gedeelde OpenAI-key, geen eigen key-veld. */
function WebSearchSection({ byKey, model, onChanged }: { byKey: Map<string, Setting>; model?: string; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<(Test & { sample?: string[] }) | null>(null);
  const [cost, setCost] = useState<string | null>(null);
  const hasKey = ["admin", "env"].includes(byKey.get("OPENAI_API_KEY")?.source ?? "none");
  const enabled = byKey.get("OPENAI_WEBSEARCH_ENABLED")?.value !== "0";
  const rounds = byKey.get("OPENAI_WEBSEARCH_ROUNDS")?.value || "3";
  const maxEur = byKey.get("OPENAI_WEBSEARCH_MAX_EUR")?.value || "0.15";
  const chosenModel = byKey.get("OPENAI_WEBSEARCH_MODEL")?.value || model;

  async function put(key: string, value: string) {
    setBusy(true);
    await fetch("/api/admin/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value }) });
    setBusy(false);
    await onChanged();
  }
  async function runTest() {
    setTest("busy");
    try {
      const res = await fetch("/api/admin/test?tool=openai-jobs", { cache: "no-store" });
      const data = (await res.json()) as Test & { sample?: string[] };
      setTest(res.ok ? data : { ok: false, ms: 0, error: (data as { error?: string }).error ?? `HTTP ${res.status}` });
    } catch {
      setTest({ ok: false, ms: 0, error: "netwerkfout" });
    }
  }
  const status = !hasKey ? "niet beschikbaar (geen OpenAI-key)" : !enabled ? "uitgeschakeld" : test && test !== "busy" && !test.ok ? "fout" : "actief";
  const dot = status === "actief" ? "bg-green-600" : status === "fout" ? "bg-red-600" : "bg-gray-300";
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-3">OpenAI Web Search</h2>
      <div className="border border-line rounded-xl bg-paper p-4 space-y-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden />
          <span className="font-medium">Status: {status}</span>
          <span className="text-ink-soft">· key: de gedeelde OpenAI-key · model: <span className="mono">{chosenModel ?? "—"}</span></span>
        </div>
        <p className="text-ink-soft">
          Zoekt zelf in rondes naar vacatures (VDAB, bedrijfssites, ATS-pagina&apos;s, verwante titels, omliggende gemeenten) en stuurt bij op wat nog ontbreekt. Alles wat het vindt gaat door dezelfde controle en scoring.
        </p>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={enabled} disabled={busy || !hasKey} onChange={(e) => put("OPENAI_WEBSEARCH_ENABLED", e.target.checked ? "1" : "0")} />
            Ingeschakeld
          </label>
          <label className="flex items-center gap-2">
            Zoekrondes
            <select value={rounds} disabled={busy} onChange={(e) => put("OPENAI_WEBSEARCH_ROUNDS", e.target.value)} className="border border-line rounded-md px-2 py-1 bg-white">
              {["1", "2", "3", "4", "5"].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            Max kosten per run €
            <input
              inputMode="decimal"
              defaultValue={maxEur}
              onChange={(e) => setCost(e.target.value)}
              onBlur={() => {
                const v = (cost ?? "").replace(",", ".").trim();
                if (v && /^\d+(\.\d+)?$/.test(v) && Number(v) > 0 && Number(v) <= 2) void put("OPENAI_WEBSEARCH_MAX_EUR", v);
              }}
              className="w-20 border border-line rounded-md px-2 py-1 bg-white mono"
            />
          </label>
          <button type="button" onClick={runTest} disabled={!hasKey || test === "busy"} className="border border-line rounded-md px-3 py-1 hover:bg-paper-soft disabled:opacity-50">
            {test === "busy" ? "Testen… (tot 1 min)" : "Testen"}
          </button>
        </div>
        {test && test !== "busy" && (
          <div className={test.ok ? "text-ok" : "text-warn"}>
            {test.ok ? `Werkt · ${test.count ?? 0} vacatures in ${Math.round(test.ms / 1000)} s` : `Fout: ${test.error ?? "onbekend"}`}
            {test.sample?.length ? (
              <ul className="mt-1 text-xs text-ink-soft">
                {test.sample.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function ThresholdLine({ current, onChanged }: { current?: string; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const value = current && /^\d+$/.test(current) ? current : "6";
  async function change(v: string) {
    setBusy(true);
    await fetch("/api/admin/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: "MIN_SCORE", value: v }) });
    setBusy(false);
    await onChanged();
  }
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-3">Matching</h2>
      <div className="border border-line rounded-xl bg-paper p-4 flex flex-wrap items-center gap-3">
        <label htmlFor="min-score" className="font-medium">
          Matchdrempel
        </label>
        <select id="min-score" value={value} disabled={busy} onChange={(e) => change(e.target.value)} className="border border-line rounded-md px-2 py-1.5 text-sm bg-white">
          {["4", "5", "6", "7", "8"].map((v) => (
            <option key={v} value={v}>
              {v}/10
            </option>
          ))}
        </select>
        <span className="text-sm text-ink-soft">Vacatures onder deze score worden niet getoond. Standaard 6.</span>
      </div>
    </section>
  );
}

function ToolLine({ tool, byKey, onChanged }: { tool: ToolRow; byKey: Map<string, Setting>; onChanged: () => Promise<void> }) {
  const isSet = (k: string) => {
    const src = byKey.get(k)?.source;
    return src === "admin" || src === "env";
  };
  const allSet = tool.fields.every((f) => isSet(f.key));
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [test, setTest] = useState<Test | null>(null);
  const [logoFailed, setLogoFailed] = useState(false);
  const open = editing || !allSet;

  async function runTest() {
    if (!tool.test) return;
    setTest("busy");
    try {
      const res = await fetch(`/api/admin/test?tool=${tool.test}`, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; ms: number; count?: number; error?: string };
      setTest(res.ok ? data : { ok: false, ms: 0, error: data.error ?? `HTTP ${res.status}` });
    } catch {
      setTest({ ok: false, ms: 0, error: "netwerkfout" });
    }
  }

  async function save() {
    setBusy(true);
    setError(null);
    for (const f of tool.fields) {
      const value = (drafts[f.key] ?? "").trim();
      if (!value) continue;
      const res = await fetch("/api/admin/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key: f.key, value }) });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Opslaan mislukt.");
        setBusy(false);
        return;
      }
    }
    setDrafts({});
    setEditing(false);
    setBusy(false);
    await onChanged();
    void runTest();
  }

  const hasDraft = tool.fields.some((f) => (drafts[f.key] ?? "").trim());
  const status = allSet ? (test && test !== "busy" && !test.ok ? "fout" : "ok") : tool.required ? "nodig" : "uit";
  const dot = { ok: "bg-green-600", fout: "bg-red-600", nodig: "bg-amber-500", uit: "bg-gray-300" }[status];
  const label = { ok: "ingesteld", fout: "werkt niet", nodig: "nodig", uit: "niet ingesteld" }[status];

  return (
    <div className="p-4">
      <div className="flex items-center gap-3">
        <span className="w-9 h-9 rounded-lg border border-line bg-white flex items-center justify-center shrink-0">
          {!logoFailed ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={`https://www.google.com/s2/favicons?domain=${tool.domain}&sz=64`} alt="" width={22} height={22} onError={() => setLogoFailed(true)} referrerPolicy="no-referrer" />
          ) : (
            <span className="mono text-xs font-semibold text-ink-soft">{tool.name.slice(0, 2)}</span>
          )}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="font-medium">{tool.name}</span>
            <span className={`w-2 h-2 rounded-full ${dot}`} aria-hidden />
            <span className="text-xs text-ink-soft">{label}</span>
          </div>
          <p className="text-sm text-ink-soft">{tool.what}</p>
        </div>
        <div className="flex items-center gap-3 shrink-0 text-sm">
          {allSet && tool.test && (
            <button type="button" onClick={runTest} disabled={test === "busy"} className="text-accent hover:underline disabled:opacity-50">
              {test === "busy" ? "testen…" : "test"}
            </button>
          )}
          {allSet && !editing && (
            <button type="button" onClick={() => setEditing(true)} className="text-ink-soft hover:text-ink">
              vervangen
            </button>
          )}
          <a href={tool.url} target="_blank" rel="noreferrer" className="text-ink-soft hover:text-ink">
            key halen ↗
          </a>
        </div>
      </div>

      {test && test !== "busy" && (
        <p className={`mt-2 ml-12 text-xs ${test.ok ? "text-green-700" : "text-red-700"}`}>
          {test.ok ? `Werkt · ${(test.ms / 1000).toFixed(1)} s${test.count && test.count > 1 ? ` · ${test.count} resultaten` : ""}` : `Werkt niet: ${test.error ?? "onbekende fout"}`}
        </p>
      )}

      {open && (
        <div className="mt-3 ml-12 flex flex-wrap items-center gap-2">
          {tool.fields.map((f) => (
            <input
              key={f.key}
              type="password"
              autoComplete="off"
              spellCheck={false}
              aria-label={`${tool.name} ${f.label ?? "key"}`}
              placeholder={`Plak de ${tool.name}${f.label ? ` ${f.label.toLowerCase()}` : "-key"}`}
              value={drafts[f.key] ?? ""}
              onChange={(e) => setDrafts((d) => ({ ...d, [f.key]: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && hasDraft) void save();
              }}
              className="flex-1 min-w-[220px] border border-line rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
            />
          ))}
          <button type="button" onClick={save} disabled={busy || !hasDraft} className="text-sm rounded-md px-3 py-2 bg-accent text-white disabled:opacity-40">
            {busy ? "Opslaan…" : "Opslaan"}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setDrafts({});
                setError(null);
              }}
              className="text-sm text-ink-soft hover:text-ink px-2"
            >
              annuleren
            </button>
          )}
        </div>
      )}
      {error && <p className="mt-2 ml-12 text-sm text-red-700">{error}</p>}
    </div>
  );
}
