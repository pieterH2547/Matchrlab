import {
  integer,
  jsonb,
  pgEnum,
  pgTable,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import type { Profile, RunState, MessageContent } from "@/lib/pipeline/types";

export const atsEnum = pgEnum("ats", [
  "jobtoolz",
  "recruitee",
  "teamtailor",
  "workable",
  "talentfinder",
  "smartrecruiters",
  "greenhouse",
  "lever",
  "personio",
  "unknown",
  "none",
]);

export const jobSourceEnum = pgEnum("job_source", ["company_site", "vdab", "adzuna", "brave"]);

export const runStatusEnum = pgEnum("run_status", [
  "profile",
  "jobboards",
  "discover",
  "crawl",
  "score",
  "done",
  "failed",
]);

export const runs = pgTable(
  "runs",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    author: text("author").notNull(),
    candidateName: text("candidate_name"),
    cvText: text("cv_text"),
    freeText: text("free_text"),
    profile: jsonb("profile").$type<Profile>(),
    status: runStatusEnum("status").notNull().default("profile"),
    costEstimateEur: real("cost_estimate_eur").notNull().default(0),
    threadId: text("thread_id").notNull(),
    /** Voortgang per stap + cursors, zodat een afgebroken run hervat kan worden. */
    state: jsonb("state").$type<RunState>().notNull().default({ steps: [] } as unknown as RunState),
  },
  (t) => [index("runs_thread_idx").on(t.threadId), index("runs_created_idx").on(t.createdAt)],
);

export const messages = pgTable("messages", {
  id: serial("id").primaryKey(),
  runId: integer("run_id")
    .references(() => runs.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: jsonb("content").$type<MessageContent>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const companies = pgTable("companies", {
  id: serial("id").primaryKey(),
  domain: text("domain").notNull().unique(),
  name: text("name"),
  jobsUrl: text("jobs_url"),
  ats: atsEnum("ats").notNull().default("unknown"),
  lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
  openJobsCount: integer("open_jobs_count").notNull().default(0),
  notes: text("notes"),
});

export const jobs = pgTable(
  "jobs",
  {
    id: serial("id").primaryKey(),
    companyId: integer("company_id").references(() => companies.id, { onDelete: "set null" }),
    source: jobSourceEnum("source").notNull(),
    externalId: text("external_id"),
    url: text("url").notNull().unique(),
    title: text("title").notNull(),
    location: text("location"),
    descriptionText: text("description_text"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).defaultNow().notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    raw: jsonb("raw"),
  },
  (t) => [index("jobs_company_idx").on(t.companyId), index("jobs_last_seen_idx").on(t.lastSeenAt)],
);

export const matches = pgTable(
  "matches",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => runs.id, { onDelete: "cascade" })
      .notNull(),
    jobId: integer("job_id")
      .references(() => jobs.id, { onDelete: "cascade" })
      .notNull(),
    score: integer("score").notNull(),
    reason: text("reason").notNull(),
    rank: integer("rank").notNull(),
  },
  (t) => [uniqueIndex("matches_run_job_idx").on(t.runId, t.jobId)],
);

export const pageCache = pgTable("page_cache", {
  url: text("url").primaryKey(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).defaultNow().notNull(),
  contentText: text("content_text"),
  statusCode: integer("status_code").notNull(),
});

/** Maandtellers: Brave-queries (gratis tier) en gebruikte kosten. Key = "YYYY-MM". */
export const usageCounters = pgTable("usage_counters", {
  month: text("month").primaryKey(),
  braveQueries: integer("brave_queries").notNull().default(0),
});

export type Run = typeof runs.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type Company = typeof companies.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type Message = typeof messages.$inferSelect;

/** Instellingen en API-keys die via /admin ingevuld worden. Geheime waarden staan versleuteld (AES-256-GCM). */
export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  secret: integer("secret").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: text("updated_by"),
});
