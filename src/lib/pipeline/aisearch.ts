/**
 * Spoor D: OpenAI Web Search (Responses API, tool `web_search`) als aanvullende, iteratieve vacaturezoeker.
 *
 * Werkt in rondes: ronde 1 zoekt gericht op het profiel; elke volgende ronde krijgt te zien wat al gevonden
 * is en welke zoekopdrachten al gebeurden, en moet nieuwe functietitels, gemeenten of sectoren onderzoeken.
 * Stopt bij genoeg unieke resultaten, het maximum aantal rondes, het kostenplafond of de tijdslimiet.
 *
 * Een zoekresultaat is geen geverifieerde vacature: alles gaat daarna door dezelfde dedup, verificatie
 * en scoring als de andere bronnen. Een fout of time-out hier blokkeert de andere bronnen nooit.
 * Dezelfde OpenAI-key als de rest van Matchr; geen tweede key.
 */
import { z } from "zod";
import { getSetting } from "@/lib/settings";
import { resolveOpenAIModel } from "@/lib/openaiModels";
import { fetchRaw } from "@/lib/fetch";
import { redactSecrets } from "@/lib/redact";
import { countCall, noteFailure } from "@/lib/usage";
import { isAgencyDomain } from "@/lib/blocklist";
import type { NormalizedJob, Profile } from "./types";

export type AiSearchConfig = { enabled: boolean; rounds: number; maxCostEur: number; model: string | null; hasKey: boolean };

export async function aiSearchConfig(): Promise<AiSearchConfig> {
  const key = await getSetting("OPENAI_API_KEY");
  const enabledRaw = (await getSetting("OPENAI_WEBSEARCH_ENABLED")) ?? "1";
  const rounds = Number(await getSetting("OPENAI_WEBSEARCH_ROUNDS"));
  const maxCost = Number(await getSetting("OPENAI_WEBSEARCH_MAX_EUR"));
  const chosen = (await getSetting("OPENAI_WEBSEARCH_MODEL"))?.trim();
  const model = key ? (chosen && /^[a-z0-9][a-z0-9.:_-]{1,63}$/i.test(chosen) && !/^sk-/.test(chosen) ? chosen : await resolveOpenAIModel("cheap").catch(() => null)) : null;
  return {
    enabled: enabledRaw !== "0" && Boolean(key),
    rounds: Number.isFinite(rounds) && rounds >= 1 && rounds <= 5 ? Math.round(rounds) : 3,
    maxCostEur: Number.isFinite(maxCost) && maxCost > 0 ? Math.min(maxCost, 2) : 0.15,
    model,
    hasKey: Boolean(key),
  };
}

const USD_TO_EUR = 0.92;
/** Kost per web_search-aanroep (OpenAI-prijslijst: $10 per 1.000 zoekacties). */
const SEARCH_CALL_USD = 0.01;
function tokenPrice(model: string): { input: number; output: number } {
  if (/nano/i.test(model)) return { input: 0.2, output: 1.25 };
  if (/mini/i.test(model)) return { input: 0.75, output: 4.5 };
  return { input: 2.5, output: 15 };
}

export const AiVacancySchema = z.object({
  vacancies: z.array(
    z.object({
      title: z.string(),
      company: z.string(),
      location: z.string(),
      url: z.string(),
      contract: z.enum(["vast", "tijdelijk", "interim", "freelance", "onbekend"]),
      employer_status: z.enum(["rechtstreeks", "tussenpersoon", "onbekend"]),
      evidence: z.string(),
    }),
  ),
  explored: z.object({ titles: z.array(z.string()), municipalities: z.array(z.string()) }),
});
export type AiVacancies = z.infer<typeof AiVacancySchema>;

const JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["vacancies", "explored"],
  properties: {
    vacancies: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "company", "location", "url", "contract", "employer_status", "evidence"],
        properties: {
          title: { type: "string" },
          company: { type: "string", description: "Naam van de eindwerkgever; leeg als onbekend" },
          location: { type: "string", description: "Gemeente van de werkplek; leeg als onbekend" },
          url: { type: "string", description: "Directe link naar de vacaturepagina (geen zoek- of lijstpagina)" },
          contract: { type: "string", enum: ["vast", "tijdelijk", "interim", "freelance", "onbekend"] },
          employer_status: { type: "string", enum: ["rechtstreeks", "tussenpersoon", "onbekend"] },
          evidence: { type: "string", description: "Korte samenvatting van wat op de pagina staat (taken, eisen)" },
        },
      },
    },
    explored: {
      type: "object",
      additionalProperties: false,
      required: ["titles", "municipalities"],
      properties: { titles: { type: "array", items: { type: "string" } }, municipalities: { type: "array", items: { type: "string" } } },
    },
  },
} as const;

const INSTRUCTIONS = `Je bent een ervaren Vlaamse recruiter die op het web actuele vacatures zoekt voor één kandidaat.
Zoek zelf, met meerdere gerichte zoekopdrachten, naar OPEN vacatures in België bij RECHTSTREEKSE werkgevers:
- publieke vacatures op VDAB (vdab.be/vindeenjob/vacatures/...), Google-geïndexeerde vacatures,
- jobpagina's op bedrijfswebsites en publieke ATS-pagina's (Recruitee, Teamtailor, Jobtoolz, SmartRecruiters, Lever, Greenhouse, Workday),
- ook onder verwante functietitels die realistisch passen bij de ervaring (geen onrealistische sprongen),
- ook bij bedrijven in omliggende gemeenten binnen de straal.
Regels:
- Enkel vacatures waarvan de werkplek binnen de straal rond de regio ligt.
- Geef per vacature de directe vacature-URL die je zelf in de zoekresultaten zag. Verzin nooit een URL, werkgever of contract.
- Geen interim-, uitzend-, recruitment-, selectie-, consultancy- of detacheringskantoren. Twijfel je over de werkgever: employer_status "onbekend".
- contract enkel invullen als het er staat; anders "onbekend".
- Geen zoek- of overzichtspagina's, geen LinkedIn-feeds, geen verlopen vacatures.
- Antwoord uitsluitend met het gevraagde JSON-object.`;

type ResponsesOutput = {
  output?: {
    type?: string;
    action?: { type?: string; query?: string; queries?: string[] };
    content?: { type?: string; text?: string }[];
  }[];
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
  error?: { message?: string } | null;
};

/** Eén Responses-aanroep. Injecteerbaar voor tests (geen API-kosten). */
export type ResponsesCaller = (body: Record<string, unknown>, timeoutMs: number) => Promise<{ status: number; data: ResponsesOutput | null }>;

async function defaultCaller(body: Record<string, unknown>, timeoutMs: number) {
  const key = await getSetting("OPENAI_API_KEY");
  if (!key) return { status: 401, data: null };
  const r = await fetchRaw(
    "https://api.openai.com/v1/responses",
    { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify(body) },
    timeoutMs,
  );
  let data: ResponsesOutput | null = null;
  try {
    data = JSON.parse(r.body) as ResponsesOutput;
  } catch {
    data = null;
  }
  return { status: r.status, data };
}

function outputText(d: ResponsesOutput): string {
  if (d.output_text) return d.output_text;
  return (d.output ?? [])
    .flatMap((o) => o.content ?? [])
    .filter((c) => c.type === "output_text" && c.text)
    .map((c) => c.text)
    .join("\n");
}

export function parseAiVacancies(text: string): AiVacancies | null {
  const tryParse = (s: string) => {
    try {
      const r = AiVacancySchema.safeParse(JSON.parse(s));
      return r.success ? r.data : null;
    } catch {
      return null;
    }
  };
  return tryParse(text) ?? (text.match(/\{[\s\S]*\}/) ? tryParse(text.match(/\{[\s\S]*\}/)![0]) : null);
}

/** Concrete vacaturelink? Geen homepage, geen zoek- of lijstpagina. */
export function isConcreteJobUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (!/^https?:$/.test(u.protocol)) return false;
  if (/(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com)$/i.test(u.hostname)) return false;
  if (/linkedin\.com$/i.test(u.hostname) && !/\/jobs\/view\//.test(u.pathname)) return false;
  const depth = u.pathname.split("/").filter(Boolean).length;
  if (depth === 0) return false;
  if (/\/(zoeken|search|zoek|resultaten|results)(\/|$)/i.test(u.pathname) || /[?&](q|query|keywords?)=/i.test(u.search)) return false;
  return true;
}

function profileForSearch(profile: Profile) {
  return {
    gewenste_functies: profile.job_titles,
    alternatieve_functietitels: profile.related_titles ?? [],
    synoniemen_en_fr: profile.title_variants ?? [],
    kerntaken_en_vaardigheden: profile.skill_keywords ?? [],
    vaardigheden: profile.skills.slice(0, 15),
    jaren_ervaring: profile.years_experience,
    sectoren: profile.sectors,
    regio: profile.region,
    maximale_afstand_km: profile.radius_km,
    omliggende_gemeenten: profile.nearby_municipalities ?? [],
    soorten_werkgevers: profile.company_types ?? [],
    uitsluitingen: profile.exclusions,
    harde_vereisten: profile.hard_requirements ?? [],
  };
}

export type AiSearchResult = {
  jobs: NormalizedJob[];
  rounds: number;
  searches: number;
  raw: number;
  costEur: number;
  durationMs: number;
  model: string | null;
  queries: string[];
  error?: string;
  skipped?: string;
};

/**
 * Iteratief zoeken. Stopt bij: `targetUnique` unieke vacatures, maximum rondes, kostenplafond of deadline.
 * Een ronde die weinig oplevert leidt tot een andere strategie in de volgende ronde, niet tot een stop.
 */
export async function searchOpenAIJobs(
  profile: Profile,
  opts: { call?: ResponsesCaller; config?: AiSearchConfig; deadlineMs?: number; targetUnique?: number } = {},
): Promise<AiSearchResult> {
  const started = Date.now();
  const cfg = opts.config ?? (await aiSearchConfig());
  const base: AiSearchResult = { jobs: [], rounds: 0, searches: 0, raw: 0, costEur: 0, durationMs: 0, model: cfg.model, queries: [] };
  if (!cfg.hasKey) return { ...base, skipped: "geen OpenAI-key" };
  if (!cfg.enabled) return { ...base, skipped: "uitgeschakeld in Instellingen" };
  if (!cfg.model) return { ...base, skipped: "geen OpenAI-model gevonden" };
  const call = opts.call ?? defaultCaller;
  const deadline = started + (opts.deadlineMs ?? 110_000);
  const target = opts.targetUnique ?? 30;
  const byKey = new Map<string, NormalizedJob>();
  const queries: string[] = [];
  const exploredTitles = new Set<string>();
  const exploredPlaces = new Set<string>();
  let lastNew = -1;
  let cost = 0;
  let searches = 0;
  let raw = 0;
  let rounds = 0;
  let error: string | undefined;
  let useReasoning = /^(gpt-5|o\d)/i.test(cfg.model);

  for (let round = 1; round <= cfg.rounds; round++) {
    const remaining = deadline - Date.now();
    if (remaining < 20_000) break;
    if (cost >= cfg.maxCostEur) break;
    if (byKey.size >= target) break;
    const found = Array.from(byKey.values()).slice(0, 60).map((j) => `${j.title} — ${j.companyName || "?"} — ${j.location || "?"}`);
    const steer =
      round === 1
        ? "Ronde 1: begin met de gewenste functies in de regio en de omliggende gemeenten."
        : `Ronde ${round}. Al gevonden (${byKey.size}):\n${found.join("\n") || "(niets)"}\n\nAl uitgevoerde zoekopdrachten:\n${queries.slice(-25).join("\n") || "(geen)"}\n\nAl onderzocht: functietitels [${Array.from(exploredTitles).join(", ")}], gemeenten [${Array.from(exploredPlaces).join(", ")}].\n` +
          (lastNew <= 2
            ? "De vorige ronde leverde weinig op. Verander van strategie: zoek op verwante functietitels, op sectoren en concrete bedrijven in de omliggende gemeenten, en op hun eigen jobpagina's of ATS-pagina's."
            : "Onderzoek nu functietitels, gemeenten en sectoren die nog niet aan bod kwamen.") +
          " Herhaal geen eerdere zoekopdrachten en geef enkel NIEUWE vacatures terug.";
    const body: Record<string, unknown> = {
      model: cfg.model,
      instructions: INSTRUCTIONS,
      input: `Kandidaatprofiel:\n${JSON.stringify(profileForSearch(profile), null, 1)}\n\n${steer}`,
      tools: [{ type: "web_search", user_location: { type: "approximate", country: "BE", timezone: "Europe/Brussels" } }],
      tool_choice: "required",
      text: { format: { type: "json_schema", name: "vacatures", strict: true, schema: JSON_SCHEMA } },
      max_output_tokens: 6000,
    };
    if (useReasoning) body.reasoning = { effort: "low" };
    countCall("openai_websearch");
    let res = await call(body, Math.min(110_000, remaining - 5_000)).catch(() => ({ status: 0, data: null }));
    if (res.status === 400 && useReasoning) {
      useReasoning = false;
      delete body.reasoning;
      res = await call(body, Math.min(110_000, deadline - Date.now() - 5_000)).catch(() => ({ status: 0, data: null }));
    }
    rounds += 1;
    if (res.status !== 200 || !res.data) {
      error = res.status === 0 ? "geen antwoord binnen de tijdslimiet" : redactSecrets(res.data?.error?.message ?? `HTTP ${res.status}`).slice(0, 160);
      break;
    }
    const d = res.data;
    const calls = (d.output ?? []).filter((o) => o.type === "web_search_call");
    searches += calls.length;
    for (const c of calls) {
      for (const q of [c.action?.query, ...(c.action?.queries ?? [])]) if (q && !queries.includes(q)) queries.push(q);
    }
    cost +=
      (((d.usage?.input_tokens ?? 0) / 1e6) * tokenPrice(cfg.model).input + ((d.usage?.output_tokens ?? 0) / 1e6) * tokenPrice(cfg.model).output + calls.length * SEARCH_CALL_USD) *
      USD_TO_EUR;
    const parsed = parseAiVacancies(outputText(d));
    if (!parsed) {
      lastNew = 0;
      continue;
    }
    parsed.explored.titles.forEach((t) => exploredTitles.add(t));
    parsed.explored.municipalities.forEach((m) => exploredPlaces.add(m));
    let added = 0;
    for (const v of parsed.vacancies) {
      raw += 1;
      const url = v.url.trim();
      if (!v.title.trim() || !isConcreteJobUrl(url) || isAgencyDomain(url)) continue;
      const k1 = url.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
      const k2 = `${v.title.toLowerCase().trim()}|${v.company.toLowerCase().trim()}`;
      if (byKey.has(k1) || (v.company.trim() && byKey.has(k2))) continue;
      const job: NormalizedJob = {
        source: "openai_web",
        url,
        title: v.title.trim().slice(0, 300),
        location: v.location.trim(),
        descriptionText: v.evidence.trim().slice(0, 1500),
        companyName: v.company.trim(),
        raw: { via: "openai_websearch", round, contract_hint: v.contract, employer_hint: v.employer_status },
      };
      byKey.set(k1, job);
      if (v.company.trim()) byKey.set(k2, job);
      added += 1;
    }
    lastNew = added;
  }
  const jobs = Array.from(new Set(byKey.values()));
  if (error) noteFailure(`OpenAI Web Search: ${error}; de andere bronnen liepen door.`);
  return { jobs, rounds, searches, raw, costEur: cost, durationMs: Date.now() - started, model: cfg.model, queries, error };
}
