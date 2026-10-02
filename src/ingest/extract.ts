import { readFile } from "node:fs/promises";
import mammoth from "mammoth";
import { extractText as extractPdfText } from "unpdf";

export type SourceType = "pdf" | "docx" | "markdown" | "text";

/** Reads a stored upload and returns its plain text, whitespace-normalised. */
export async function extractText(path: string, sourceType: SourceType): Promise<string> {
  const buffer = await readFile(path);

  let raw: string;
  switch (sourceType) {
    case "pdf":
      raw = (await extractPdfText(new Uint8Array(buffer), { mergePages: true })).text;
      break;
    case "docx":
      raw = (await mammoth.extractRawText({ buffer })).value;
      break;
    case "markdown":
    case "text":
      raw = buffer.toString("utf8");
      break;
  }

  // Postgres text columns reject NUL; collapse whitespace so chunk sizes
  // measure real content rather than PDF layout padding.
  return raw.replace(/\u0000/g, "").replace(/\s+/g, " ").trim();
}
