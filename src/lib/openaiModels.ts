/**
 * Welke OpenAI-modellen heeft deze key, en welk licht model kiezen we standaard?
 * We hardcoderen geen naam: de modellijn verandert. We vragen /v1/models op (1 uur cache)
 * en kiezen het nieuwste lichte chatmodel (mini, luna, nano), mini liefst.
 */
import { getSetting } from "@/lib/settings";
import { OPENAI_DEFAULT_MODELS } from "@/lib/config";

let cache: { at: number; key: string; ids: string[] } | null = null;

export async function listOpenAIModels(): Promise<string[]> {
  const key = await getSetting("OPENAI_API_KEY");
  if (!key) return [];
  if (cache && cache.key === key && Date.now() - cache.at < 3600_000) return cache.ids;
  try {
    const res = await fetch("https://api.openai.com/v1/models", { headers: { authorization: `Bearer ${key}` } });
    if (!res.ok) return [];
    const data = (await res.json()) as { data?: { id: string }[] };
    const ids = (data.data ?? []).map((m) => m.id).filter(isChatModel).sort();
    cache = { at: Date.now(), key, ids };
    return ids;
  } catch {
    return [];
  }
}

/** Enkel tekst-chatmodellen; geen audio, beeld, embeddings, zoek-, code- of realtime-varianten, geen gedateerde snapshots. */
function isChatModel(id: string): boolean {
  if (!/^(gpt-|o\d)/.test(id)) return false;
  if (/(audio|realtime|transcribe|tts|image|vision|embedding|search|codex|cyber|moderation|instruct|preview|-\d{4}-\d{2}-\d{2}$)/.test(id)) return false;
  return true;
}

function version(id: string): number {
  const m = id.match(/^gpt-(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : 0;
}

/** Het nieuwste lichte model: mini > luna > nano, hoogste versienummer eerst. */
export function pickLightModel(ids: string[]): string | null {
  const rank = (id: string) => (/-mini$/.test(id) ? 3 : /-luna$/.test(id) ? 2 : /-nano$/.test(id) ? 1 : 0);
  const light = ids.filter((id) => rank(id) > 0);
  if (!light.length) return null;
  light.sort((a, b) => version(b) - version(a) || rank(b) - rank(a));
  return light[0];
}

/** Het nieuwste volwaardige model (geen mini/luna/nano), voor de kwaliteitsstand 'hoog'. */
export function pickStrongModel(ids: string[]): string | null {
  const strong = ids.filter((id) => /^gpt-\d+(\.\d+)?$/.test(id));
  if (!strong.length) return null;
  strong.sort((a, b) => version(b) - version(a));
  return strong[0];
}

/** Kwaliteitsstand: 'hoog' = sterker model voor de beoordeling en het AI-zoeken (beter, maar duurder). */
export async function qualityHigh(): Promise<boolean> {
  return (await getSetting("QUALITY_MODE")) === "hoog";
}

/** Het model dat Matchr effectief gebruikt voor een taak. */
export async function resolveOpenAIModel(task: "cheap" | "scoring"): Promise<string> {
  const valid = (v: string | undefined) => (v && /^[a-z0-9][a-z0-9.:_-]{1,63}$/i.test(v) && !/^(sk-|fc-|tvly-)/.test(v) ? v : undefined);
  const chosen = valid(await getSetting(task === "scoring" ? "OPENAI_MODEL_SCORING" : "OPENAI_MODEL_CHEAP"));
  if (chosen) return chosen;
  if (task === "scoring") {
    if (await qualityHigh()) {
      const strong = pickStrongModel(await listOpenAIModels());
      if (strong) return strong;
    }
    const cheap = valid(await getSetting("OPENAI_MODEL_CHEAP"));
    if (cheap) return cheap;
  }
  return pickLightModel(await listOpenAIModels()) ?? OPENAI_DEFAULT_MODELS.cheap;
}
