"use client";

import Link from "next/link";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OfficeView } from "@/lib/offices/collect";
import type { OfficeSector } from "@/lib/offices/classify";
import { KIND_LABEL, SOURCE_LABEL } from "./labels";

const OfficeMap = dynamic(() => import("./OfficeMap"), {
  ssr: false,
  loading: () => <div className="h-full w-full bg-[#eef0ec]" />,
});

type Payload = {
  admin: boolean;
  center: { lat: number; lon: number } | null;
  label: string | null;
  radius: number;
  offices: OfficeView[];
  stats: { sector: string; n: number; verified: number }[];
  error?: string;
};

const SECTOR_LABEL: Record<OfficeSector, string> = {
  bank: "Banken",
  verzekeringen: "Verzekeringen",
};
const COLOR: Record<OfficeSector, string> = {
  bank: "#1b1845",
  verzekeringen: "#e0a410",
};

/**
 * Kantorenkaart: alle bank- en verzekeringskantoren binnen een straal rond de woonplaats van de kandidaat,
 * ook zonder vacature. Links het paneel (zoeken, filters, lijst), rechts de kaart.
 */
export function MapExplorer() {
  const [plaats, setPlaats] = useState("");
  const [query, setQuery] = useState("");
  const [radius, setRadius] = useState(20);
  const [sectors, setSectors] = useState<OfficeSector[]>([
    "bank",
    "verzekeringen",
  ]);
  const [onlyJobs, setOnlyJobs] = useState(false);
  const [onlyVerified, setOnlyVerified] = useState(false);
  const [filter, setFilter] = useState("");
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [hoverId, setHoverId] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async (p: string, r: number) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/kaart?plaats=${encodeURIComponent(p)}&straal=${r}`,
        { cache: "no-store" },
      );
      const j = (await res.json()) as Payload;
      if (!res.ok) throw new Error(j.error ?? "Kon de kaart niet laden.");
      setData(j);
      if (j.error) setError(j.error);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setLoading(false);
  }, []);

  // Laatste zoekopdracht onthouden, zodat de kaart bij het openen meteen iets toont.
  useEffect(() => {
    const t = setTimeout(() => {
      let p = "";
      let r = 20;
      try {
        p = window.localStorage.getItem("matchr:kaart:plaats") ?? "";
        r =
          Number(window.localStorage.getItem("matchr:kaart:straal") ?? 20) ||
          20;
      } catch {
        /* geen localStorage */
      }
      setQuery(p);
      setPlaats(p);
      setRadius(r);
      void load(p, r);
    }, 0);
    return () => clearTimeout(t);
  }, [load]);

  function search(p = query, r = radius) {
    const clean = p.trim();
    setPlaats(clean);
    setSelectedId(null);
    try {
      window.localStorage.setItem("matchr:kaart:plaats", clean);
      window.localStorage.setItem("matchr:kaart:straal", String(r));
    } catch {
      /* geen localStorage */
    }
    void load(clean, r);
  }

  const offices = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (data?.offices ?? []).filter(
      (o) =>
        sectors.includes(o.sector) &&
        (!onlyJobs || o.openJobs > 0) &&
        (!onlyVerified || o.verified) &&
        (!q ||
          `${o.name} ${o.brand ?? ""} ${o.municipality ?? ""} ${o.address ?? ""}`
            .toLowerCase()
            .includes(q)),
    );
  }, [data, sectors, onlyJobs, onlyVerified, filter]);

  const counts = useMemo(() => {
    const all = (data?.offices ?? []).filter((o) => sectors.includes(o.sector));
    return {
      total: all.length,
      bank: all.filter((o) => o.sector === "bank").length,
      verzekeringen: all.filter((o) => o.sector === "verzekeringen").length,
      jobs: all.filter((o) => o.openJobs > 0).length,
      verified: all.filter((o) => o.verified).length,
      brands: new Set(all.map((o) => o.brand).filter(Boolean)).size,
    };
  }, [data, sectors]);

  useEffect(() => {
    if (selectedId === null) return;
    listRef.current
      ?.querySelector<HTMLElement>(`[data-office="${selectedId}"]`)
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  function toggleSector(s: OfficeSector) {
    setSectors((cur) =>
      cur.includes(s)
        ? cur.length === 1
          ? cur
          : cur.filter((x) => x !== s)
        : [...cur, s],
    );
  }

  async function act(action: "build" | "fvf" | "fsma") {
    if (!plaats) return;
    setBusy(action);
    setError(null);
    const t0 = Date.now();
    try {
      const res = await fetch("/api/kaart", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action,
          plaats,
          straal: radius,
          sectors: sectors.join(","),
          budget: 40,
        }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(j.error ?? `HTTP ${res.status}`));
      const s = Math.round((Date.now() - t0) / 1000);
      if (action === "build")
        setLog((l) => [
          `Google Maps: ${j.municipalities} gemeenten, ${j.queries} zoekopdrachten (${j.fromCache} uit cache, ${j.live} nieuw${Number(j.skippedForBudget) > 0 ? `, ${j.skippedForBudget} wachten op een volgende ronde` : ""}), ${j.found} vestigingen → ${j.inserted} nieuw, ${j.updated} bijgewerkt. ${s} s.`,
          ...l,
        ]);
      if (action === "fvf")
        setLog((l) => [
          `FVF-gids: ${j.searches} zoekopdrachten, ${j.pages} pagina's gelezen, ${j.parsed} makelaars herkend → ${j.matched} bevestigd, ${j.added} nieuw, ${j.outside} buiten de straal.${j.note ? ` ${j.note}` : ""} ${s} s.`,
          ...l,
        ]);
      if (action === "fsma")
        setLog((l) => [
          `FSMA-register: ${j.entries} inschrijvingen → ${j.matched} bevestigd, ${j.added} nieuw op de kaart, ${j.outside} buiten de straal. ${s} s.`,
          ...l,
        ]);
      await load(plaats, radius);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  async function uploadCsv(file: File, source: string) {
    if (!plaats) return;
    setBusy("csv");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("plaats", plaats);
      form.set("straal", String(radius));
      form.set("source", source);
      const res = await fetch("/api/kaart", { method: "POST", body: form });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) throw new Error(String(j.error ?? `HTTP ${res.status}`));
      setLog((l) => [
        `CSV (${SOURCE_LABEL[source] ?? source}): ${j.rows} rijen → ${j.matched} bevestigd, ${j.added} nieuw, ${j.outside} buiten de straal.`,
        ...l,
      ]);
      await load(plaats, radius);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
  }

  const empty = Boolean(data && data.center && data.offices.length === 0);

  return (
    <div className="flex h-screen w-full flex-col md:flex-row overflow-hidden bg-canvas">
      {/* Paneel */}
      <aside className="flex w-full shrink-0 flex-col border-r border-line bg-sidebar md:h-screen md:w-[400px]">
        <div className="px-5 pt-5 pb-4 border-b border-line">
          <div className="flex items-center gap-3">
            <Link href="/" className="flex items-center gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-navy-sm.png"
                alt="RecruitrLAB"
                width={40}
                height={23}
                className="h-[22px] w-auto"
              />
              <span className="font-semibold tracking-tight text-[16px] text-navy">
                Matchr<span className="text-gold">.</span>
              </span>
            </Link>
            <span className="eyebrow text-ink-faint">Kaart</span>
            <Link
              href="/"
              className="ml-auto text-[12.5px] text-ink-soft hover:text-navy"
            >
              ← Runs
            </Link>
          </div>
          <h1 className="mt-4 text-[24px] font-semibold leading-tight tracking-tight text-navy">
            Elk <span className="accent-serif">bank</span>- en{" "}
            <span className="accent-serif">verzekerings</span>kantoor in de
            buurt<span className="text-gold">.</span>
          </h1>
          <p className="mt-1.5 text-[13px] text-ink-soft">
            Woonplaats + straal. Elk kantoor is een kans, ook zonder vacature.
          </p>

          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              search();
            }}
          >
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Woonplaats of postcode, bv. Mechelen"
              className="min-w-0 flex-1 rounded-lg border border-line bg-white px-3 py-2 text-[14px] placeholder:text-ink-faint focus:border-navy focus:outline-none"
            />
            <button
              type="submit"
              disabled={loading}
              className="rounded-lg bg-navy px-4 py-2 text-[14px] font-medium text-white hover:bg-navy-2 disabled:opacity-50"
            >
              {loading ? "…" : "Toon"}
            </button>
          </form>

          <div className="mt-4">
            <div className="flex items-baseline justify-between text-[12px] text-ink-soft">
              <span>Straal rond {data?.label ?? "de woonplaats"}</span>
              <span className="mono text-navy font-medium">{radius} km</span>
            </div>
            <input
              type="range"
              min={5}
              max={50}
              step={5}
              value={radius}
              onChange={(e) => setRadius(Number(e.target.value))}
              onMouseUp={() => search(query, radius)}
              onTouchEnd={() => search(query, radius)}
              onKeyUp={() => search(query, radius)}
              className="radius mt-1.5 w-full"
              style={{ "--v": radius } as React.CSSProperties}
              aria-label="Straal in kilometer"
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            {(["bank", "verzekeringen"] as OfficeSector[]).map((s) => {
              const on = sectors.includes(s);
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSector(s)}
                  className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors ${on ? "border-navy bg-navy text-white" : "border-line bg-white text-ink-soft hover:border-navy"}`}
                >
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{
                      background: on
                        ? s === "bank"
                          ? "#fff"
                          : "#febc14"
                        : COLOR[s],
                    }}
                  />
                  {SECTOR_LABEL[s]}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setOnlyJobs((v) => !v)}
              className={`rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors ${onlyJobs ? "border-ok bg-[#dcfce7] text-ok" : "border-line bg-white text-ink-soft hover:border-ok"}`}
            >
              Met vacatures
            </button>
            <button
              type="button"
              onClick={() => setOnlyVerified((v) => !v)}
              className={`rounded-full border px-3 py-1 text-[12.5px] font-medium transition-colors ${onlyVerified ? "border-gold-deep bg-gold-soft text-[#8a6300]" : "border-line bg-white text-ink-soft hover:border-gold-deep"}`}
            >
              Bevestigd
            </button>
          </div>
        </div>

        {/* Cijfers */}
        {data?.center && (
          <div className="grid grid-cols-4 gap-px border-b border-line bg-line">
            <Stat label="kantoren" value={counts.total} />
            <Stat label="banken" value={counts.bank} color="#1b1845" />
            <Stat
              label="verzekeringen"
              value={counts.verzekeringen}
              color="#e0a410"
            />
            <Stat label="met vacature" value={counts.jobs} color="#15803d" />
          </div>
        )}

        {/* Lijst */}
        <div ref={listRef} className="flex-1 overflow-y-auto">
          {!data?.center && !loading && (
            <div className="px-5 py-10 text-center text-[13.5px] text-ink-soft">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gold-soft text-[22px]">
                📍
              </div>
              Geef een woonplaats in om te beginnen.
              <div className="mt-1 text-[12px] text-ink-faint">
                Totaal op de kaart:{" "}
                {data?.stats.reduce((a, b) => a + b.n, 0) ?? 0} kantoren in
                Vlaanderen.
              </div>
            </div>
          )}
          {empty && (
            <div className="px-5 py-10 text-center text-[13.5px] text-ink-soft">
              Nog geen kantoren rond {data?.label}.
              {" Bouw de kaart hieronder op met Google Maps."}
            </div>
          )}
          {offices.length > 0 && (
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 px-2 pb-2">
                <input
                  value={filter}
                  onChange={(e) => setFilter(e.target.value)}
                  placeholder="Filter op naam, merk of gemeente"
                  className="min-w-0 flex-1 border-b border-line bg-transparent px-1 py-1 text-[13px] placeholder:text-ink-faint focus:border-navy focus:outline-none"
                />
                <span className="text-[11.5px] text-ink-faint shrink-0">
                  {offices.length} · {counts.brands} merken
                </span>
              </div>
              {offices.map((o) => (
                <OfficeRow
                  key={o.id}
                  o={o}
                  active={o.id === selectedId}
                  onHover={setHoverId}
                  onSelect={setSelectedId}
                />
              ))}
            </div>
          )}
        </div>

        {/* Beheer */}
        <div className="border-t border-line bg-paper px-5 py-3 text-[12px]">
          <details open={empty}>
            <summary className="cursor-pointer select-none font-medium text-ink-soft hover:text-navy">
              Kaart bijwerken rond {data?.label ?? "…"}
            </summary>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                disabled={!plaats || Boolean(busy)}
                onClick={() => act("build")}
                className="rounded-md bg-navy px-3 py-1.5 font-medium text-white hover:bg-navy-2 disabled:opacity-40"
              >
                {busy === "build" ? "Google Maps…" : "Google Maps afgaan"}
              </button>
              <button
                type="button"
                disabled={!plaats || Boolean(busy)}
                onClick={() => act("fvf")}
                className="rounded-md border border-line bg-white px-3 py-1.5 hover:bg-paper-soft disabled:opacity-40"
              >
                {busy === "fvf" ? "FVF…" : "FVF-gids"}
              </button>
              <button
                type="button"
                disabled={!plaats || Boolean(busy)}
                onClick={() => act("fsma")}
                className="rounded-md border border-line bg-white px-3 py-1.5 hover:bg-paper-soft disabled:opacity-40"
              >
                {busy === "fsma" ? "FSMA…" : "FSMA-register"}
              </button>
              <label
                className={`rounded-md border border-line bg-white px-3 py-1.5 hover:bg-paper-soft ${!plaats || busy ? "opacity-40" : "cursor-pointer"}`}
              >
                CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  disabled={!plaats || Boolean(busy)}
                  onChange={(e) =>
                    e.target.files?.[0] && uploadCsv(e.target.files[0], "fvf")
                  }
                />
              </label>
            </div>
            <p className="mt-2 text-ink-faint leading-relaxed">
              Google Maps zoekt elk kantoor per gemeente binnen de straal (max
              40 nieuwe zoekopdrachten per ronde; klik opnieuw voor de rest,
              cache 14 dagen). FVF-gids leest profielen van
              vindeenverzekeringsmakelaar.be via de zoekketen; het FSMA-register
              komt uit Instellingen → Sectoren. Twee bronnen = bevestigd.
            </p>
            {log.length > 0 && (
              <ul className="mt-2 space-y-0.5 text-ink-soft">
                {log.slice(0, 6).map((l, i) => (
                  <li key={i}>{l}</li>
                ))}
              </ul>
            )}
          </details>
          {error && <p className="mt-2 text-err">{error}</p>}
        </div>
      </aside>

      {/* Kaart */}
      <div className="relative min-h-[50vh] flex-1">
        <OfficeMap
          center={data?.center ?? null}
          radiusKm={data?.radius ?? radius}
          offices={offices}
          selectedId={selectedId}
          hoverId={hoverId}
          onSelect={setSelectedId}
        />
        <Legend />
        {loading && (
          <div className="pointer-events-none absolute left-1/2 top-4 z-[500] -translate-x-1/2 rounded-full bg-navy/90 px-4 py-1.5 text-[12.5px] font-medium text-white shadow-lg pulse">
            Kaart laden…
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color?: string;
}) {
  return (
    <div className="bg-sidebar px-3 py-2.5">
      <div
        className="mono text-[20px] font-semibold leading-none"
        style={{ color: color ?? "var(--navy)" }}
      >
        {value}
      </div>
      <div className="mt-1 text-[10.5px] uppercase tracking-wide text-ink-faint">
        {label}
      </div>
    </div>
  );
}

function OfficeRow({
  o,
  active,
  onHover,
  onSelect,
}: {
  o: OfficeView;
  active: boolean;
  onHover: (id: number | null) => void;
  onSelect: (id: number) => void;
}) {
  return (
    <button
      type="button"
      data-office={o.id}
      onMouseEnter={() => onHover(o.id)}
      onMouseLeave={() => onHover(null)}
      onClick={() => onSelect(o.id)}
      className={`group flex w-full items-start gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors ${active ? "bg-white shadow-[0_0_0_1px_var(--line),0_4px_14px_rgba(27,24,69,.08)]" : "hover:bg-white/70"}`}
    >
      <span
        className="relative mt-1 inline-block h-3 w-3 shrink-0 rounded-full"
        style={{
          background: COLOR[o.sector],
          outline: o.verified ? `2px solid ${COLOR[o.sector]}33` : undefined,
          outlineOffset: 2,
        }}
      >
        {o.openJobs > 0 && (
          <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-ok ring-2 ring-white" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-[13.5px] font-medium text-navy">
            {o.name}
          </span>
          <span className="mono shrink-0 text-[11.5px] text-ink-faint">
            {o.distanceKm} km
          </span>
        </span>
        <span className="block truncate text-[12px] text-ink-soft">
          {KIND_LABEL[o.kind]}
          {o.brand ? ` · ${o.brand}` : ""}
          {o.municipality ? ` · ${o.municipality}` : ""}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          {o.openJobs > 0 && (
            <Badge tone="ok">
              {o.openJobs} vacature{o.openJobs === 1 ? "" : "s"}
            </Badge>
          )}
          {o.verified && <Badge tone="gold">bevestigd</Badge>}
          {o.sources.includes("fsma") && <Badge>FSMA</Badge>}
          {o.sources.includes("fvf") && <Badge>FVF</Badge>}
          {o.approximate && <Badge tone="faint">ligging ±</Badge>}
          {!o.website && <Badge tone="faint">geen website</Badge>}
        </span>
      </span>
    </button>
  );
}

function Badge({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "ok" | "gold" | "faint";
}) {
  const cls =
    tone === "ok"
      ? "bg-[#dcfce7] text-ok"
      : tone === "gold"
        ? "bg-gold-soft text-[#8a6300]"
        : tone === "faint"
          ? "bg-transparent text-ink-faint border border-line"
          : "bg-paper-soft text-ink-soft";
  return (
    <span
      className={`rounded-full px-1.5 py-[1px] text-[10.5px] font-medium ${cls}`}
    >
      {children}
    </span>
  );
}

function Legend() {
  return (
    <div className="pointer-events-none absolute bottom-6 left-4 z-[500] rounded-xl border border-line bg-white/95 px-3.5 py-2.5 text-[11.5px] text-ink-soft shadow-[0_6px_24px_rgba(27,24,69,.12)] backdrop-blur">
      <div className="flex items-center gap-2 py-0.5">
        <span
          className="inline-block h-3 w-3 rounded-full border-2 border-white shadow"
          style={{ background: "#1b1845" }}
        />{" "}
        Bankkantoor
      </div>
      <div className="flex items-center gap-2 py-0.5">
        <span
          className="inline-block h-3 w-3 rounded-full border-2 border-white shadow"
          style={{ background: "#e0a410" }}
        />{" "}
        Verzekeringskantoor
      </div>
      <div className="flex items-center gap-2 py-0.5">
        <span
          className="relative inline-block h-3 w-3 rounded-full border-2 border-white shadow"
          style={{ background: "#1b1845" }}
        >
          <span className="absolute -right-1.5 -top-1.5 h-2.5 w-2.5 rounded-full bg-ok ring-2 ring-white" />
        </span>{" "}
        Open vacatures
      </div>
      <div className="flex items-center gap-2 py-0.5">
        <span
          className="inline-block h-3 w-3 rounded-full border-2 border-white"
          style={{ background: "#e0a410", boxShadow: "0 0 0 2px #e0a41055" }}
        />{" "}
        Bevestigd door 2 bronnen
      </div>
      <div className="flex items-center gap-2 py-0.5">
        <span
          className="inline-block h-3 w-3 rounded-full border-2 border-dashed border-white opacity-70"
          style={{ background: "#e0a410" }}
        />{" "}
        Ligging bij benadering
      </div>
    </div>
  );
}
