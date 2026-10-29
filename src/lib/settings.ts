/**
 * Instellingen en API-keys uit de database (ingevuld via /admin), met de
 * omgevingsvariabelen als fallback. Geheime waarden worden versleuteld
 * opgeslagen met een sleutel afgeleid van APP_PASSWORD; ze worden nooit
 * gelogd of teruggestuurd naar de browser.
 */
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { env } from "@/lib/env";

export const SECRET_KEYS = [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "LINKUP_API_KEY",
  "TAVILY_API_KEY",
  "EXA_API_KEY",
  "BRAVE_SEARCH_API_KEY",
  "ADZUNA_APP_ID",
  "ADZUNA_APP_KEY",
  "JOOBLE_API_KEY",
  "JINA_API_KEY",
  "FIRECRAWL_API_KEY",
] as const;
export const CONFIG_KEYS = ["AI_PROVIDER", "OPENAI_MODEL_CHEAP", "OPENAI_MODEL_SCORING", "SEARCH_PROVIDER", "ANTHROPIC_MONTHLY_BUDGET_EUR"] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];
export type ConfigKey = (typeof CONFIG_KEYS)[number];
export type SettingKey = SecretKey | ConfigKey;

export const SETTING_INFO: Record<SettingKey, { label: string; help: string; url?: string; required?: boolean; options?: string[] }> = {
  ANTHROPIC_API_KEY: { label: "Anthropic API-key (optioneel)", help: "Enkel nodig als je AI-aanbieder op auto of anthropic zet.", url: "https://console.anthropic.com/settings/keys", },
  AI_PROVIDER: { label: "AI-aanbieder", help: "openai (standaard) = enkel OpenAI. auto = OpenAI met Claude als reserve. anthropic = enkel Claude.", options: ["openai", "auto", "anthropic"] },
  OPENAI_API_KEY: { label: "OpenAI API-key", help: "Aan te maken op platform.openai.com door een beheerder van de RecruitrLAB-organisatie. Een ChatGPT-abonnement bevat geen API-tegoed.", url: "https://platform.openai.com/api-keys" },
  OPENAI_MODEL_CHEAP: { label: "OpenAI-model", help: "Leeg = Matchr kiest zelf het nieuwste lichte model (mini) dat je account heeft. Kies enkel een ander als je weet waarom." },
  OPENAI_MODEL_SCORING: { label: "OpenAI-model voor de scoring", help: "Leeg = hetzelfde als hierboven. Enkel invullen als de scores te grof zijn." },
  SEARCH_PROVIDER: { label: "Zoekmachine vooraan", help: "auto = Linkup, dan Tavily, dan Exa, dan Brave. Is er één op of kapot, dan neemt de volgende over. Claude web search (betalend) enkel als je anthropic kiest.", options: ["auto", "linkup", "tavily", "exa", "brave", "anthropic"] },
  LINKUP_API_KEY: { label: "Linkup API-key", help: "Gratis ±4.000 zoekopdrachten per maand met een professioneel e-mailadres. Eerste keuze.", url: "https://app.linkup.so" },
  TAVILY_API_KEY: { label: "Tavily API-key", help: "Gratis 1.000 credits per maand, geen kaart nodig.", url: "https://app.tavily.com" },
  EXA_API_KEY: { label: "Exa API-key", help: "Gratis ±$10 per maand, geen kaart nodig.", url: "https://dashboard.exa.ai/api-keys" },
  BRAVE_SEARCH_API_KEY: { label: "Brave Search API-key", help: "$5 tegoed per maand, kaart nodig. Optioneel.", url: "https://api-dashboard.search.brave.com/app/keys" },
  ADZUNA_APP_ID: { label: "Adzuna app-ID", help: "Jobboard-bron. Optioneel.", url: "https://developer.adzuna.com/admin/access_details" },
  ADZUNA_APP_KEY: { label: "Adzuna app-key", help: "Hoort bij het Adzuna app-ID." },
  JOOBLE_API_KEY: { label: "Jooble API-key", help: "Gratis vacature-API. Vraag een key aan voor België (be.jooble.org).", url: "https://be.jooble.org/api/about" },
  FIRECRAWL_API_KEY: { label: "Firecrawl API-key", help: "Gratis 1.000 credits per maand. Leest jobsites die Jina niet krijgt.", url: "https://www.firecrawl.dev/app/api-keys" },
  JINA_API_KEY: { label: "Jina Reader API-key", help: "Optioneel; werkt ook zonder, met lagere limieten.", url: "https://jina.ai/reader" },
  ANTHROPIC_MONTHLY_BUDGET_EUR: { label: "Maandbudget (€)", help: "Boven dit bedrag weigert Matchr nieuwe runs." },
};

function isSecret(key: string): key is SecretKey {
  return (SECRET_KEYS as readonly string[]).includes(key);
}
export function isSettingKey(key: string): key is SettingKey {
  return isSecret(key) || (CONFIG_KEYS as readonly string[]).includes(key);
}

let _key: Buffer | null = null;
function cipherKey(): Buffer {
  if (!_key) _key = scryptSync(env.APP_PASSWORD, "matchr-settings-v1", 32);
  return _key;
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", cipherKey(), iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1.${iv.toString("base64url")}.${c.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

function decrypt(stored: string): string | null {
  const [v, iv, tag, body] = stored.split(".");
  if (v !== "v1" || !iv || !tag || !body) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", cipherKey(), Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
  } catch {
    // Verkeerde sleutel (APP_PASSWORD gewijzigd) of beschadigde waarde.
    return null;
  }
}

type Cached = { at: number; values: Map<string, { value: string; updatedAt: Date; updatedBy: string | null }> };
let _cache: Cached | null = null;
const CACHE_MS = 30_000;

async function load(): Promise<Cached["values"]> {
  if (_cache && Date.now() - _cache.at < CACHE_MS) return _cache.values;
  const rows = await db().select().from(schema.settings);
  const values = new Map<string, { value: string; updatedAt: Date; updatedBy: string | null }>();
  for (const r of rows) {
    const value = r.secret ? decrypt(r.value) : r.value;
    if (value !== null) values.set(r.key, { value, updatedAt: r.updatedAt, updatedBy: r.updatedBy });
  }
  _cache = { at: Date.now(), values };
  return values;
}

export function invalidateSettingsCache() {
  _cache = null;
}

/** Waarde uit de database, anders uit de omgevingsvariabele, anders undefined. */
export async function getSetting(key: SettingKey): Promise<string | undefined> {
  try {
    const fromDb = (await load()).get(key)?.value;
    if (fromDb && fromDb.trim() !== "") return fromDb.trim();
  } catch {
    // Database onbereikbaar: val terug op env.
  }
  const fromEnv = process.env[key];
  return fromEnv && fromEnv.trim() !== "" ? fromEnv.trim() : undefined;
}

export async function hasSetting(key: SettingKey): Promise<boolean> {
  return (await getSetting(key)) !== undefined;
}

export async function monthlyBudgetEur(): Promise<number> {
  const v = await getSetting("ANTHROPIC_MONTHLY_BUDGET_EUR");
  const n = v ? Number(v) : NaN;
  return Number.isFinite(n) && n > 0 ? n : env.ANTHROPIC_MONTHLY_BUDGET_EUR;
}

export type SettingStatus = {
  key: SettingKey;
  label: string;
  help: string;
  url?: string;
  required?: boolean;
  options?: string[];
  secret: boolean;
  /** admin = via /admin opgeslagen, env = uit Vercel-omgevingsvariabele, none = niet ingesteld. */
  source: "admin" | "env" | "none";
  /** Enkel voor niet-geheime instellingen. */
  value?: string;
  updatedAt?: string;
  updatedBy?: string | null;
};

export async function settingsStatus(): Promise<SettingStatus[]> {
  const values = await load();
  const all: SettingKey[] = [...SECRET_KEYS, ...CONFIG_KEYS];
  return all.map((key) => {
    const row = values.get(key);
    const secret = isSecret(key);
    const envVal = process.env[key];
    const source: SettingStatus["source"] = row ? "admin" : envVal && envVal.trim() !== "" ? "env" : "none";
    return {
      key,
      ...SETTING_INFO[key],
      secret,
      source,
      value: secret ? undefined : row?.value ?? (envVal && envVal.trim() !== "" ? envVal.trim() : undefined),
      updatedAt: row?.updatedAt.toISOString(),
      updatedBy: row?.updatedBy,
    };
  });
}

export async function setSetting(key: SettingKey, value: string, updatedBy: string): Promise<void> {
  const secret = isSecret(key);
  const stored = secret ? encrypt(value.trim()) : value.trim();
  await db()
    .insert(schema.settings)
    .values({ key, value: stored, secret: secret ? 1 : 0, updatedBy, updatedAt: new Date() })
    .onConflictDoUpdate({ target: schema.settings.key, set: { value: stored, secret: secret ? 1 : 0, updatedBy, updatedAt: new Date() } });
  invalidateSettingsCache();
}

export async function deleteSetting(key: SettingKey): Promise<void> {
  await db().delete(schema.settings).where(eq(schema.settings.key, key));
  invalidateSettingsCache();
}
