/**
 * Harde filters na de AI-scoring, als pure functie: makkelijk te testen en met een telling per reden.
 * Onbekend contract of onbekende werkgever is géén uitsluiting: die vacatures blijven, met het label
 * 'te verifiëren', en worden nooit als bevestigde vaste vacature getoond.
 */
import { isIntermediaryCompany } from "@/lib/blocklist";
import { withinProfileRadius } from "@/lib/geo";
import type { Profile } from "./types";

export type ScoredLike = {
  job: { id: number; url: string; location: string | null; source: string; companyId?: number | null };
  score: number;
  contract: "vast" | "tijdelijk" | "interim" | "freelance" | "onbekend";
  employerStatus: "rechtstreeks" | "tussenpersoon" | "onbekend";
  hardBlocker: string;
  distanceKm: number;
};

export type FilterReasons = {
  onder_drempel: number;
  contract_tijdelijk: number;
  tussenpersoon: number;
  buiten_straal: number;
  harde_eis: number;
};

export function emptyFilterReasons(): FilterReasons {
  return { onder_drempel: 0, contract_tijdelijk: 0, tussenpersoon: 0, buiten_straal: 0, harde_eis: 0 };
}

/** Welke punten moet de recruiter nog nagaan? */
export function toVerifyFlags(s: ScoredLike, companyName: string): string[] {
  const flags: string[] = [];
  if (s.contract === "onbekend") flags.push("contract te verifiëren");
  if (s.employerStatus === "onbekend" || !companyName.trim()) flags.push("werkgever te verifiëren");
  return flags;
}

export function rejectReason(s: ScoredLike, companyName: string, profile: Profile, threshold: number): keyof FilterReasons | null {
  if (s.contract === "tijdelijk" || s.contract === "interim" || s.contract === "freelance") return "contract_tijdelijk";
  if (s.employerStatus === "tussenpersoon" || isIntermediaryCompany(companyName, s.job.url)) return "tussenpersoon";
  if (s.hardBlocker) return "harde_eis";
  if (withinProfileRadius(s.job.location, profile) === false) return "buiten_straal";
  // Afstand volgens de AI: buiten de straal (+5 km marge) = weg; onbekende werkplek enkel bij bedrijfssites.
  if (s.distanceKm >= 0 ? s.distanceKm > profile.radius_km + 5 : s.job.source !== "company_site") return "buiten_straal";
  if (s.score < threshold) return "onder_drempel";
  return null;
}

export function applyHardFilters<T extends ScoredLike>(
  scored: T[],
  names: Map<number, string>,
  profile: Profile,
  threshold: number,
): { kept: T[]; reasons: FilterReasons } {
  const reasons = emptyFilterReasons();
  const kept: T[] = [];
  for (const s of scored) {
    const r = rejectReason(s, names.get(s.job.id) ?? "", profile, threshold);
    if (r) reasons[r] += 1;
    else kept.push(s);
  }
  return { kept, reasons };
}

const REASON_LABEL: Record<keyof FilterReasons, string> = {
  onder_drempel: "onder de matchdrempel",
  contract_tijdelijk: "tijdelijk, interim of freelance",
  tussenpersoon: "via een tussenpersoon",
  buiten_straal: "buiten de straal",
  harde_eis: "harde eis die de kandidaat niet haalt",
};

export type FunnelCounts = { found: number; siteJobs: number; unique: number; checked: number; closed: number; toScoring: number; scored: number; reasons: FilterReasons };

/**
 * Verklaring met aantallen per fase en per filter als er niets overblijft. Maakt het verschil tussen
 * gevonden, uniek, gecontroleerd en effectief gescoord (nooit meer "ik bekeek 1 vacatures" zonder context).
 */
export function explainNoMatches(f: FunnelCounts, threshold: number): string {
  const parts = (Object.keys(f.reasons) as (keyof FilterReasons)[])
    .filter((k) => f.reasons[k] > 0)
    .map((k) => `${f.reasons[k]} ${REASON_LABEL[k]}`);
  const total = f.found + f.siteJobs;
  const head = `Gevonden: ${total} vacatures (${f.found} via jobboards en zoekmachines, ${f.siteJobs} op bedrijfssites). Uniek na filters: ${f.unique}. Gecontroleerd op de vacaturepagina: ${f.checked}${f.closed ? `, waarvan ${f.closed} gesloten` : ""}. Effectief gescoord: ${f.scored} van ${f.toScoring}.`;
  if (f.unique === 0) return `${head} Er bleef niets over om te beoordelen; open het run-overzicht voor de redenen per bron en per filter.`;
  if (f.scored === 0) return `${head} De AI-beoordeling gaf geen bruikbare scores; probeer opnieuw.`;
  return `${head} Geen enkele haalt ${threshold / 10}/10 bij een rechtstreekse werkgever zonder tijdelijk contract binnen de straal${parts.length ? ` — afgewezen: ${parts.join(", ")}` : ""}.`;
}
