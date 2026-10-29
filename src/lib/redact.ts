/**
 * Herkent en verbergt API-keys in vrije tekst (foutmeldingen, logs, opgeslagen runstatus).
 * Ook gebruikt om te weigeren dat een key in een niet-geheim veld belandt.
 */
const KEY_PATTERNS: { name: string; re: RegExp }[] = [
  { name: "Anthropic", re: /sk-ant-[A-Za-z0-9_-]{10,}/g },
  { name: "OpenAI", re: /sk-(?:proj-|svcacct-|admin-)?[A-Za-z0-9_-]{20,}/g },
  { name: "Firecrawl", re: /\bfc-[A-Za-z0-9]{16,}/g },
  { name: "Tavily", re: /\btvly-[A-Za-z0-9_-]{16,}/g },
  { name: "Jina", re: /\bjina_[A-Za-z0-9]{16,}/g },
  { name: "Brave", re: /\bBSA[A-Za-z0-9_-]{20,}/g },
];

export function redactSecrets(text: string): string {
  let out = text;
  for (const { re } of KEY_PATTERNS) out = out.replace(re, "[key verborgen]");
  // Lange willekeurige tokens (40+ tekens zonder spaties) ook verbergen.
  return out.replace(/\b[A-Za-z0-9_-]{48,}\b/g, "[key verborgen]");
}

/** Welke soort key lijkt dit te zijn? Enkel op prefix, nooit op inhoud gelogd. */
export function detectKeyKind(value: string): string | null {
  const v = value.trim();
  if (/^sk-ant-/.test(v)) return "Anthropic";
  if (/^sk-/.test(v)) return "OpenAI";
  if (/^fc-/.test(v)) return "Firecrawl";
  if (/^tvly-/.test(v)) return "Tavily";
  if (/^jina_/.test(v)) return "Jina";
  if (/^BSA/.test(v)) return "Brave";
  if (/^[A-Za-z0-9_-]{32,}$/.test(v)) return "onbekend";
  return null;
}
