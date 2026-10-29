/**
 * Max 3 commerciële acties over spoor A en B, met korte drafts.
 * Er is geen Outlook/CRM-koppeling: elke actie krijgt RELATIECHECK NOG NODIG.
 * Er wordt nooit iets verzonden of opgeslagen; drafts staan enkel in de app.
 */
import { llmJson, type CostMeter } from "@/lib/llm";
import { ActionsSchema, type ActionView, type MatchView, type Profile, type SignalView } from "./types";

const SYSTEM = `Je bent een senior recruiter bij RecruitrLAB. Kies maximaal 3 commerciële acties uit de werkgevers hieronder.

Weeg: (a) kandidaatfit en haalbaarheid, (b) feitelijk open functie of hiring-signaal, (c) warme ingang (onbekend: er is
geen relatiecheck gebeurd), (d) contactbewijs (geen: verzin nooit een naam, rol of e-mailadres), (e) conflictrisico.
Acties: BEL, DRAFT, INTERN AFSTEMMEN, NIET CONTACTEREN. Motiveer elke actie in één zin.
Omdat er geen relatiecheck in Outlook of CRM gebeurd is, vermeld je in de reden niet dat er geen relatie is.

Drafts (enkel bij DRAFT):
- Afzender is de recruiter die de run startte, niet automatisch Pieter.
- Geen naam, adres, leeftijd, huidige werkgever of andere identificerende kandidaatgegevens.
- Concrete aanleiding: een echte vacature (spoor A) of uitdrukkelijk een bedrijfssignaal (spoor B). Bij spoor B nooit doen alsof er een vacature is.
- Daarna twee bewezen relevante kandidaatargumenten en één laagdrempelige vraag.
- Geen "ik sprak onlangs", geen "direct beschikbaar" als dat onbekend is, geen schaarste- of recruitmentpijnclaims.
- Vlaams, kort, warm, direct, niet salesy of AI-achtig. Onderwerp max 6 woorden, mail max 110 woorden.
- Aanspreking "Beste" zonder naam, want er is geen geverifieerde contactpersoon.
- Als de toestemming van de kandidaat onbekend is: schrijf een verkennende mail over "een kandidaat met dit profiel", zonder cv-belofte.`;

export async function planActions(
  input: { profile: Profile; author: string; matches: MatchView[]; signals: SignalView[] },
  meter: CostMeter,
): Promise<ActionView[]> {
  if (input.matches.length === 0 && input.signals.length === 0) return [];
  const a = input.matches.map((m) => `A | ${m.company} | ${m.title} | ${m.location} | ${m.score / 10}/10 | argument: ${m.argument} | risico: ${m.risk} | ${m.url}`);
  const b = input.signals.map((s) => `B | ${s.company} | ${s.kind} (${s.date}) | ${s.evidence} | fit ${s.fit}: ${s.fitReason} | ${s.sourceUrl}`);
  const user = `Recruiter (afzender): ${input.author}
Kandidaat (enkel voor jou, niet identificerend overnemen): ${(input.profile.positioning ?? []).join(" / ")}
Toestemming externe voorstelling: ${input.profile.consent ?? "onbekend"}

Werkgevers:
${[...a, ...b].join("\n")}`;
  const r = await llmJson({ model: "scoring", system: SYSTEM, user, schema: ActionsSchema, meter, effort: "medium", maxTokens: 2500 });
  return r.actions.slice(0, 3).map((x) => ({
    employer: x.employer.trim(),
    track: x.track,
    action: x.action,
    reason: x.reason.trim(),
    relation: "RELATIECHECK NOG NODIG" as const,
    draft: x.action === "DRAFT" && x.draft_body.trim() ? { subject: x.draft_subject.trim(), body: x.draft_body.trim() } : undefined,
  }));
}
