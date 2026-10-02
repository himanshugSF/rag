import { randomUUID } from "node:crypto";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { Router } from "express";
import multer from "multer";
import { config } from "../config.js";
import { pool } from "../db/pool.js";
import type { SourceType } from "../ingest/extract.js";
import { ingestDocument } from "../ingest/ingest.js";
import { HttpError } from "../middleware/index.js";

// Keyed by lowercase extension. Must stay within documents_source_type_chk.
const EXTENSIONS: Record<string, SourceType> = {
  ".pdf": "pdf",
  ".docx": "docx",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
};

function sourceTypeOf(filename: string): SourceType | undefined {
  return EXTENSIONS[extname(filename).toLowerCase()];
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
  defParamCharset: "utf8", // default latin1 garbles non-ASCII filenames
  fileFilter: (_req, file, cb) => {
    if (sourceTypeOf(file.originalname)) return cb(null, true);
    cb(
      new HttpError(
        415,
        "unsupported_file_type",
        `Allowed extensions: ${Object.keys(EXTENSIONS).join(", ")}`,
      ),
    );
  },
});

export const documentsRouter = Router();

/**
 * POST /documents — multipart/form-data with a `file` field and an optional
 * `title` field. Stores the file as UPLOAD_DIR/<id><ext> and creates a
 * `pending` documents row, then chunks and embeds it in the background.
 * Poll the document's status for `ready` or `failed`.
 */
documentsRouter.post("/", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) {
    throw new HttpError(400, "file_required", 'Send the file in a multipart field named "file"');
  }
  if (file.size === 0) {
    throw new HttpError(400, "empty_file", "Uploaded file is empty");
  }

  const sourceType = sourceTypeOf(file.originalname)!; // guaranteed by fileFilter
  const id = randomUUID();
  const path = join(config.UPLOAD_DIR, id + extname(file.originalname).toLowerCase());
  const title =
    (typeof req.body?.title === "string" && req.body.title.trim()) || file.originalname;

  await mkdir(config.UPLOAD_DIR, { recursive: true });
  await writeFile(path, file.buffer);

  try {
    const { rows } = await pool.query(
      `INSERT INTO documents (id, title, source_type)
       VALUES ($1, $2, $3)
       RETURNING id, title, source_type, status, created_at`,
      [id, title, sourceType],
    );
    res.status(201).json({ document: rows[0] });
  } catch (err) {
    await unlink(path).catch(() => {}); // don't leave an orphaned file behind
    throw err;
  }

  void ingestDocument({ documentId: id, path, sourceType });
});
