/**
 * Sectorbeheer, deel 1: registerbestanden inlezen (bv. de FSMA-lijst van verzekeringstussenpersonen) en ontdubbelen.
 *
 * Bron: de FSMA publiceert het register op haar dataportaal; robots.txt verbiedt het automatisch doorzoeken van
 * die portaalpagina's, dus we scrapen niets. De beheerder downloadt of ontvangt de lijst en laadt ze hier op
 * als CSV (Excel: "Opslaan als CSV"). Kolomnamen worden flexibel herkend (NL/FR/EN).
 */

export type RegistryRow = {
  name: string;
  enterpriseNumber: string | null;
  address: string | null;
  postcode: string | null;
  municipality: string | null;
  website: string | null;
  status: string | null;
  statute: string | null;
};

/** Ondernemingsnummer naar 10 cijfers ("BE 0123.456.789" -> "0123456789"); ongeldig = null. Met modulo-97-controle. */
export function normalizeEnterpriseNumber(raw: string | null | undefined): string | null {
  const digits = (raw ?? "").replace(/[^0-9]/g, "");
  const n = digits.length === 9 ? `0${digits}` : digits;
  if (!/^[01]\d{9}$/.test(n)) return null;
  const base = Number(n.slice(0, 8));
  const check = Number(n.slice(8));
  return 97 - (base % 97) === check ? n : null;
}

/** Ontdubbelsleutel: ondernemingsnummer als dat er is, anders sector + genormaliseerde naam + gemeente. */
export function dedupeKey(sector: string, row: Pick<RegistryRow, "enterpriseNumber" | "name" | "municipality">): string {
  if (row.enterpriseNumber) return `kbo:${row.enterpriseNumber}`;
  const norm = (s: string | null) =>
    (s ?? "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\b(nv|bv|bvba|sa|srl|sprl|cvba|vof|comm\.?v)\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  return `naam:${sector.toLowerCase()}:${norm(row.name)}:${norm(row.municipality)}`;
}

const COLS: Record<keyof RegistryRow, RegExp> = {
  name: /^(naam|name|nom|denominatie|d[eé]nomination|benaming|maatschappelijke naam|raison sociale|company)/i,
  enterpriseNumber: /(ondernemingsnummer|enterprise.?number|num[eé]ro d.?entreprise|kbo|bce|btw|vat|company.?number)/i,
  address: /^(adres|address|adresse|straat|rue|street)/i,
  postcode: /^(postcode|post.?code|code postal|zip)/i,
  municipality: /^(gemeente|plaats|stad|city|localit[eé]|commune|municipality|town)/i,
  website: /^(website|site|url|web)/i,
  status: /^(status|statut actif|actief|active|toestand)/i,
  statute: /^(statuut|statut|statute|categorie|cat[eé]gorie|hoedanigheid|type)/i,
};

/** Eenvoudige CSV-parser met ; of , en aanhalingstekens (Excel-export). */
export function parseCsv(text: string): string[][] {
  const clean = text.replace(/^﻿/, "");
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? "";
  const delim = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) {
      if (c === '"' && clean[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === delim) {
      row.push(cell.trim());
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && clean[i + 1] === "\n") i++;
      row.push(cell.trim());
      if (row.some((x) => x)) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell.trim());
  if (row.some((x) => x)) rows.push(row);
  return rows;
}

/**
 * Registerbestand naar rijen. Enkel actieve inschrijvingen (als er een statuskolom is) en, als er een
 * statuutkolom is, enkel rijen die bij `statuteFilter` passen (bv. /makelaar|courtier|broker/).
 */
export function parseRegistry(text: string, statuteFilter?: RegExp): { rows: RegistryRow[]; skipped: number; columns: string[] } {
  const table = parseCsv(text);
  if (table.length < 2) return { rows: [], skipped: 0, columns: [] };
  const header = table[0];
  const idx = Object.fromEntries(
    (Object.keys(COLS) as (keyof RegistryRow)[]).map((k) => [k, header.findIndex((h) => COLS[k].test(h.trim()))]),
  ) as Record<keyof RegistryRow, number>;
  const get = (r: string[], k: keyof RegistryRow) => (idx[k] >= 0 ? (r[idx[k]] ?? "").trim() || null : null);
  const rows: RegistryRow[] = [];
  let skipped = 0;
  for (const r of table.slice(1)) {
    const name = get(r, "name");
    if (!name) {
      skipped++;
      continue;
    }
    const status = get(r, "status");
    if (status && /(geschrapt|doorgehaald|inactief|inactive|radi[eé]|stopped|ended|niet actief|non actif)/i.test(status)) {
      skipped++;
      continue;
    }
    const statute = get(r, "statute");
    if (statuteFilter && statute && !statuteFilter.test(statute)) {
      skipped++;
      continue;
    }
    rows.push({
      name,
      enterpriseNumber: normalizeEnterpriseNumber(get(r, "enterpriseNumber")),
      address: get(r, "address"),
      postcode: get(r, "postcode")?.match(/\d{4}/)?.[0] ?? null,
      municipality: get(r, "municipality"),
      website: get(r, "website"),
      status,
      statute,
    });
  }
  return { rows, skipped, columns: header };
}

/** Ontdubbelen binnen één bestand (op ondernemingsnummer of naam + gemeente). */
export function dedupeRows(sector: string, rows: RegistryRow[]): RegistryRow[] {
  const seen = new Map<string, RegistryRow>();
  for (const r of rows) {
    const k = dedupeKey(sector, r);
    if (!seen.has(k)) seen.set(k, r);
  }
  return Array.from(seen.values());
}

/** Sectoren met hun filter op het statuut in het register. Uitbreidbaar zonder code elders aan te passen. */
export const SECTORS: Record<string, { label: string; statute?: RegExp; mapsQueries: string[] }> = {
  verzekeringsmakelaars: {
    label: "Verzekeringsmakelaars",
    statute: /(makelaar|courtier|broker)/i,
    mapsQueries: ["verzekeringsmakelaar", "verzekeringskantoor", "makelaar verzekeringen"],
  },
  "financiele-advieskantoren": {
    label: "Financiële advieskantoren",
    mapsQueries: ["financieel adviseur", "kredietbemiddelaar", "bankkantoor zelfstandig"],
  },
};
