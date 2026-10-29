/**
 * Vacature-index en caches in Neon (bestaande tabellen jobs en search_cache):
 * - inhoudshash per vacature (titel + tekst);
 * - verificatie bewaren met tijdstip; hergebruik enkel als ze recent is (anders opnieuw controleren);
 * - extractie van een jobpagina cachen op url + inhoudshash;
 * - kandidaat-specifieke scores cachen op profiel + vacature-inhoud + scoringsversie.
 * Nooit persoonsgegevens in sleutels: het profiel wordt gehasht.
 */
import { createHash } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import type { Profile } from "./types";

/** Verhogen bij elke wijziging aan de scoringsprompt of -verdeling: oude scores worden dan niet hergebruikt. */
export const SCORING_VERSION = "2026-10-29.1";
/** Hoe lang een verificatie als actueel geldt. Ouder = opnieuw controleren, nooit als 'nu bevestigd' tonen. */
export const VERIFY_TTL_MS = 24 * 3600 * 1000;

export function sha(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 32);
}

export function contentHash(j: { title: string; descriptionText?: string | null }): string {
  return sha(`${j.title.trim().toLowerCase()}\n${(j.descriptionText ?? "").replace(/\s+/g, " ").trim()}`);
}

/** Vingerafdruk van wat de score bepaalt (geen naam of contactgegevens). */
export function profileFingerprint(p: Profile): string {
  return sha(
    JSON.stringify([p.job_titles, p.related_titles ?? [], p.skills, p.years_experience, p.sectors, p.region, p.radius_km, p.exclusions, p.employer_type, p.hard_requirements ?? []]),
  );
}

export function scoreKey(p: Profile, jobHash: string): string {
  return `score:${SCORING_VERSION}:${profileFingerprint(p)}:${jobHash}`;
}

/** Recente verificatie hergebruiken? Enkel binnen de TTL. */
export function freshVerification(
  j: { verifiedAt?: Date | string | null; verificationStatus?: string | null; verificationReason?: string | null },
  now = Date.now(),
): { status: "actief" | "gesloten" | "niet geverifieerd"; reason: string } | null {
  if (!j.verifiedAt || !j.verificationStatus) return null;
  const at = new Date(j.verifiedAt).getTime();
  if (now - at > VERIFY_TTL_MS) return null;
  const when = new Date(at).toLocaleString("nl-BE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Brussels" });
  return { status: j.verificationStatus as "actief" | "gesloten" | "niet geverifieerd", reason: `${j.verificationReason ?? ""} (gecontroleerd ${when})`.trim() };
}

export async function saveVerifications(rows: { id: number; status: string; reason: string }[]): Promise<void> {
  if (!rows.length) return;
  const now = new Date();
  await Promise.all(
    rows.map((r) =>
      db().update(schema.jobs).set({ verifiedAt: now, verificationStatus: r.status, verificationReason: r.reason.slice(0, 300) }).where(eq(schema.jobs.id, r.id)),
    ),
  ).catch(() => undefined);
}

export async function readCache<T>(keys: string[], maxAgeDays: number): Promise<Map<string, T>> {
  if (!keys.length) return new Map();
  const rows = await db()
    .select()
    .from(schema.searchCache)
    .where(inArray(schema.searchCache.key, keys))
    .catch(() => []);
  const limit = Date.now() - maxAgeDays * 24 * 3600 * 1000;
  return new Map(rows.filter((r) => r.createdAt.getTime() >= limit).map((r) => [r.key, r.results as T]));
}

export async function writeCache(kind: string, entries: { key: string; value: unknown }[]): Promise<void> {
  if (!entries.length) return;
  await db()
    .insert(schema.searchCache)
    .values(entries.map((e) => ({ key: e.key, kind, results: e.value, createdAt: new Date() })))
    .onConflictDoUpdate({ target: schema.searchCache.key, set: { results: sql`excluded.results`, createdAt: sql`excluded.created_at` } })
    .catch(() => undefined);
}
