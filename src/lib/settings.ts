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
  "BRAVE_SEARCH_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_CSE_ID",
  "ADZUNA_APP_ID",
  "ADZUNA_APP_KEY",
  "JINA_API_KEY",
] as const;
export const CONFIG_KEYS = ["SEARCH_PROVIDER", "ANTHROPIC_MONTHLY_BUDGET_EUR"] as const;

export type SecretKey = (typeof SECRET_KEYS)[number];
export type ConfigKey = (typeof CONFIG_KEYS)[number];
export type SettingKey = SecretKey | ConfigKey;

export const SETTING_INFO: Record<SettingKey, { label: string; help: string; url?: string; required?: boolean; options?: string[] }> = {
  ANTHROPIC_API_KEY: { label: "Anthropic API-key", help: "Haiku en Sonnet. Zonder deze key doet Matchr niets.", url: "https://console.anthropic.com/settings/keys", required: true },
  SEARCH_PROVIDER: { label: "Zoekmachine", help: "auto = Brave als die key er is, anders Google, anders DuckDuckGo (geen key nodig).", options: ["auto", "duckduckgo", "google", "brave"] },
  GOOGLE_API_KEY: { label: "Google API-key", help: "Custom Search JSON API; gratis tot 100 zoekopdrachten per dag.", url: "https://console.cloud.google.com/apis/credentials" },
  GOOGLE_CSE_ID: { label: "Google zoekmachine-ID (cx)", help: "Programmable Search Engine die het hele web doorzoekt.", url: "https://programmablesearchengine.google.com/controlpanel/all" },
  BRAVE_SEARCH_API_KEY: { label: "Brave Search API-key", help: "Gratis tier, 2000 zoekopdrachten per maand.", url: "https://api-dashboard.search.brave.com/app/keys" },
  ADZUNA_APP_ID: { label: "Adzuna app-ID", help: "Jobboard-bron. Optioneel.", url: "https://developer.adzuna.com/admin/access_details" },
  ADZUNA_APP_KEY: { label: "Adzuna app-key", help: "Hoort bij het Adzuna app-ID." },
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
