import { config } from "../config.js";
import { ai, withRetry } from "../gemini.js";

// batchEmbedContents rejects more than 100 requests per call.
const BATCH_SIZE = 100;

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

/** Embeds stored content (uploaded file chunks). */
export const embedDocuments = (texts: string[]) => embed(texts, "RETRIEVAL_DOCUMENT");

/** Embeds search input (chat messages) to match against stored content. */
export const embedQueries = (texts: string[]) => embed(texts, "RETRIEVAL_QUERY");

/**
 * Embeds each text separately and returns vectors in input order.
 *
 * Each text must be sent as its own Content: gemini-embedding-2 merges a
 * plain string[] into a single aggregated embedding.
 */
async function embed(texts: string[], taskType: TaskType): Promise<number[][]> {
  const vectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const res = await withRetry("embed", () =>
      ai.models.embedContent({
        model: config.EMBED_MODEL,
        contents: batch.map((text) => ({ role: "user", parts: [{ text }] })),
        config: { taskType, outputDimensionality: config.EMBED_DIM },
      }),
    );

    const embeddings = res.embeddings ?? [];
    if (embeddings.length !== batch.length) {
      throw new Error(`expected ${batch.length} embeddings, got ${embeddings.length}`);
    }
    for (const e of embeddings) {
      if (e.values?.length !== config.EMBED_DIM) {
        throw new Error(`expected ${config.EMBED_DIM}-dim embedding, got ${e.values?.length}`);
      }
      vectors.push(e.values);
    }
  }
  return vectors;
}
