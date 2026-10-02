import pgvector from "pgvector";
import { pool } from "../db/pool.js";
import { logger } from "../logger.js";
import { chunkText } from "./chunk.js";
import { embedDocuments } from "./embed.js";
import { extractText, type SourceType } from "./extract.js";

export interface IngestInput {
  documentId: string;
  path: string;
  sourceType: SourceType;
}

/**
 * Extracts, chunks and embeds a stored upload, then replaces the document's
 * chunks in one transaction. Moves the document pending → processing →
 * ready, or → failed. Never throws, so callers can fire and forget.
 */
export async function ingestDocument({ documentId, path, sourceType }: IngestInput): Promise<void> {
  const log = logger.child({ documentId });

  try {
    await setStatus(documentId, "processing");

    const text = await extractText(path, sourceType);
    if (!text) throw new Error("no extractable text in file");

    const chunks = chunkText(text);
    const embeddings = await embedDocuments(chunks);

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM chunks WHERE document_id = $1", [documentId]);
      await client.query(
        `INSERT INTO chunks (document_id, chunk_index, content, embedding)
         SELECT $1, t.idx, t.content, t.embedding::vector
         FROM unnest($2::int[], $3::text[], $4::text[]) AS t(idx, content, embedding)`,
        [
          documentId,
          chunks.map((_, i) => i),
          chunks,
          embeddings.map((e) => pgvector.toSql(e)),
        ],
      );
      await client.query(
        "UPDATE documents SET status = 'ready', updated_at = now() WHERE id = $1",
        [documentId],
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    } finally {
      client.release();
    }

    log.info({ chunks: chunks.length, chars: text.length }, "document ingested");
  } catch (err) {
    log.error({ err }, "ingestion failed");
    await setStatus(documentId, "failed").catch((e) => log.error({ err: e }, "could not mark failed"));
  }
}

async function setStatus(documentId: string, status: "processing" | "failed"): Promise<void> {
  await pool.query("UPDATE documents SET status = $2, updated_at = now() WHERE id = $1", [documentId, status]);
}
