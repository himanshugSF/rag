export const CHUNK_SIZE = 500;
export const CHUNK_OVERLAP = 50;

/**
 * Splits text into fixed-size character windows. Each chunk is `size`
 * characters and starts `size - overlap` after the previous one, so
 * neighbours share `overlap` characters. The last chunk may be shorter.
 */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  if (overlap >= size) throw new RangeError("overlap must be smaller than size");

  const step = size - overlap;
  const chunks: string[] = [];
  for (let start = 0; start < text.length; start += step) {
    const end = Math.min(start + size, text.length);
    chunks.push(text.slice(start, end));
    if (end === text.length) break;
  }
  return chunks;
}
