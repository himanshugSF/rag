import pgvector from "pgvector";
import { pool } from "../db/pool.js";

export interface SearchHit {
  chunk_id: string;
  document_id: string;
  title: string | null;
  chunk_index: number;
  content: string;
  similarity: number;
}

/**
 * Nearest chunks by cosine similarity. Each query vector fetches its own
 * `perQuery` nearest chunks; hits are merged, keeping a chunk's best
 * similarity, and the top `limit` are returned best first.
 */
export async function searchChunks(
  queryVectors: number[][],
  { perQuery = 5, limit = 8 } = {},
): Promise<SearchHit[]> {
  const { rows } = await pool.query<SearchHit>(
    `SELECT r.id AS chunk_id, r.document_id, d.title, r.chunk_index, r.content,
            max(r.similarity)::float8 AS similarity
     FROM unnest($1::text[]) AS q(embedding)
     CROSS JOIN LATERAL (
       SELECT c.id, c.document_id, c.chunk_index, c.content,
              1 - (c.embedding <=> q.embedding::vector) AS similarity
       FROM chunks c
       ORDER BY c.embedding <=> q.embedding::vector
       LIMIT $2
     ) r
     JOIN documents d ON d.id = r.document_id
     GROUP BY r.id, r.document_id, d.title, r.chunk_index, r.content
     ORDER BY similarity DESC
     LIMIT $3`,
    [queryVectors.map((v) => pgvector.toSql(v)), perQuery, limit],
  );
  return rows;
}
