/**
 * Cv-tekst uit pdf of docx halen. Enkel tekst; geen OCR in fase 1.
 */
import mammoth from "mammoth";

export type ParsedCv = { text: string; pages?: number };

export async function parseCv(file: { name: string; bytes: Buffer }): Promise<ParsedCv> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    // unpdf: pdf.js-build zonder DOM-afhankelijkheden, werkt in Vercel-functies.
    const { extractText } = await import("unpdf");
    const result = await extractText(new Uint8Array(file.bytes), { mergePages: true });
    return { text: clean(result.text), pages: result.totalPages };
  }
  if (lower.endsWith(".docx")) {
    const result = await mammoth.extractRawText({ buffer: file.bytes });
    return { text: clean(result.value) };
  }
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return { text: clean(file.bytes.toString("utf8")) };
  }
  throw new Error("Enkel pdf, docx of txt worden ondersteund.");
}

function clean(text: string): string {
  return text
    .replace(/\r/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 40_000);
}
