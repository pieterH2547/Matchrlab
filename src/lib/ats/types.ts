import type { NormalizedJob } from "@/lib/pipeline/types";

export type AtsId =
  | "jobtoolz"
  | "recruitee"
  | "teamtailor"
  | "workable"
  | "talentfinder"
  | "smartrecruiters"
  | "greenhouse"
  | "lever"
  | "personio";

export type AtsJob = Omit<NormalizedJob, "source" | "companyId"> & { source?: "company_site" };

export type AtsAdapter = {
  id: AtsId;
  /**
   * Zoekt de ATS-signatuur in de homepage-HTML (en links). Geeft de account-slug
   * terug of null. Werkt op ruwe HTML zodat ook embedded widgets gevonden worden.
   */
  detect(html: string, links: string[]): string | null;
  /** De publieke vacaturepagina voor deze slug; gebruikt als generieke fallback. */
  listingUrl(slug: string): string;
  /**
   * Haalt vacatures op via de publieke feed van het ATS. Geeft null als er geen
   * feed is of de feed faalt; de pijplijn valt dan terug op de generieke extractie.
   */
  fetchJobs(slug: string): Promise<AtsJob[] | null>;
  /** Of de feed-implementatie tegen een echte account geverifieerd is. */
  verified: boolean;
  /** Korte uitleg van het endpoint, voor de README. */
  endpointNote: string;
};
