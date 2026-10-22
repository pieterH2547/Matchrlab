/**
 * Registratie van ATS-adapters. Een nieuw ATS toevoegen = één bestand met
 * detect/listingUrl/fetchJobs schrijven en hier in de lijst zetten.
 * De volgorde bepaalt welke adapter wint als een pagina meerdere signaturen bevat.
 */
import type { AtsAdapter, AtsId } from "./types";
import { recruitee } from "./recruitee";
import { greenhouse } from "./greenhouse";
import { lever } from "./lever";
import { smartrecruiters } from "./smartrecruiters";
import { workable } from "./workable";
import { teamtailor } from "./teamtailor";
import { personio } from "./personio";
import { jobtoolz } from "./jobtoolz";
import { talentfinder } from "./talentfinder";

export const ATS_ADAPTERS: AtsAdapter[] = [
  jobtoolz,
  talentfinder,
  recruitee,
  teamtailor,
  workable,
  smartrecruiters,
  greenhouse,
  lever,
  personio,
];

export type AtsDetection = { adapter: AtsAdapter; slug: string };

export function detectAts(html: string, links: string[]): AtsDetection | null {
  for (const adapter of ATS_ADAPTERS) {
    const slug = adapter.detect(html, links);
    if (slug) return { adapter, slug };
  }
  return null;
}

export function getAdapter(id: AtsId): AtsAdapter | undefined {
  return ATS_ADAPTERS.find((a) => a.id === id);
}

export type { AtsAdapter, AtsId, AtsJob } from "./types";
