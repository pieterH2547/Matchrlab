/**
 * Maandbudget (Anthropic, in euro) en de Brave-queryteller.
 */
import { and, gte, lt, sql } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { LIMITS } from "@/lib/config";
import { env } from "@/lib/env";

export function monthKey(d = new Date()): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function monthRange(d = new Date()): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
}

/** Som van de geschatte kosten van alle runs deze maand. */
export async function monthlySpendEur(): Promise<number> {
  const { start, end } = monthRange();
  const rows = await db()
    .select({ total: sql<number>`coalesce(sum(${schema.runs.costEstimateEur}), 0)` })
    .from(schema.runs)
    .where(and(gte(schema.runs.createdAt, start), lt(schema.runs.createdAt, end)));
  return Number(rows[0]?.total ?? 0);
}

export async function budgetExceeded(): Promise<{ exceeded: boolean; spent: number; budget: number }> {
  const spent = await monthlySpendEur();
  const budget = env.ANTHROPIC_MONTHLY_BUDGET_EUR;
  return { exceeded: spent >= budget, spent, budget };
}

/** Reserveert `n` Brave-queries voor deze maand. Geeft false als de limiet bereikt is. */
export async function reserveBraveQueries(n: number): Promise<boolean> {
  const month = monthKey();
  const rows = await db()
    .insert(schema.usageCounters)
    .values({ month, braveQueries: n })
    .onConflictDoUpdate({
      target: schema.usageCounters.month,
      set: { braveQueries: sql`${schema.usageCounters.braveQueries} + ${n}` },
    })
    .returning({ braveQueries: schema.usageCounters.braveQueries });
  const used = rows[0]?.braveQueries ?? n;
  if (used > LIMITS.braveMonthlyQueries) {
    // Terugdraaien zodat de teller eerlijk blijft.
    await db()
      .update(schema.usageCounters)
      .set({ braveQueries: sql`${schema.usageCounters.braveQueries} - ${n}` })
      .where(sql`${schema.usageCounters.month} = ${month}`);
    return false;
  }
  return true;
}

export async function braveQueriesUsedThisMonth(): Promise<number> {
  const rows = await db()
    .select({ n: schema.usageCounters.braveQueries })
    .from(schema.usageCounters)
    .where(sql`${schema.usageCounters.month} = ${monthKey()}`);
  return rows[0]?.n ?? 0;
}
