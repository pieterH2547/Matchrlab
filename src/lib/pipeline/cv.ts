/**
 * Cv-tekst uit pdf of docx halen. Enkel tekst; geen OCR in fase 1.
 */
import mammoth from "mammoth";

export type ParsedCv = { text: string; pages?: number };

export async function parseCv(file: { name: string; bytes: Buffer }): Promise<ParsedCv> {
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: file.bytes });
    try {
      const result = await parser.getText();
      return { text: clean(result.text), pages: result.total };
    } finally {
      await parser.destroy().catch(() => undefined);
    }
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
