"use client";

import { useCallback, useEffect, useState } from "react";

type Overview = {
  admin: boolean;
  sectors: { key: string; label: string }[];
  entries: { sector: string; status: string; source: string; n: number }[];
  companies: { sector: string | null; status: string | null; n: number; open: number }[];
  activeJobs: { sector: string | null; n: number }[];
  errors: { name: string | null; domain: string; error: string | null; sector: string | null }[];
  employers: { name: string | null; domain: string; sector: string | null; status: string | null; open: number; jobsUrl: string | null; ats: string; source: string | null }[];
};

const STATUS: Record<string, string> = { queued: "in wachtrij", ok: "jobpagina ok", geen_jobpagina: "geen jobpagina", fout: "fout" };

/** Sectorgericht werkgeversbeheer: registerimport, website koppelen, wachtrij crawlen, overzicht. */
export function SectorAdmin({ me }: { me: string }) {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [password, setPassword] = useState("");
  const [sector, setSector] = useState("verzekeringsmakelaars");
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/sectors", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, []);
  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, [load]);

  async function post(body: unknown): Promise<Record<string, unknown>> {
    const r = await fetch("/api/admin/sectors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    if (!r.ok) throw new Error(String(j.error ?? `HTTP ${r.status}`));
    return j;
  }

  async function unlock() {
    setError(null);
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: me, password }) });
    setPassword("");
    if (!r.ok) setError("Wachtwoord klopt niet.");
    await load();
  }

  async function upload(file: File) {
    setBusy("import");
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("sector", sector);
      form.set("source", "fsma");
      const r = await fetch("/api/admin/sectors", { method: "POST", body: form });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setLog((l) => [`Import: ${j.received} rijen, ${j.unique} uniek, ${j.inserted} nieuw, ${j.updated} bijgewerkt, ${j.skipped} overgeslagen (niet actief of ander statuut).`, ...l]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
    await load();
  }

  /** Websites koppelen en crawlen tot de wachtrij leeg is (of na `rounds` rondes). */
  async function runQueue(rounds = 6) {
    for (let i = 0; i < rounds; i++) {
      const l = await post({ action: "link", sector, limit: 12 });
      setLog((x) => [`Websites: ${l.checked} bekeken, ${l.linked} gekoppeld, ${l.noWebsite} zonder website, ${l.errors} fouten.`, ...x]);
      if (!l.checked) break;
    }
    for (let i = 0; i < rounds; i++) {
      const c = await post({ action: "crawl", sector, limit: 12 });
      setLog((x) => [`Crawl: ${c.crawled} werkgevers, ${c.withJobs} met vacatures, ${c.jobs} vacatures, ${c.errors} fouten, € ${c.costEur}.`, ...x]);
      if (!c.crawled) break;
    }
  }

  async function proef() {
    setBusy("proef");
    setError(null);
    const t0 = Date.now();
    try {
      const s = await post({ action: "seed_maps", sector, region: "Antwerpen", radius: 15, limit: 50 });
      setLog((x) => [`Proef: ${s.rows} werkgevers via Google Maps rond Antwerpen (${s.queries} zoekopdrachten).`, ...x]);
      await runQueue(6);
      setLog((x) => [`Proef klaar in ${Math.round((Date.now() - t0) / 1000)} s.`, ...x]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
    await load();
  }

  async function queue() {
    setBusy("queue");
    setError(null);
    try {
      await runQueue(6);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
    setBusy(null);
    await load();
  }

  if (!data) return null;
  const sum = (xs: { n: number }[]) => xs.reduce((a, b) => a + b.n, 0);
  return (
    <section>
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-faint mb-3">Sectoren · werkgeversbeheer</h2>
      <div className="border border-line rounded-xl bg-paper p-4 space-y-4 text-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-ink-faint text-left">
                <th className="font-normal py-1">Sector</th>
                <th className="font-normal py-1 text-right">In register</th>
                <th className="font-normal py-1 text-right">Gekoppeld</th>
                <th className="font-normal py-1 text-right">Zonder website</th>
                <th className="font-normal py-1 text-right">Werkgevers</th>
                <th className="font-normal py-1 text-right">Met jobpagina</th>
                <th className="font-normal py-1 text-right">Actieve vacatures</th>
                <th className="font-normal py-1 text-right">Fouten</th>
              </tr>
            </thead>
            <tbody>
              {data.sectors.map((s) => {
                const e = data.entries.filter((x) => x.sector === s.key);
                const c = data.companies.filter((x) => x.sector === s.key);
                return (
                  <tr key={s.key} className="border-t border-line">
                    <td className="py-1.5">{s.label}</td>
                    <td className="py-1.5 text-right mono">{sum(e)}</td>
                    <td className="py-1.5 text-right mono">{sum(e.filter((x) => x.status === "gekoppeld"))}</td>
                    <td className="py-1.5 text-right mono">{sum(e.filter((x) => x.status === "geen_website"))}</td>
                    <td className="py-1.5 text-right mono">{sum(c)}</td>
                    <td className="py-1.5 text-right mono">{sum(c.filter((x) => x.status === "ok"))}</td>
                    <td className="py-1.5 text-right mono">{data.activeJobs.find((x) => x.sector === s.key)?.n ?? 0}</td>
                    <td className="py-1.5 text-right mono">{sum(c.filter((x) => x.status === "fout"))}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {!data.admin ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <span className="text-ink-soft">Importeren en crawlen is enkel voor beheerders.</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Teamwachtwoord" className="border border-line rounded-md px-2 py-1" />
            <button type="button" onClick={unlock} disabled={!password} className="rounded-md px-3 py-1 bg-navy text-white disabled:opacity-40">
              Ontgrendel
            </button>
          </div>
        ) : (
          <div className="space-y-3 border-t border-line pt-3">
            <div className="flex flex-wrap items-center gap-3">
              <select value={sector} onChange={(e) => setSector(e.target.value)} className="border border-line rounded-md px-2 py-1 bg-white">
                {data.sectors.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
              <label className="rounded-md px-3 py-1 border border-line cursor-pointer hover:bg-paper-soft">
                FSMA-lijst importeren (CSV)
                <input type="file" accept=".csv,text/csv" className="hidden" disabled={Boolean(busy)} onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
              <button type="button" onClick={queue} disabled={Boolean(busy)} className="rounded-md px-3 py-1 border border-line hover:bg-paper-soft disabled:opacity-40">
                Wachtrij verwerken
              </button>
              <button type="button" onClick={proef} disabled={Boolean(busy)} className="rounded-md px-3 py-1 bg-navy text-white disabled:opacity-40">
                Proef: 50 makelaars rond Antwerpen
              </button>
              {busy && <span className="text-ink-faint pulse">bezig…</span>}
            </div>
            <p className="text-xs text-ink-faint">
              FSMA-lijst: download het register van verzekeringstussenpersonen en sla op als CSV. Kolommen worden herkend (naam, ondernemingsnummer, adres, postcode,
              gemeente, statuut, status); enkel actieve makelaars, ontdubbeld op ondernemingsnummer. De proef gebruikt Google Maps (geen FSMA-bewijs).
            </p>
          </div>
        )}
        {error && <p className="text-err text-xs">{error}</p>}
        {log.length > 0 && (
          <ul className="text-xs text-ink-soft space-y-0.5">
            {log.slice(0, 12).map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        )}

        {data.employers.length > 0 && (
          <details>
            <summary className="cursor-pointer text-ink-soft text-xs">Werkgevers ({data.employers.length})</summary>
            <table className="w-full text-xs mt-2">
              <tbody>
                {data.employers.map((e) => (
                  <tr key={e.domain} className="border-t border-line">
                    <td className="py-1">{e.name ?? e.domain}</td>
                    <td className="py-1 text-ink-faint">{e.domain}</td>
                    <td className="py-1">{STATUS[e.status ?? ""] ?? e.status ?? "—"}</td>
                    <td className="py-1 text-right mono">{e.open}</td>
                    <td className="py-1 text-ink-faint">{e.source}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        )}
        {data.errors.length > 0 && (
          <details>
            <summary className="cursor-pointer text-warn text-xs">Crawlfouten ({data.errors.length})</summary>
            <ul className="text-xs mt-2 space-y-0.5">
              {data.errors.map((e) => (
                <li key={e.domain}>
                  {e.name ?? e.domain}: {e.error}
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    </section>
  );
}
