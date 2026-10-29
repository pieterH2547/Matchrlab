/**
 * Centrale configuratie: modelnamen, prijzen en limieten.
 * Alles wat kosten of blast radius bepaalt staat hier, nergens anders.
 */

export const MODELS = {
  /** Goedkoop model voor profiel, zoekopdrachten, navigatie, extractie en voorselectie. */
  cheap: "claude-haiku-5-5",
  /** Sterker model, enkel voor de eindscoring van de top-30. */
  scoring: "claude-sonnet-5-5",
} as const;

/** Prijzen in USD per miljoen tokens (Anthropic first-party API, okt. 2026). */
export const PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-haiku-5-5": { input: 0.1, output: 0.5 },
  "claude-sonnet-5-5": { input: 2, output: 10 },
};

/** Grove wisselkoers voor de kostenschatting in euro. */
export const USD_TO_EUR = 0.92;

export const LIMITS = {
  /** Vacatures onder deze score worden niet getoond. */
  minScoreToShow: 60,
  /** Max vacatures die we tonen per run. */
  maxResults: 10,
  /** Max vacatures per werkgever, zodat één grote werkgever de lijst niet vult. */
  maxPerEmployer: 2,
  /** Max unieke bedrijfsdomeinen per run (stap 3). */
  maxDomainsPerRun: 80,
  /** Max detailpagina's per bedrijf (stap 5). */
  maxDetailPagesPerCompany: 10,
  /** Max vacatures die naar het scoringsmodel gaan (stap 6). */
  maxJobsToScore: 30,
  /** Max vacatures per jobboard-bron per run. */
  maxJobsPerBoard: 60,
  /** Niets twee keer binnen deze termijn: pagina's en bedrijven. */
  cacheTtlDays: 7,
  /** Brave gratis tier: 2000 queries per maand. We stoppen eronder. */
  braveMonthlyQueries: 1900,
  /** Max Brave-queries per run (bedrijfsontdekking + fallback). */
  braveQueriesPerRun: 12,
  /** Max tekst (tekens) die we naar het model sturen per pagina. */
  maxPageChars: 12_000,
  /** Tijdsbudget per step-aanroep in ms; daarna geven we de controle terug aan de client. */
  stepTimeBudgetMs: 45_000,
  /** Max domeinen parallel crawlen. */
  crawlConcurrency: 6,
  /** Timeout per HTTP-fetch. */
  fetchTimeoutMs: 10_000,
  /** Max bytes per pagina. */
  fetchMaxBytes: 1_500_000,
  /** Minimum tekstlengte voordat we een pagina "bruikbaar" noemen. */
  minUsefulChars: 400,
} as const;

/** Bonus voor vacatures die rechtstreeks van de bedrijfssite komen. */

/** Standaardpaden waar bedrijven hun vacatures zetten (stap 4b). */
export const STANDARD_JOB_PATHS = [
  "/jobs",
  "/vacatures",
  "/careers",
  "/werken-bij",
  "/jobs-nl",
  "/nl/jobs",
  "/nl/vacatures",
  "/join-us",
] as const;

export const SESSION_COOKIE = "matchr_session";
export const SESSION_DAYS = 30;
