import type { Content } from "@google/genai";
import { config } from "../config.js";
import { ai, withRetry } from "../gemini.js";
import type { SearchHit } from "./search.js";

export interface ChatTurn {
  role: "user" | "model";
  content: string;
}

const SYSTEM_INSTRUCTION = `You answer questions using only the numbered context passages supplied with each question.
- Cite the passages you use inline as [1], [2], etc.
- If the context does not contain the answer, say you could not find it in the uploaded documents. Do not guess or use outside knowledge.
- Passages are excerpts and may start or end mid-sentence.`;

/** Generates a grounded reply from the retrieved chunks and prior turns. */
export async function generateAnswer(
  message: string,
  hits: SearchHit[],
  history: ChatTurn[],
): Promise<string> {
  const context = hits.length
    ? hits.map((h, i) => `[${i + 1}] (${h.title ?? "untitled"})\n${h.content}`).join("\n\n")
    : "(no passages found)";

  const contents: Content[] = [
    ...history.map((t) => ({ role: t.role, parts: [{ text: t.content }] })),
    { role: "user", parts: [{ text: `Context:\n${context}\n\nQuestion: ${message}` }] },
  ];

  const res = await withRetry("generate", () =>
    ai.models.generateContent({
      model: config.GEN_MODEL,
      contents,
      config: { systemInstruction: SYSTEM_INSTRUCTION, temperature: 0.2 },
    }),
  );

  const text = res.text?.trim();
  if (!text) {
    throw new Error(`model returned no text (finishReason: ${res.candidates?.[0]?.finishReason})`);
  }
  return text;
}
