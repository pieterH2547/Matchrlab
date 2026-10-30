import { NextResponse } from "next/server";
import { and, asc, isNotNull, lt, ne, eq, or, isNull } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { crawlDomain } from "@/lib/pipeline/orchestrator";
import { CostMeter } from "@/lib/llm";
import { crawlQueue, linkNewEntries } from "@/lib/sector/process";

/**
 * Geplande herinventarisatie van gekende werkgeverssites (Vercel Cron, dagelijks), los van de zoekruns.
 * Zo blijft de vacature-index vers en hoeft Deep Search bestaande sites niet opnieuw volledig te bekijken.
 * Begrensd: max 24 sites per keer, 4 tegelijk, 20 s per site, één herkansing met backoff.
 */
export const maxDuration = 300;

const BATCH = 24;
const CONCURRENCY = 4;
const STALE_DAYS = 5;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (secret) return req.headers.get("authorization") === `Bearer ${secret}`;
  // Zonder CRON_SECRET enkel de Vercel-cron zelf.
  return (req.headers.get("user-agent") ?? "").startsWith("vercel-cron/");
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "Niet toegestaan." }, { status: 401 });
  const stale = new Date(Date.now() - STALE_DAYS * 24 * 3600 * 1000);
  const due = await db()
    .select({ domain: schema.companies.domain })
    .from(schema.companies)
    .where(and(isNotNull(schema.companies.jobsUrl), isNull(schema.companies.sector), ne(schema.companies.ats, "none"), or(isNull(schema.companies.lastCrawledAt), lt(schema.companies.lastCrawledAt, stale))))
    .orderBy(asc(schema.companies.lastCrawledAt))
    .limit(BATCH);
  const meter = new CostMeter();
  const results: { domain: string; ok: boolean; jobs: number }[] = [];
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, due.length) }, async () => {
      while (i < due.length) {
        const { domain } = due[i++];
        let ok = false;
        let jobs = 0;
        for (let attempt = 0; attempt < 2 && !ok; attempt++) {
          if (attempt) await new Promise((r) => setTimeout(r, 3000));
          try {
            const r = await withTimeout(crawlDomain(domain, null, meter, false), 20_000);
            ok = true;
            jobs = r.jobs.length;
          } catch {
            ok = false;
          }
        }
        if (!ok) await db().update(schema.companies).set({ lastCrawledAt: new Date() }).where(eq(schema.companies.domain, domain)).catch(() => undefined);
        results.push({ domain, ok, jobs });
      }
    }),
  );
  // Sectorwachtrij (zelfde cron): nieuwe registerwerkgevers koppelen, dan nieuwe en vervallen sectorwerkgevers crawlen.
  const linked = await linkNewEntries(10).catch(() => null);
  const sectorCrawl = await crawlQueue(12).catch(() => null);
  return NextResponse.json({ checked: results.length, ok: results.filter((r) => r.ok).length, jobs: results.reduce((s, r) => s + r.jobs, 0), costEur: Math.round(meter.eur * 1000) / 1000, linked, sectorCrawl });
}
