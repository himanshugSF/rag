import { Router } from "express";
import { z } from "zod";
import { generateAnswer } from "../chat/answer.js";
import { searchChunks } from "../chat/search.js";
import { chunkText } from "../ingest/chunk.js";
import { embedQueries } from "../ingest/embed.js";
import { HttpError } from "../middleware/index.js";

const body = z.object({
  message: z.string().trim().min(1).max(4000),
  // Prior turns, oldest first. The client keeps the conversation; the server is stateless.
  history: z
    .array(z.object({ role: z.enum(["user", "model"]), content: z.string().min(1).max(8000) }))
    .max(20)
    .default([]),
});

export const chatRouter = Router();

/**
 * POST /chat — { message, history? }. Chunks the message the same way
 * uploads are chunked, embeds each chunk, retrieves the nearest stored
 * chunks and answers from them.
 */
chatRouter.post("/", async (req, res) => {
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    throw new HttpError(400, "invalid_body", "Invalid request body", z.flattenError(parsed.error));
  }
  const { message, history } = parsed.data;

  const queryVectors = await embedQueries(chunkText(message));
  const hits = await searchChunks(queryVectors);
  const answer = await generateAnswer(message, hits, history);

  res.json({
    answer,
    // Numbered to match the [n] citations in the answer.
    sources: hits.map((h, i) => ({
      ref: i + 1,
      document_id: h.document_id,
      title: h.title,
      chunk_index: h.chunk_index,
      similarity: Number(h.similarity.toFixed(4)),
      content: h.content,
    })),
  });
});
