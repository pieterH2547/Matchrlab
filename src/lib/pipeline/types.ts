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
      employer_identifiable: z.boolean().describe("Is de eindwerkgever bij naam identificeerbaar (geen bureau 'voor een klant')?"),
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
  source: "company_site" | "vdab" | "adzuna" | "brave";
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
  key: "profile" | "jobboards" | "discover" | "crawl" | "score" | "signals";
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
  kpi?: { verifiedJobs: number; proactive: number; relationsChecked: number; draftsSaved: number };
};

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
  source: "company_site" | "vdab" | "adzuna" | "brave";
  firstSeenAt: string;
  argument: string;
  risk: string;
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
  profile: "Profiel opstellen",
  jobboards: "Jobboards doorzoeken",
  discover: "Bedrijven ontdekken",
  crawl: "Jobpagina's bekijken",
  score: "Vacatures scoren",
  signals: "Hiring-signalen en acties",
};

export function initialSteps(skipProfile = false): StepState[] {
  return (Object.keys(STEP_LABELS) as StepState["key"][]).map((key) => ({
    key,
    label: STEP_LABELS[key],
    status: skipProfile && key === "profile" ? "skipped" : "waiting",
  }));
}
