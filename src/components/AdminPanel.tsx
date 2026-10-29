"use client";

import { useCallback, useEffect, useState } from "react";
import { AdminFlow } from "./AdminFlow";

type Setting = {
  key: string;
  label: string;
  help: string;
  url?: string;
  required?: boolean;
  options?: string[];
  secret: boolean;
  source: "admin" | "env" | "none";
  value?: string;
  updatedAt?: string;
  updatedBy?: string | null;
};

const GROUPS: { title: string; keys: string[] }[] = [
  { title: "AI-model (één van beide is verplicht)", keys: ["AI_PROVIDER", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENAI_MODEL_CHEAP", "OPENAI_MODEL_SCORING"] },
  { title: "Zoeken op het web (bedrijven ontdekken)", keys: ["SEARCH_PROVIDER", "LINKUP_API_KEY", "TAVILY_API_KEY", "EXA_API_KEY", "BRAVE_SEARCH_API_KEY"] },
  { title: "Vacaturebronnen", keys: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY", "JOOBLE_API_KEY"] },
  { title: "Pagina's lezen en budget", keys: ["JINA_API_KEY", "FIRECRAWL_API_KEY", "ANTHROPIC_MONTHLY_BUDGET_EUR"] },
];

export function AdminPanel({ me }: { me: string }) {
  const [settings, setSettings] = useState<Setting[] | null>(null);
  const [provider, setProvider] = useState<string>("");
  const [ai, setAi] = useState<{ provider: string; ids: string[]; auto: string | null; effective: { cheap: string; scoring: string } } | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ key: string; text: string; ok: boolean } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/admin/settings", { cache: "no-store" });
    if (!res.ok) return;
    const data = (await res.json()) as { settings: Setting[]; provider: string };
    setSettings(data.settings);
    setProvider(data.provider);
    const m = await fetch("/api/admin/openai-models", { cache: "no-store" });
    if (m.ok) setAi(await m.json());
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function save(key: string) {
    const value = drafts[key] ?? "";
    // "Automatisch" voor een OpenAI-model = de instelling wissen.
    if (key.startsWith("OPENAI_MODEL_") && value === "__auto__") return remove(key);
    setBusy(key);
    setMsg(null);
    const res = await fetch("/api/admin/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ key, value }) });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    if (!res.ok) {
      setMsg({ key, text: data.error ?? "Opslaan mislukt.", ok: false });
      return;
    }
    setDrafts((d) => ({ ...d, [key]: "" }));
    setMsg({ key, text: "Opgeslagen.", ok: true });
    await load();
  }

  async function remove(key: string) {
    setBusy(key);
    setMsg(null);
    const res = await fetch("/api/admin/settings", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ key }) });
    setBusy(null);
    if (!res.ok) {
      setMsg({ key, text: "Verwijderen mislukt.", ok: false });
      return;
    }
    setMsg({ key, text: "Verwijderd.", ok: true });
    await load();
  }

  if (!settings) return <p className="text-sm text-ink-faint">Laden…</p>;
  const byKey = new Map(settings.map((s) => [s.key, s]));

  return (
    <div className="space-y-10">
      {ai && (
        <div className="rounded-lg border border-line bg-paper-soft px-4 py-3 text-sm">
          AI: <span className="font-medium">{ai.provider === "anthropic" ? "Claude" : ai.provider === "auto" ? "OpenAI, Claude als reserve" : "OpenAI"}</span>
          {ai.provider !== "anthropic" && (
            <span className="text-ink-soft">
              {" "}
              · model <span className="mono">{ai.effective.cheap}</span>
              {ai.effective.scoring !== ai.effective.cheap && (
                <>
                  , scoring <span className="mono">{ai.effective.scoring}</span>
                </>
              )}
              {ai.ids.length === 0 && " · nog geen OpenAI-key, of de key kon geen modellen ophalen"}
            </span>
          )}
        </div>
      )}
      <div className="rounded-lg border border-line bg-paper-soft px-4 py-3 text-sm">
        Zoekmachine vooraan: <span className="font-medium">{provider}</span>
        {provider === "anthropic" && <span className="text-ink-soft"> — enkel Claude web search (±€0,01 per zoekopdracht). Vul Linkup, Tavily of Exa in om gratis te zoeken.</span>}
        {provider === "geen" && <span className="text-ink-soft"> — er is geen enkele zoekmachine ingesteld.</span>}
      </div>
      <AdminFlow settings={settings} ai={ai} />
      {GROUPS.map((g) => (
        <section key={g.title}>
          <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-3">{g.title}</h2>
          <div className="divide-y divide-line border border-line rounded-lg">
            {g.keys.map((key) => {
              const s = byKey.get(key);
              if (!s) return null;
              const draft = drafts[key] ?? "";
              return (
                <div key={key} className="p-4 flex flex-col gap-2">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium">{s.label}</span>
                    <code className="text-xs text-ink-faint">{s.key}</code>
                    <Status s={s} />
                  </div>
                  <p className="text-sm text-ink-soft">
                    {s.help}
                    {s.url && (
                      <>
                        {" "}
                        <a href={s.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                          Key aanmaken ↗
                        </a>
                      </>
                    )}
                  </p>
                  <div className="flex flex-wrap gap-2 items-center">
                    {s.key.startsWith("OPENAI_MODEL_") && ai && ai.ids.length > 0 ? (
                      <select
                        className="border border-line rounded-md px-3 py-2 text-sm bg-white mono"
                        value={draft || s.value || "__auto__"}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                      >
                        <option value="__auto__">automatisch{ai.auto ? ` (${ai.auto})` : ""}</option>
                        {ai.ids.map((id) => (
                          <option key={id} value={id}>
                            {id}
                          </option>
                        ))}
                      </select>
                    ) : s.options ? (
                      <select
                        className="border border-line rounded-md px-3 py-2 text-sm bg-white"
                        value={draft || s.value || s.options[0]}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                      >
                        {s.options.map((o) => (
                          <option key={o} value={o}>
                            {o}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type={s.secret ? "password" : "text"}
                        autoComplete="off"
                        spellCheck={false}
                        placeholder={s.secret ? (s.source === "none" ? "Plak de key" : "Plak een nieuwe key om te vervangen") : s.value ?? ""}
                        value={draft}
                        onChange={(e) => setDrafts((d) => ({ ...d, [key]: e.target.value }))}
                        className="flex-1 min-w-[240px] border border-line rounded-md px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
                      />
                    )}
                    <button
                      type="button"
                      disabled={busy === key || (!draft && !s.options && !(s.key.startsWith("OPENAI_MODEL_") && ai && ai.ids.length > 0))}
                      onClick={() => save(key)}
                      className="text-sm rounded-md px-3 py-2 bg-accent text-white disabled:opacity-40"
                    >
                      Opslaan
                    </button>
                    {s.source === "admin" && (
                      <button type="button" disabled={busy === key} onClick={() => remove(key)} className="text-sm rounded-md px-3 py-2 border border-line hover:bg-paper-soft">
                        Verwijderen
                      </button>
                    )}
                    {msg?.key === key && <span className={`text-sm ${msg.ok ? "text-green-700" : "text-red-700"}`}>{msg.text}</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      ))}
      <p className="text-xs text-ink-faint">Aangemeld als {me}. Iedereen die aangemeld is kan hier keys plakken of vervangen; opgeslagen keys worden nooit getoond. Wijzig je APP_PASSWORD in Vercel, dan moeten de keys opnieuw ingevuld worden.</p>
    </div>
  );
}

function Status({ s }: { s: Setting }) {
  if (s.source === "admin") {
    const when = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString("nl-BE") : "";
    return (
      <span className="text-xs rounded-full px-2 py-0.5 bg-green-50 text-green-800">
        ingesteld{s.updatedBy ? ` door ${s.updatedBy}` : ""}
        {when ? ` · ${when}` : ""}
      </span>
    );
  }
  if (s.source === "env") return <span className="text-xs rounded-full px-2 py-0.5 bg-blue-50 text-blue-800">uit Vercel-omgeving</span>;
  return <span className={`text-xs rounded-full px-2 py-0.5 ${s.required ? "bg-red-50 text-red-800" : "bg-paper-soft text-ink-faint"}`}>{s.required ? "ontbreekt" : "niet ingesteld"}</span>;
}
