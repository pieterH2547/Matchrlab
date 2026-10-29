import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { SEARCH_PROVIDERS, testProvider, type SearchProvider } from "@/lib/search";
import { searchAdzuna, searchJooble } from "@/lib/pipeline/jobboards";
import { fetchViaFirecrawl } from "@/lib/fetch";
import { normalizeProfile } from "@/lib/pipeline/profile";

export const maxDuration = 60;

/** Testknop per tool in Instellingen. Geeft nooit keys terug, enkel ok/aantal/duur. */
export async function GET(request: Request) {
  try {
    const s = await requireSession();
    if (!s.admin) return NextResponse.json({ error: "Teamwachtwoord nodig." }, { status: 401 });
    const tool = new URL(request.url).searchParams.get("tool") ?? "";
    const t = Date.now();
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
    });
    if (tool === "adzuna" || tool === "jooble") {
      const jobs = tool === "adzuna" ? await searchAdzuna(profile) : await searchJooble(profile);
      return NextResponse.json({ tool, ok: jobs.length > 0, count: jobs.length, ms: Date.now() - t, sample: jobs.slice(0, 3).map((j) => `${j.title} — ${j.companyName ?? ""} — ${j.location ?? ""}`) });
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
