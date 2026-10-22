/**
 * Enige plek waar process.env gelezen wordt. Waarden worden nooit gelogd.
 */
function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : undefined;
}

function required(name: string): string {
  const v = optional(name);
  if (!v) throw new Error(`Omgevingsvariabele ${name} ontbreekt.`);
  return v;
}

export const env = {
  get ANTHROPIC_API_KEY() {
    return required("ANTHROPIC_API_KEY");
  },
  get BRAVE_SEARCH_API_KEY() {
    return optional("BRAVE_SEARCH_API_KEY");
  },
  get ADZUNA_APP_ID() {
    return optional("ADZUNA_APP_ID");
  },
  get ADZUNA_APP_KEY() {
    return optional("ADZUNA_APP_KEY");
  },
  get JINA_API_KEY() {
    return optional("JINA_API_KEY");
  },
  get DATABASE_URL() {
    return required("DATABASE_URL");
  },
  get APP_PASSWORD() {
    return required("APP_PASSWORD");
  },
  get ANTHROPIC_MONTHLY_BUDGET_EUR() {
    const v = optional("ANTHROPIC_MONTHLY_BUDGET_EUR");
    const n = v ? Number(v) : 50;
    return Number.isFinite(n) && n > 0 ? n : 50;
  },
};

export function hasEnv(name: "BRAVE_SEARCH_API_KEY" | "ADZUNA_APP_ID" | "ADZUNA_APP_KEY" | "JINA_API_KEY"): boolean {
  return optional(name) !== undefined;
}
