/**
 * Dunne laag rond de Anthropic SDK: gestructureerde JSON-output via Zod,
 * kostentelling per aanroep, en één plek voor modelkeuze.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { z as zod } from "zod";
import { resolveOpenAIModel } from "@/lib/openaiModels";
import { redactSecrets } from "@/lib/redact";
import { countCall } from "@/lib/usage";
import { MODELS, PRICES_USD_PER_MTOK, USD_TO_EUR } from "@/lib/config";
import { getSetting } from "@/lib/settings";

let _client: { key: string; client: Anthropic } | null = null;
async function client(): Promise<Anthropic> {
  const key = await getSetting("ANTHROPIC_API_KEY");
  if (!key) throw new Error("Anthropic API-key ontbreekt. Vul ze in via /admin.");
  if (!_client || _client.key !== key) _client = { key, client: new Anthropic({ apiKey: key, maxRetries: 2, timeout: 60_000 }) };
  return _client.client;
}

/**
 * Prijs per miljoen tokens. Exacte match uit de tabel, anders op modelfamilie (mini, nano, luna),
 * anders een voorzichtige standaard zodat de schatting eerder te hoog dan te laag is.
 */
export function priceFor(model: string): { input: number; output: number } {
  if (PRICES_USD_PER_MTOK[model]) return PRICES_USD_PER_MTOK[model];
  if (/-nano\b/.test(model)) return { input: 0.05, output: 0.4 };
  if (/-(mini|luna)\b/.test(model)) return { input: 0.25, output: 2 };
  if (/haiku/.test(model)) return { input: 1, output: 5 };
  return { input: 2, output: 10 };
}

/** Houdt de kosten van één run bij, in euro. */
export class CostMeter {
  eur = 0;
  calls = 0;
  add(model: string, inputTokens: number, outputTokens: number) {
    const p = priceFor(model);
    const usd = (inputTokens / 1e6) * p.input + (outputTokens / 1e6) * p.output;
    this.eur += usd * USD_TO_EUR;
    this.calls += 1;
  }
  /** Brave-query: de gratis tier kost niets, maar we registreren ze voor de maandteller. */
  addBrave(n = 1) {
    void n;
  }
}

export type LlmOptions<T extends z.ZodTypeAny> = {
  model?: keyof typeof MODELS;
  system: string;
  user: string;
  schema: T;
  maxTokens?: number;
  effort?: "low" | "medium" | "high";
  meter: CostMeter;
};

/**
 * Eén gestructureerde aanroep. Gooit een fout als het model geen geldige JSON
 * terugstuurt of de vraag weigert; de aanroeper beslist wat daarmee gebeurt.
 */
export async function llmJson<T extends z.ZodTypeAny>(opts: LlmOptions<T>): Promise<z.infer<T>> {
  // Standaard enkel OpenAI; Claude enkel als je dat in Instellingen kiest (anthropic of auto).
  const choice = (await getSetting("AI_PROVIDER")) ?? "openai";
  const hasClaude = Boolean(await getSetting("ANTHROPIC_API_KEY"));
  const hasOpenAI = Boolean(await getSetting("OPENAI_API_KEY"));
  if (choice === "openai") return openaiJson(opts);
  if (choice === "anthropic" || !hasOpenAI) return anthropicJson(opts);
  // auto met beide keys: OpenAI eerst, Claude als reserve (tegoed op, key ongeldig, overbelast).
  if (!hasClaude) return openaiJson(opts);
  if (openaiDownUntil > Date.now()) return anthropicJson(opts);
  try {
    return await openaiJson(opts);
  } catch (e) {
    if (isProviderUnavailable(e)) {
      openaiDownUntil = Date.now() + 15 * 60 * 1000;
      console.warn("[llm] OpenAI onbruikbaar, overgeschakeld naar Claude.");
      return anthropicJson(opts);
    }
    throw e;
  }
}

let openaiDownUntil = 0;

function isProviderUnavailable(e: unknown): boolean {
  const status = (e as { status?: number }).status;
  const msg = e instanceof Error ? e.message.toLowerCase() : String(e).toLowerCase();
  return status === 401 || status === 402 || status === 403 || status === 429 || status === 529 || /credit balance|billing|insufficient|quota|overloaded|api-key ontbreekt|geen openai-key/.test(msg);
}

async function anthropicJson<T extends z.ZodTypeAny>(opts: LlmOptions<T>): Promise<z.infer<T>> {
  countCall("claude");
  const model = MODELS[opts.model ?? "cheap"];
  const res = await (await client()).messages.parse({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    messages: [{ role: "user", content: opts.user }],
    output_config: { effort: opts.effort ?? "low", format: zodOutputFormat(opts.schema) },
  });
  opts.meter.add(model, res.usage.input_tokens + (res.usage.cache_read_input_tokens ?? 0), res.usage.output_tokens);
  if (res.stop_reason === "refusal") throw new Error("Het model weigerde deze aanvraag.");
  if (!res.parsed_output) throw new Error("Het model gaf geen geldige gestructureerde output.");
  return res.parsed_output as z.infer<T>;
}

type OpenAIChat = {
  choices?: { message?: { content?: string | null; refusal?: string | null } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
  error?: { message?: string };
};

/**
 * OpenAI Chat Completions met een JSON-schema afgeleid van hetzelfde Zod-schema.
 * Niet-strikt (onze schema's gebruiken min/max), daarom valideren we zelf en proberen we één keer opnieuw.
 */
async function openaiJson<T extends z.ZodTypeAny>(opts: LlmOptions<T>): Promise<z.infer<T>> {
  const key = await getSetting("OPENAI_API_KEY");
  if (!key) throw new Error("Er is nog geen OpenAI-key ingesteld. Plak ze in Instellingen (rechtsboven) en start de run opnieuw");
  const model = await resolveOpenAIModel(opts.model === "scoring" ? "scoring" : "cheap");
  countCall("openai");
  const jsonSchema = zod.toJSONSchema(opts.schema as unknown as zod.ZodType) as Record<string, unknown>;
  delete jsonSchema.$schema;
  const reasoning = /^(gpt-5|o\d)/.test(model);
  const messages: { role: string; content: string }[] = [
    { role: reasoning ? "developer" : "system", content: `${opts.system}\n\nAntwoord uitsluitend met JSON volgens het gevraagde schema.` },
    { role: "user", content: opts.user },
  ];

  // Wat een model niet ondersteunt, laten we bij de volgende poging weg (oudere/nieuwere modellen verschillen).
  let useReasoning = reasoning;
  let useSchema = true;
  for (let attempt = 0; attempt < 4; attempt++) {
    const body: Record<string, unknown> = {
      model,
      messages,
      response_format: useSchema ? { type: "json_schema", json_schema: { name: "matchr_output", schema: jsonSchema, strict: false } } : { type: "json_object" },
      // Redeneermodellen gebruiken een deel van het budget om te denken; ruimer zetten.
      max_completion_tokens: (opts.maxTokens ?? 4096) * (useReasoning ? 4 : 1),
    };
    if (useReasoning) body.reasoning_effort = opts.effort === "medium" ? "medium" : "low";
    if (!useSchema) messages[0] = { ...messages[0], content: `${opts.system}\n\nAntwoord uitsluitend met JSON volgens dit schema:\n${JSON.stringify(jsonSchema).slice(0, 6000)}` };
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as OpenAIChat;
    if (!res.ok) {
      const m = (data.error?.message ?? "").toLowerCase();
      if (res.status === 400 && useReasoning && /reasoning/.test(m)) {
        useReasoning = false;
        continue;
      }
      if (res.status === 400 && useSchema && /(response_format|json_schema)/.test(m)) {
        useSchema = false;
        continue;
      }
      const hint = res.status === 401 ? " Controleer of in Instellingen de OpenAI-key in het veld 'OpenAI API-key' staat." : "";
      const err = new Error(redactSecrets(`OpenAI gaf HTTP ${res.status}: ${data.error?.message ?? "onbekende fout"}.${hint}`)) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    opts.meter.add(model, data.usage?.prompt_tokens ?? 0, data.usage?.completion_tokens ?? 0);
    const msg = data.choices?.[0]?.message;
    if (msg?.refusal) throw new Error("Het model weigerde deze aanvraag.");
    let parsed: unknown;
    try {
      parsed = JSON.parse(msg?.content ?? "");
    } catch {
      parsed = undefined;
    }
    const check = opts.schema.safeParse(parsed);
    if (check.success) return check.data as z.infer<T>;
    messages.push({ role: "assistant", content: msg?.content ?? "" }, { role: "user", content: `Je JSON klopte niet met het schema: ${check.error.message.slice(0, 600)}. Geef enkel de verbeterde JSON.` });
  }
  throw new Error("Het model gaf geen geldige gestructureerde output.");
}

/** Ruwe schatting van tokens voor tekst die we nog niet verstuurd hebben. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}

/** Testknop in Instellingen: één piepkleine gestructureerde aanroep bij de gekozen aanbieder. */
export async function testAi(provider: "anthropic" | "openai"): Promise<{ ok: boolean; ms: number; error?: string }> {
  const t = Date.now();
  const meter = new CostMeter();
  const opts = { system: "Test.", user: 'Antwoord met {"ok": true}.', schema: zod.object({ ok: zod.boolean() }), meter, maxTokens: 50 };
  try {
    const r = provider === "openai" ? await openaiJson(opts) : await anthropicJson(opts);
    return { ok: r.ok === true, ms: Date.now() - t };
  } catch (e) {
    return { ok: false, ms: Date.now() - t, error: (e instanceof Error ? e.message : String(e)).slice(0, 160) };
  }
}
