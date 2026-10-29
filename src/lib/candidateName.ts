/**
 * Naam van de kandidaat zonder AI, meteen bij het opladen: uit de bestandsnaam ("CV_Jan_Peeters.pdf")
 * of de eerste regels van het cv. Enkel als het er echt als een naam uitziet; anders null.
 */
const NOT_A_NAME = /\b(cv|curriculum|vitae|resume|resumé|profiel|profile|kandidaat|candidate|sollicitatie|motivatie|brief|final|versie|version|nl|fr|en|def|definitief|nieuw|new|copy|kopie|scan|document|recruitrlab|\d{2,})\b/gi;
const WORD = /^[A-ZÀ-Ý][a-zà-ÿ'’-]+$|^(van|de|der|den|du|le|la|d'|vd|el|al|ten|ter|op)$/;

function asName(raw: string): string | null {
  const cleaned = raw
    .replace(/\.[a-z0-9]{2,4}$/i, "")
    .replace(/[_.\-–|()[\]]+/g, " ")
    .replace(NOT_A_NAME, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  // Ook "JAN PEETERS" of "jan peeters" uit een bestandsnaam.
  const words = cleaned.split(" ").map((w) => (/^(van|de|der|den|du|le|la|el|al|ten|ter|op)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()));
  const real = words.filter((w) => !/^(van|de|der|den|du|le|la|el|al|ten|ter|op)$/.test(w));
  if (words.length < 2 || words.length > 5 || real.length < 2) return null;
  if (!words.every((w) => WORD.test(w))) return null;
  return words.join(" ");
}

export function guessCandidateName(fileName: string | null | undefined, cvText: string | null | undefined): string | null {
  const fromFile = fileName ? asName(fileName) : null;
  if (fromFile) return fromFile;
  const lines = (cvText ?? "").split(/\n/).map((l) => l.trim()).filter(Boolean).slice(0, 6);
  for (const l of lines) {
    if (l.length > 40 || /[@\d:/]/.test(l)) continue;
    const n = asName(l);
    if (n) return n;
  }
  return null;
}

/** Label in de zijbalk als er (nog) geen naam is: de functie en regio, nooit "Onbekende kandidaat". */
export function fallbackLabel(profile: { job_titles?: string[]; region?: string } | null | undefined, fileName?: string | null): string {
  const title = profile?.job_titles?.[0];
  if (title) return `${title.charAt(0).toUpperCase()}${title.slice(1)}${profile?.region ? ` · ${profile.region}` : ""}`;
  if (fileName) return fileName.replace(/\.[a-z0-9]{2,4}$/i, "");
  return "Nieuwe zoektocht";
}
