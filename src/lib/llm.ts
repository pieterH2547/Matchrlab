/**
 * Dunne laag rond de Anthropic SDK: gestructureerde JSON-output via Zod,
 * kostentelling per aanroep, en één plek voor modelkeuze.
 */
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { MODELS, PRICES_USD_PER_MTOK, USD_TO_EUR } from "@/lib/config";
import { env } from "@/lib/env";

let _client: Anthropic | null = null;
function client() {
  if (!_client) _client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 });
  return _client;
}

/** Houdt de kosten van één run bij, in euro. */
export class CostMeter {
  eur = 0;
  calls = 0;
  add(model: string, inputTokens: number, outputTokens: number) {
    const p = PRICES_USD_PER_MTOK[model] ?? { input: 2, output: 10 };
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
  const model = MODELS[opts.model ?? "cheap"];
  const res = await client().messages.parse({
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

/** Ruwe schatting van tokens voor tekst die we nog niet verstuurd hebben. */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 3.5);
}
