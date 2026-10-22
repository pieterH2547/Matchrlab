/**
 * Vervolgbericht in een thread: ofwel een verfijning (profiel aanpassen en
 * opnieuw zoeken op het verschil), ofwel een vraag over de resultaten.
 */
import { llmJson, type CostMeter } from "@/lib/llm";
import { FollowupSchema, type Profile, type MatchView } from "./types";
import { normalizeProfile } from "./profile";

const SYSTEM = `Je bent Matchr, een zoekassistent voor recruiters. Een collega stuurt een vervolgbericht in een thread
waarin al gezocht is voor een kandidaat. Beslis:
- "refine": de collega wil anders of verder zoeken (andere regio, extra uitsluiting, andere functie, ...). Geef enkel de
  profielvelden die veranderen; de andere null. Pas search_queries aan als de functie of regio verandert.
- "question": de collega stelt een vraag over de resultaten (bv. "Waarom scoort X laag?"). Beantwoord kort en
  concreet in het Nederlands (je/jij), op basis van de scores en redenen hieronder. Verzin niets.`;

export type FollowupDecision =
  | { kind: "question"; answer: string }
  | { kind: "refine"; profile: Profile };

export async function decideFollowup(input: { text: string; profile: Profile; matches: MatchView[] }, meter: CostMeter): Promise<FollowupDecision> {
  const results = input.matches
    .slice(0, 30)
    .map((m) => `- ${m.title} (${m.company}, ${m.location}) score ${m.score}: ${m.reason}`)
    .join("\n");
  const user = `## Huidig profiel\n${JSON.stringify(input.profile, null, 1)}\n\n## Resultaten van de vorige run\n${results || "(geen)"}\n\n## Bericht van de collega\n${input.text}`;
  const r = await llmJson({ system: SYSTEM, user, schema: FollowupSchema, meter, effort: "low", maxTokens: 1500 });
  if (r.kind === "question") return { kind: "question", answer: r.answer.trim() || "Daar heb ik geen antwoord op." };
  const p = r.profile_patch;
  const merged: Profile = normalizeProfile({
    ...input.profile,
    job_titles: p.job_titles ?? input.profile.job_titles,
    region: p.region ?? input.profile.region,
    radius_km: p.radius_km ?? input.profile.radius_km,
    exclusions: p.exclusions ?? input.profile.exclusions,
    sectors: p.sectors ?? input.profile.sectors,
    employer_type: p.employer_type ?? input.profile.employer_type,
    search_queries: p.search_queries ?? input.profile.search_queries,
  });
  return { kind: "refine", profile: merged };
}
