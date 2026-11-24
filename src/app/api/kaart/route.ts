import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { geocode, findPlaceName } from "@/lib/geo";
import { buildOffices, buildOfficesFlanders, crossCheckRegistry, enrichFromFvf, importOfficesCsv, importOsm, officesNear, officeStats } from "@/lib/offices/collect";
import { FLANDERS_CHUNKS } from "@/lib/offices/osm";
import type { OfficeSector } from "@/lib/offices/classify";

export const maxDuration = 300;

function fail(e: unknown) {
  if (e instanceof Response) return e;
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
}

function parseSectors(raw: string | null | undefined): OfficeSector[] {
  const s = (raw ?? "bank,verzekeringen").split(",").map((x) => x.trim()) as OfficeSector[];
  const out = s.filter((x) => x === "bank" || x === "verzekeringen");
  return out.length ? out : ["bank", "verzekeringen"];
}

function parseRadius(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) ? Math.max(5, Math.min(60, Math.round(n))) : 20;
}

function resolvePlace(raw: string | null | undefined) {
  const plaats = (raw ?? "").trim();
  if (!plaats) return null;
  const center = geocode(plaats);
  if (!center) return null;
  const label = findPlaceName(plaats) ?? plaats.replace(/(^|[-\s])\p{L}/gu, (m) => m.toUpperCase());
  return { center, label };
}

/** Kantoren binnen de straal rond een woonplaats. Iedereen die aangemeld is mag kijken. */
export async function GET(req: Request) {
  try {
    const s = await requireSession();
    const url = new URL(req.url);
    const place = resolvePlace(url.searchParams.get("plaats"));
    const radius = parseRadius(url.searchParams.get("straal"));
    const sectors = parseSectors(url.searchParams.get("sector"));
    const stats = await officeStats();
    if (!place) return NextResponse.json({ admin: Boolean(s.admin), center: null, label: null, radius, offices: [], stats, error: url.searchParams.get("plaats") ? "Die plaats ken ik niet. Probeer een gemeente of postcode in Vlaanderen." : undefined });
    const offices = await officesNear(place.center, radius, sectors);
    return NextResponse.json({ admin: Boolean(s.admin), center: place.center, label: place.label, radius, offices, stats });
  } catch (e) {
    return fail(e);
  }
}

/**
 * Kaart bijwerken (iedereen die aangemeld is; geen teamwachtwoord nodig):
 * - build: Google Maps afgaan per gemeente binnen de straal (budget = max nieuwe zoekopdrachten)
 * - fvf:   vindeenverzekeringsmakelaar.be via de zoekketen
 * - fsma:  FSMA-register (al geïmporteerd) tegen de kaart leggen
 * - multipart CSV (file, plaats, straal, source): gids of register uit bestand
 */
export async function POST(req: Request) {
  try {
    await requireSession();
    const type = req.headers.get("content-type") ?? "";
    if (type.includes("multipart/form-data")) {
      const form = await req.formData();
      const place = resolvePlace(String(form.get("plaats") ?? ""));
      if (!place) return NextResponse.json({ error: "Onbekende plaats." }, { status: 400 });
      const file = form.get("file");
      if (!(file instanceof File) || file.size === 0) return NextResponse.json({ error: "Kies een CSV-bestand." }, { status: 400 });
      if (file.size > 15_000_000) return NextResponse.json({ error: "Bestand is groter dan 15 MB." }, { status: 400 });
      const source = String(form.get("source") ?? "fvf").replace(/[^a-z_]/g, "").slice(0, 20) || "fvf";
      const r = await importOfficesCsv(place.center, parseRadius(form.get("straal")), await file.text(), source);
      if (!r.rows) return NextResponse.json({ error: `Geen bruikbare rijen. Gevonden kolommen: ${r.columns.join(", ") || "geen"}.` }, { status: 400 });
      return NextResponse.json({ ok: true, ...r });
    }
    const body = (await req.json().catch(() => ({}))) as { action?: string; plaats?: string; straal?: number; sectors?: string; budget?: number; chunk?: number };
    const budget = Math.max(0, Math.min(Number(body.budget) || 40, 150));
    // Heel Vlaanderen: geen plaats nodig.
    if (body.action === "build_all") return NextResponse.json({ ok: true, ...(await buildOfficesFlanders(parseSectors(body.sectors), budget)) });
    if (body.action === "osm_all") {
      const chunk = Math.max(0, Math.min(Number(body.chunk) || 0, FLANDERS_CHUNKS.length - 1));
      return NextResponse.json({ ok: true, chunk, chunks: FLANDERS_CHUNKS.length, ...(await importOsm({ chunk })) });
    }
    const place = resolvePlace(body.plaats);
    if (!place) return NextResponse.json({ error: "Onbekende plaats." }, { status: 400 });
    const radius = parseRadius(body.straal);
    if (body.action === "osm") return NextResponse.json({ ok: true, ...(await importOsm({ center: place.center, radiusKm: radius })) });
    if (body.action === "build") return NextResponse.json({ ok: true, ...(await buildOffices(place.center, radius, parseSectors(body.sectors), budget)) });
    if (body.action === "fvf") return NextResponse.json({ ok: true, ...(await enrichFromFvf(place.center, radius, Math.min(budget, 20))) });
    if (body.action === "fsma") return NextResponse.json({ ok: true, ...(await crossCheckRegistry(place.center, radius)) });
    return NextResponse.json({ error: "Onbekende actie." }, { status: 400 });
  } catch (e) {
    return fail(e);
  }
}
