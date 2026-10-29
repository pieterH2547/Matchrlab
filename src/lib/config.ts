/**
 * Centrale configuratie: modelnamen, prijzen en limieten.
 * Alles wat kosten of blast radius bepaalt staat hier, nergens anders.
 */

export const MODELS = {
  /** Goedkoop model voor profiel, zoekopdrachten, navigatie, extractie en voorselectie. */
  cheap: "claude-haiku-5-5",
  /** Eindscoring: ook het lichte model, om de kost laag te houden. */
  scoring: "claude-haiku-5-5",
} as const;

/** Standaardmodellen bij OpenAI; aanpasbaar in Instellingen zonder code. */
export const OPENAI_DEFAULT_MODELS = { cheap: "gpt-5-mini", scoring: "gpt-5-mini" } as const;

/** Prijzen in USD per miljoen tokens (schatting; onbekende modellen vallen terug op een voorzichtige standaard). */
export const PRICES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "gpt-5-mini": { input: 0.25, output: 2 },
  "gpt-5": { input: 1.25, output: 10 },
  "gpt-5-nano": { input: 0.05, output: 0.4 },
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
  maxDomainsPerRun: 45,
  /** Max Google Maps-zoekopdrachten per run (soort bedrijf × gemeente). */
  maxMapsQueries: 20,
  /** Max vacatures die we vóór de eindscoring op hun pagina controleren. */
  maxVerifyPerRun: 40,
  /** Max detailpagina's per bedrijf (stap 5). */
  maxDetailPagesPerCompany: 4,
  /** Max vacatures die naar het scoringsmodel gaan (stap 6). */
  maxJobsToScore: 40,
  /** Max vacatures per jobboard-bron per run (limiet per bron). */
  maxJobsPerBoard: 60,
  /** Limiet per zoekopdracht: Google Jobs-pagina's (±10 per pagina) per functietitel. */
  googleJobsPagesPerQuery: 2,
  /** Limiet per zoekopdracht: resultaten per Jooble- en Adzuna-vraag. */
  resultsPerQuery: 30,
  /** Aantal functietitels (hoofdtitel + verwante) waarmee elke jobboard bevraagd wordt. */
  titlesPerSource: 3,
  /** Limiet per run: max ruwe vacatures die we samen bewaren (alle bronnen). */
  maxRawJobsPerRun: 200,
  /** Streefwaarde voor de ruwe pool vóór scoring (geen minimum; enkel voor de diagnose). */
  targetRawPool: 30,
  /** Vacatures per AI-scoringsbatch; ontbrekende id's worden één keer opnieuw gevraagd. */
  scoreBatchSize: 10,
  /** Tekens vacaturetekst per vacature in de eindscoring (voorselectie blijft 280). */
  scoreSnippetChars: 900,
  /** Max aandeel van één bron of één functietitel in de selectie voor de scoring. */
  maxShareSameSource: 0.5,
  maxShareSameTitle: 0.35,
  /** Gericht zoekbudget (Google via de zoekketen) per run, verdeeld over titels, gemeenten en bronnen. */
  targetedQueriesPerRun: 10,
  /** Tweede zoekronde als minder dan dit aantal vacatures de drempel haalt. */
  secondRoundBelow: 3,
  /** Minimum dat de voorselectie doorlaat (aangevuld op titelgelijkenis als de AI te streng is). */
  minPreselectKeep: 15,
  /** Niets twee keer binnen deze termijn: pagina's en bedrijven. */
  cacheTtlDays: 7,
  /** Brave gratis tier: 2000 queries per maand. We stoppen eronder. */
  braveMonthlyQueries: 1900,
  /** Max Brave-queries per run (bedrijfsontdekking + fallback). */
  braveQueriesPerRun: 12,
  /** Max tekst (tekens) die we naar het model sturen per pagina. */
  maxPageChars: 12_000,
  /** Tijdsbudget per step-aanroep in ms; daarna geven we de controle terug aan de client. */
  stepTimeBudgetMs: 40_000,
  /** Max tijd per bedrijf in de crawlstap; trager = overslaan. */
  perDomainTimeoutMs: 15_000,
  /** Max domeinen parallel crawlen. */
  crawlConcurrency: 16,
  /** Timeout per HTTP-fetch. */
  fetchTimeoutMs: 8_000,
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
  "/werken-bij-ons",
  "/nl/jobs",
  "/nl/vacatures",
  "/nl/werken-bij",
  "/jobs-nl",
  "/vacature",
  "/join-us",
  "/join-our-team",
  "/carriere",
  "/emplois",
  "/fr/emplois",
  "/over-ons/vacatures",
] as const;

export const SESSION_COOKIE = "matchr_session";
export const SESSION_DAYS = 30;
