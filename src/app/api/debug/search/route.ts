import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { resolveProvider, webSearch } from "@/lib/search";
import { fetchRaw } from "@/lib/fetch";

export const maxDuration = 60;

/** Diagnose van de zoeklaag: welke provider, wat geven de endpoints terug. Geen keys in de output. */
export async function GET(request: Request) {
  try {
    await requireSession();
    const q = new URL(request.url).searchParams.get("q") ?? "maakbedrijven ploegenwerk Mechelen vacatures";
    const provider = await resolveProvider();
    const started = Date.now();
    const results = await webSearch(q, { count: 10 });
    const probes: Record<string, { status: number; bytes: number; head: string }> = {};
    if (provider === "duckduckgo") {
      for (const [name, url] of [
        ["html", `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=be-nl`],
        ["lite", `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}&kl=be-nl`],
      ]) {
        const r = await fetchRaw(url, { headers: { "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36", accept: "text/html" } });
        probes[name] = { status: r.status, bytes: r.body.length, head: r.body.replace(/\s+/g, " ").slice(0, 300) };
      }
    }
    return NextResponse.json({ provider, q, ms: Date.now() - started, count: results?.length ?? null, results: results?.slice(0, 5) ?? null, probes });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
