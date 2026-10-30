import { NextResponse } from "next/server";
import { requireRealAdmin } from "@/lib/adminAuth";
import { requireSession } from "@/lib/session";
import { parseRegistry, SECTORS } from "@/lib/sector/registry";
import { crawlQueue, importRows, linkNewEntries, sectorOverview, seedFromMaps } from "@/lib/sector/process";

export const maxDuration = 300;

function fail(e: unknown) {
  if (e instanceof Response) return e;
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

/** Overzicht: iedereen die aangemeld is mag kijken; acties enkel voor beheerders. */
export async function GET() {
  try {
    const s = await requireSession();
    return NextResponse.json({ admin: Boolean(s.admin), ...(await sectorOverview()) });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Acties (enkel beheerders):
 * - import: CSV-registerbestand (multipart: file, sector) → ontdubbeld op ondernemingsnummer
 * - seed_maps: proefimport via Google Maps (sector, region, radius, limit)
 * - link: websites zoeken voor nieuwe inschrijvingen (limit)
 * - crawl: wachtrij van sectorwerkgevers crawlen (limit)
 */
export async function POST(req: Request) {
  try {
    await requireRealAdmin();
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const sector = String(form.get("sector") ?? "");
      const file = form.get("file");
      if (!SECTORS[sector]) return NextResponse.json({ error: "Onbekende sector." }, { status: 400 });
      if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Kies een CSV-bestand." }, { status: 400 });
      if (file.size > 15_000_000) return NextResponse.json({ error: "Bestand is groter dan 15 MB." }, { status: 400 });
      const parsed = parseRegistry(await file.text(), SECTORS[sector].statute);
      if (!parsed.rows.length) return NextResponse.json({ error: `Geen bruikbare rijen. Gevonden kolommen: ${parsed.columns.join(", ") || "geen"}.` }, { status: 400 });
      const r = await importRows(sector, parsed.rows, String(form.get("source") ?? "fsma"));
      return NextResponse.json({ ok: true, ...r, skipped: parsed.skipped });
    }
    const body = (await req.json().catch(() => ({}))) as { action?: string; sector?: string; region?: string; radius?: number; limit?: number };
    const sector = body.sector && SECTORS[body.sector] ? body.sector : undefined;
    const limit = Math.max(1, Math.min(Number(body.limit) || 12, 60));
    if (body.action === "seed_maps") {
      if (!sector) return NextResponse.json({ error: "Onbekende sector." }, { status: 400 });
      return NextResponse.json({ ok: true, ...(await seedFromMaps(sector, body.region || "Antwerpen", Math.min(Number(body.radius) || 15, 50), limit)) });
    }
    if (body.action === "link") return NextResponse.json({ ok: true, ...(await linkNewEntries(Math.min(limit, 20), sector)) });
    if (body.action === "crawl") return NextResponse.json({ ok: true, ...(await crawlQueue(Math.min(limit, 16), sector)) });
    return NextResponse.json({ error: "Onbekende actie." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
