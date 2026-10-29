import { aiSearchConfig, searchOpenAIJobs } from "@/lib/pipeline/aisearch";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { SEARCH_PROVIDERS, testProvider, type SearchProvider } from "@/lib/search";
import * as boards from "@/lib/pipeline/jobboards";
import { fetchViaFirecrawl } from "@/lib/fetch";
import { normalizeProfile } from "@/lib/pipeline/profile";
import { testAi } from "@/lib/llm";

export const maxDuration = 120;

/** Testknop per tool in Instellingen. Geeft nooit keys terug, enkel ok/aantal/duur. */
export async function GET(request: Request) {
  try {
    await requireSession();
    const tool = new URL(request.url).searchParams.get("tool") ?? "";
    const t = Date.now();
    if (tool === "claude" || tool === "openai") {
      const r = await testAi(tool === "claude" ? "anthropic" : "openai");
      return NextResponse.json({ tool, ok: r.ok, count: r.ok ? 1 : 0, ms: r.ms, error: r.error });
    }
    if (tool === "openai-search") {
      const r = await testProvider("openai", "procesoperator vacature Mechelen");
      return NextResponse.json({ tool, ...r });
    }
    if ((SEARCH_PROVIDERS as string[]).includes(tool)) {
      const r = await testProvider(tool as SearchProvider, "procesoperator vacature Mechelen");
      return NextResponse.json({ tool, ...r });
    }
    const profile = normalizeProfile({
      candidate_name: "",
      job_titles: ["procesoperator"],
      skills: [],
      years_experience: 5,
      sectors: [],
      region: "Mechelen",
      radius_km: 30,
      exclusions: [],
      employer_type: "",
      search_queries: ["procesoperator Mechelen", "operator Mechelen", "productie Mechelen", "chemie Mechelen"],
      positioning: [],
      uncertainties: [],
      open_questions: [],
      consent: "onbekend",
      hard_requirements: [],
      related_titles: [],
      company_types: [],
      nearby_municipalities: [],
      region_lat: 0,
      region_lng: 0,
    });
    if (tool === "adzuna" || tool === "jooble" || tool === "googlejobs") {
      const out = tool === "adzuna" ? await boards.searchAdzuna(profile) : tool === "jooble" ? await boards.searchJooble(profile) : await boards.searchGoogleJobs(profile);
      const jobs = out.jobs;
      return NextResponse.json({
        tool,
        ok: jobs.length > 0,
        count: jobs.length,
        ms: Date.now() - t,
        error: jobs.length > 0 ? undefined : out.error ?? out.skipped ?? "verbinding werkt, maar 0 vacatures voor 'procesoperator Mechelen'",
        sample: jobs.slice(0, 3).map((j) => `${j.title} — ${j.companyName ?? ""} — ${j.location ?? ""}`),
      });
    }
    if (tool === "openai-jobs") {
      // Eén korte ronde met de gedeelde OpenAI-key: bevestigt dat het model Web Search ondersteunt.
      const cfg = await aiSearchConfig();
      if (!cfg.hasKey) return NextResponse.json({ tool, ok: false, count: 0, ms: 0, error: "Vul eerst de OpenAI-key in." });
      const r = await searchOpenAIJobs(profile, { config: { ...cfg, enabled: true, rounds: 1, maxCostEur: 0.05 }, deadlineMs: 100_000, targetUnique: 5 });
      return NextResponse.json({
        tool,
        ok: !r.error && r.searches > 0,
        count: r.jobs.length,
        ms: Date.now() - t,
        model: r.model,
        error: r.error ?? r.skipped ?? (r.searches === 0 ? "het model deed geen webzoekopdracht" : r.jobs.length === 0 ? `werkt (${r.searches} zoekopdrachten), maar 0 concrete vacatures voor 'procesoperator Mechelen'` : undefined),
        sample: [`model ${r.model} · ${r.searches} zoekopdrachten · ± € ${r.costEur.toFixed(3)}`, ...r.jobs.slice(0, 3).map((j) => `${j.title} — ${j.companyName ?? ""} — ${j.location ?? ""}`)],
      });
    }
    if (tool === "firecrawl") {
      const md = await fetchViaFirecrawl("https://www.vdab.be/");
      return NextResponse.json({ tool, ok: Boolean(md), count: md ? 1 : 0, ms: Date.now() - t, sample: md ? [md.slice(0, 80)] : [] });
    }
    return NextResponse.json({ error: "Onbekende tool." }, { status: 400 });
  } catch (e) {
    if (e instanceof Response) return e;
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
