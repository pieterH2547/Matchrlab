import { z } from "zod";

/** Stap 1: het kandidaatprofiel dat uit cv + vrije tekst komt. */
export const ProfileSchema = z.object({
  candidate_name: z.string().describe("Naam van de kandidaat, of lege string"),
  job_titles: z.array(z.string()).min(1).max(6).describe("3-5 functietitels/synoniemen in het Nederlands"),
  skills: z.array(z.string()).max(20),
  years_experience: z.number().int().min(0).max(50),
  sectors: z.array(z.string()).max(6),
  region: z.string().describe("Stad of regio in België, bv. 'Mechelen'"),
  radius_km: z.number().int().min(5).max(150),
  exclusions: z.array(z.string()).max(10).describe("Wat de kandidaat niet wil, bv. 'nachtwerk', 'interim'"),
  employer_type: z.string().describe("Type werkgever, bv. 'productiebedrijf', 'kmo', 'overheid' of lege string"),
  search_queries: z.array(z.string()).min(4).max(8).describe("6-8 concrete zoekqueries in het Nederlands voor jobboards"),
  positioning: z.array(z.string()).max(3).describe("Kandidaat in max 3 korte regels: doelrol + senioriteit, max 3 bewezen sterktes, regio/pendel"),
  uncertainties: z.array(z.string()).max(3).describe("2-3 belangrijkste onzekerheden, elk gelabeld AANNAME of ONBEKEND"),
  open_questions: z.array(z.string()).max(3).describe("Max 3 beslissende open vragen aan de kandidaat"),
  consent: z.enum(["bevestigd", "onbekend"]).describe("Is expliciet vermeld dat de kandidaat akkoord is met externe voorstelling?"),
  hard_requirements: z.array(z.string()).max(6).describe("Harde diploma's, licenties of certificaten die de kandidaat aantoonbaar heeft"),
  related_titles: z.array(z.string()).max(5).describe("Verwante functies waarvoor de kandidaat realistisch in aanmerking komt (geen sprongen in niveau of vak)"),
  title_variants: z
    .array(z.string())
    .max(6)
    .describe("Dezelfde functie zoals werkgevers ze in het Engels en Frans noemen (bv. 'process operator', 'opérateur de production')"),
  skill_keywords: z.array(z.string()).max(6).describe("Kerntaken en vaardigheden waarop werkgevers vacatures beschrijven (bv. 'btw-aangiften', 'PLC', 'DCS')"),
  company_types: z.array(z.string()).max(8).describe("Soorten bedrijven die dit profiel aanwerven, zoals je ze in Google Maps intikt (bv. 'boekhoudkantoor', 'chemiebedrijf')"),
  nearby_municipalities: z.array(z.string()).max(10).describe("Gemeenten binnen de straal rond de regio, dichtstbij eerst, de regio zelf eerst"),
  region_lat: z.number().describe("Breedtegraad van de regio (gemeente), of 0 als onbekend"),
  region_lng: z.number().describe("Lengtegraad van de regio (gemeente), of 0 als onbekend"),
});
export type Profile = z.infer<typeof ProfileSchema>;

/** Stap 3: zoekopdrachten voor bedrijfsontdekking. */
export const DiscoveryQueriesSchema = z.object({
  queries: z.array(z.string()).min(3).max(8),
});

/** Stap 4c: het model kiest de jobpagina uit homepage-links. */
export const JobsPagePickSchema = z.object({
  url: z.string().describe("De volledige URL van de vacaturepagina, of lege string als er geen is"),
});

/** Stap 5: vacatures uit paginatekst. */
export const ExtractedJobsSchema = z.object({
  jobs: z
    .array(
      z.object({
        title: z.string(),
        location: z.string().describe("Plaats, of lege string"),
        url: z.string().describe("Absolute URL van de vacature, of lege string"),
        description: z.string().describe("Korte beschrijving van max 300 tekens, of lege string"),
      }),
    )
    .max(60),
  is_listing_only: z.boolean().describe("true als de pagina enkel titels toont zonder inhoud"),
});
export type ExtractedJob = z.infer<typeof ExtractedJobsSchema>["jobs"][number];

/** Stap 6a: grove voorselectie. */
export const PreselectSchema = z.object({
  relevant_ids: z.array(z.number().int()),
});

/** Stap 6b: eindscoring, 0-10 volgens de RecruitrLAB-verdeling. */
export const ScoringSchema = z.object({
  intro: z.string().describe("Eén zin inleiding in het Nederlands voor de recruiter"),
  scores: z.array(
    z.object({
      id: z.number().int(),
      kerntaken: z.number().int().min(0).max(3),
      vaardigheden: z.number().int().min(0).max(3),
      senioriteit: z.number().int().min(0).max(2),
      sector: z.number().int().min(0).max(1),
      mobiliteit: z.number().int().min(0).max(1),
      contract: z.enum(["vast", "tijdelijk", "interim", "freelance", "onbekend"]),
      distance_km: z.number().int().describe("Geschatte rijafstand in km tussen de regio van de kandidaat en de werkplek; -1 als de werkplek onbekend is"),
      employer_status: z
        .enum(["rechtstreeks", "tussenpersoon", "onbekend"])
        .describe("rechtstreeks = de eindwerkgever plaatst zelf; tussenpersoon = bureau/interim 'voor een klant'; onbekend = niet betrouwbaar vast te stellen"),
      hard_blocker: z.string().describe("Bewezen harde eis die de kandidaat niet haalt, of lege string"),
      argument: z.string().describe("Eén concreet matchargument"),
      risk: z.string().describe("Eén concreet risico of onzekerheid"),
    }),
  ),
  followups: z.array(z.string()).min(2).max(4).describe("Korte vervolgvragen die de recruiter kan klikken"),
});

/** Vervolgbericht in een thread: verfijning of vraag. */
export const FollowupSchema = z.object({
  kind: z.enum(["refine", "question"]),
  answer: z.string().describe("Bij 'question': het antwoord in het Nederlands. Anders lege string."),
  profile_patch: z
    .object({
      job_titles: z.array(z.string()).nullable(),
      region: z.string().nullable(),
      radius_km: z.number().int().nullable(),
      exclusions: z.array(z.string()).nullable(),
      sectors: z.array(z.string()).nullable(),
      employer_type: z.string().nullable(),
      search_queries: z.array(z.string()).nullable(),
    })
    .describe("Bij 'refine': enkel de velden die veranderen, de rest null"),
});

/** Genormaliseerde vacature, voor alle bronnen gelijk. */
export type NormalizedJob = {
  source: "company_site" | "vdab" | "adzuna" | "jooble" | "google_jobs" | "brave" | "web" | "openai_web";
  externalId?: string;
  url: string;
  title: string;
  location?: string;
  descriptionText?: string;
  companyName?: string;
  companyId?: number;
  raw?: unknown;
};

export type StepStatus = "waiting" | "running" | "done" | "skipped" | "error";

export type StepState = {
  key: "profile" | "jobboards" | "first" | "discover" | "crawl" | "score" | "signals";
  label: string;
  status: StepStatus;
  /** Korte toelichting met aantallen, bv. "23 / 58 · 9 met open vacatures". */
  detail?: string;
};

export type RunState = {
  steps: StepState[];
  /** Domeinen die deze run nog moet bekijken (stap 4/5) en de cursor erin. */
  domains?: string[];
  crawlIndex?: number;
  /** Domeinen die al bekeken zijn (in welke volgorde ook), zodat een afgebroken stap verdergaat waar hij was. */
  crawlDone?: string[];
  /** Tellers voor de stap-tekst. */
  companiesWithJobs?: number;
  siteJobsFound?: number;
  boardJobsFound?: number;
  /** Job-ids die deze run verzameld heeft, per bron. */
  jobIds?: number[];
  intro?: string;
  followups?: string[];
  error?: string;
  /** Bij een vraag in een thread: het antwoord. */
  answer?: string;
  braveQueriesUsed?: number;
  /** Spoor B: werkgevers met een gedateerd hiring-signaal, geen bevestigde vacature. */
  signals?: SignalView[];
  /** Max 3 commerciële acties. */
  actions?: ActionView[];
  /** Werkgevers (spoor B-resultaat), max 10. */
  employers?: EmployerView[];
  /** Run-overzicht: tellers, API-aanroepen per bron, mislukte bronnen, duur. */
  stats?: RunStats;
  /** Alle domeinen die deze run in beeld bracht (ook hergebruikte), voor de werkgeverslijst. */
  companyDomains?: string[];
  /** Spoor B liep al mee tijdens de vacaturestap (sneller); de ontdekstap gebruikt dit resultaat. */
  prefetchedDiscovery?: import("./discover").DiscoveryResult;
  /** Scores en verificaties van deze run: bij een tweede ronde of hervatting niet opnieuw doen. */
  scoreCache?: Record<string, import("./score").RawScore>;
  verifyCache?: Record<string, { status: "actief" | "gesloten" | "niet geverifieerd"; reason: string }>;
  /** Fast Search (eerste matches) of Deep Search (lokale KMO's, websites, AI). */
  phase?: "fast" | "deep";
  /** Voorlopige lijst uit de vacature-index, nog niet beoordeeld (tot de eerste matches er zijn). */
  preview?: { title: string; company: string; location: string; url: string }[];
  /** AI-zoekplan voor Boolean X-ray (Deep Search). */
  xrayPlan?: import("./xray").XrayItem[];
  /** Bronnen die in Fast Search te traag waren; Deep Search haalt ze alsnog op. */
  slowSources?: string[];
  /** OpenAI Web Search al gedaan in Deep Search. */
  aiDone?: boolean;
  /** Automatische tweede zoekronde al gedaan (max één keer). */
  secondRoundDone?: boolean;
  /** Run gestopt na het profiel omdat er geen woonplaats was. */
  needsRegion?: boolean;
  kpi?: { verifiedJobs: number; proactive: number; relationsChecked: number; draftsSaved: number };
};

export type RunStats = {
  startedAt?: number;
  durationMs?: number;
  rawJobs?: number;
  uniqueJobs?: number;
  verifiedActive?: number;
  closedOrRejected?: number;
  aboveThreshold?: number;
  employersExamined?: number;
  apiCalls?: Record<string, number>;
  /** Duur per soort aanroep: HTTP per host-soort, LLM per taak, zoekprovider (n, totaal ms, max ms). */
  apiTimings?: Record<string, { n: number; ms: number; max: number }>;
  failures?: string[];
  /** Duur per fase in ms (profiel, jobboards, ontdekking, crawl, verificatie, voorselectie, scoring, db, eerste resultaat). */
  timings?: Record<string, number>;
  /** Trechter per fase en per bron, met redenen. Nooit cv-inhoud of keys. */
  funnel?: Funnel;
};

export type SourceFunnel = { queries: number; raw: number; kept: number; error?: string; skipped?: string };

export type Funnel = {
  sources?: Record<string, SourceFunnel>;
  /** Ruwe vacatures uit alle bronnen (jobboards, zoekmachines, OpenAI Web Search, bedrijfssites). */
  found?: number;
  /** Bedrijfssites: vacatures uit eigen jobpagina's en ATS-feeds. */
  siteJobs?: number;
  /** Dubbels verwijderd (bij binnenkomst en bij het samenvoegen). */
  duplicates?: number;
  prefilter?: { regio: number; tussenpersoon: number; uitsluiting: number };
  unique?: number;
  preselect?: { input: number; aiKept: number; filled: number; output: number; aiFailed: boolean };
  /** Gecontroleerd op de vacaturepagina. */
  checked?: number;
  verifiedActive?: number;
  closed?: number;
  toScoring?: number;
  scoring?: { requested: number; scored: number; missing: number; batches: number; failedBatches: number };
  reasons?: { onder_drempel: number; contract_tijdelijk: number; tussenpersoon: number; buiten_straal: number; harde_eis: number };
  aboveThreshold?: number;
  shown?: number;
  toVerify?: { contract: number; werkgever: number };
  /** Boolean X-ray: geplande en uitgevoerde zoekopdrachten, vacatures per intentie. */
  xray?: { planned: number; run: number; hits: Record<string, number> };
  /** Scores hergebruikt uit eerdere runs (zelfde profiel, vacaturetekst en scoringsversie). */
  scoreCacheHits?: number;
  /** Automatische tweede zoekronde: aantal zoekopdrachten en nieuwe vacatures. */
  secondRound?: { queries: number; newJobs: number };
  /** Per ontdekkingskanaal: unieke vacatures, unieke werkgevers, passende vacatures. */
  channels?: Record<string, { jobs: number; employers: number; matches: number }>;
  /** Lokale ontdekking: gemeenten bevraagd, Maps-vragen, uit cache, eerder bekende bedrijven hergebruikt. */
  local?: { municipalities: number; mapsQueries: number; fromLocalDb: number; companies: number };
  ai?: { rounds: number; searches: number; raw: number; kept: number; unique?: number; verifiedActive?: number; aboveThreshold?: number; costEur: number; durationMs: number; model: string | null; error?: string; skipped?: string };
};

export type EmployerView = {
  name: string;
  domain: string;
  municipality: string;
  website: string;
  activity: string;
  why: string;
  /** Feitelijk: enkel wat Matchr zelf zag (open vacatures op de jobsite, passende vacature). Nooit verzonnen. */
  signal: string | null;
  careersUrl: string | null;
  hasMatchingJob: boolean;
  openJobs: number;
  distanceKm: number | null;
  contactEmail?: string | null;
  contactSource?: string | null;
  contactName?: string | null;
};

/** Werkgevers beoordelen: enkel relevantie en activiteit, geen feiten verzinnen. */
export const EmployersSchema = z.object({
  employers: z.array(
    z.object({
      id: z.number().int(),
      relevant: z.boolean(),
      activity: z.string().describe("Hoofdactiviteit in een paar woorden, enkel op basis van de gegeven info"),
      why: z.string().describe("Eén zin waarom het kandidaatprofiel er relevant kan zijn. Geen vacatures of plannen verzinnen."),
    }),
  ),
});

export type SignalView = {
  company: string;
  domain: string;
  kind: string;
  date: string;
  sourceUrl: string;
  sourceTitle: string;
  evidence: string;
  fit: "sterk" | "middel" | "zwak";
  fitReason: string;
};

export type ActionView = {
  employer: string;
  track: "A" | "B";
  action: "BEL" | "DRAFT" | "INTERN AFSTEMMEN" | "NIET CONTACTEREN";
  reason: string;
  relation: "RELATIECHECK NOG NODIG";
  draft?: { subject: string; body: string };
};

/** Spoor B: oordeel over één bronpagina. */
export const SignalSchema = z.object({
  is_signal: z.boolean().describe("true enkel als de pagina een gedateerd groei-, investerings-, uitbreidings-, teamopbouw- of wervingssignaal van dit bedrijf bevat"),
  kind: z.string().describe("Aard: investering, uitbreiding, nieuwe vestiging, teamopbouw, groei, ... of lege string"),
  date: z.string().describe("Datum van het signaal zoals op de pagina (bv. 2026-09-14 of 'september 2026'), of lege string als niet vermeld"),
  evidence: z.string().describe("Eén zin die het signaal feitelijk samenvat, zonder overdrijving"),
  fit: z.enum(["sterk", "middel", "zwak"]),
  fit_reason: z.string().describe("Waarom juist dit profiel kan passen, één zin"),
});

/** Max 3 acties + drafts. */
export const ActionsSchema = z.object({
  actions: z
    .array(
      z.object({
        employer: z.string(),
        track: z.enum(["A", "B"]),
        action: z.enum(["BEL", "DRAFT", "INTERN AFSTEMMEN", "NIET CONTACTEREN"]),
        reason: z.string().describe("Eén zin motivatie"),
        draft_subject: z.string().describe("Onderwerp van max 6 woorden, of lege string als geen draft"),
        draft_body: z.string().describe("Mail van max 110 woorden, of lege string als geen draft"),
      }),
    )
    .max(3),
});

export type AttachmentInfo = { name: string; size: number };

export type MessageContent =
  | { kind: "user"; text: string; attachment?: AttachmentInfo }
  | {
      kind: "assistant";
      intro?: string;
      answer?: string;
      followups?: string[];
    };

export type MatchView = {
  jobId: number;
  score: number;
  reason: string;
  rank: number;
  title: string;
  company: string;
  location: string;
  url: string;
  source: "company_site" | "vdab" | "adzuna" | "jooble" | "google_jobs" | "brave" | "web" | "openai_web";
  firstSeenAt: string;
  argument: string;
  risk: string;
  verification: string;
  contactEmail: string | null;
  contactSource: string | null;
  contactName: string | null;
};

export type RunView = {
  id: number;
  createdAt: string;
  author: string;
  candidateName: string | null;
  freeText: string | null;
  profile: Profile | null;
  status: string;
  costEstimateEur: number;
  threadId: string;
  state: RunState;
  attachment?: AttachmentInfo;
  matches: MatchView[];
};

export const STEP_LABELS: Record<StepState["key"], string> = {
  profile: "Cv verwerkt",
  jobboards: "Fast Search · vacaturebronnen",
  first: "Fast Search · eerste matches",
  discover: "Deep Search · lokale werkgevers",
  crawl: "Deep Search · websites, ATS-feeds en AI-zoeken",
  score: "Alles samen beoordelen",
  signals: "Hiring-signalen en acties",
};

export function initialSteps(skipProfile = false): StepState[] {
  return (Object.keys(STEP_LABELS) as StepState["key"][]).filter((key) => key !== "signals").map((key) => ({
    key,
    label: STEP_LABELS[key],
    status: skipProfile && key === "profile" ? "skipped" : "waiting",
  }));
}
