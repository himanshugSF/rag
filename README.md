# RAG API

An Express + TypeScript API for retrieval-augmented chat over your own documents. You upload PDF, Word, Markdown or text files. They are split into chunks, embedded with Gemini and stored in Postgres with pgvector. Chat questions are answered only from the most relevant chunks, with citations.

## How it works

**Upload (`POST /documents`)**
1. The file is saved to `UPLOAD_DIR` and a `documents` row is created with status `pending`. The request returns immediately.
2. In the background, text is extracted (`unpdf` for PDF, `mammoth` for DOCX), and whitespace is collapsed.
3. The text is split into **500-character chunks with 50 characters of overlap** ([src/ingest/chunk.ts](src/ingest/chunk.ts)).
4. Each chunk is embedded with `gemini-embedding-2` at 1536 dimensions, in batches of up to 100.
5. The chunks are written to the `chunks` table in one transaction, and the document becomes `ready`. If any step fails it becomes `failed`.

**Chat (`POST /chat`)**
1. The message is split with the same chunker, so a long question becomes several search queries.
2. Each query chunk is embedded and finds its 5 nearest stored chunks by cosine distance. The results are merged and the top 8 are kept.
3. `gemini-3.8-flash` answers using only those chunks and cites them as `[1]`, `[2]`, …. If the answer isn't in the documents, it says so.

## Requirements

- Node.js 22+
- PostgreSQL with the [pgvector](https://github.com/pgvector/pgvector) extension available
- A Gemini API key

## Setup

```bash
npm install
```

### 1. Database

The quickest option is the pgvector Docker image:

```bash
docker run -d --name rag_db \
  -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=rag \
  -p 5433:5432 pgvector/pgvector:pg17
```

To use a Postgres installed on your machine instead, create the database (`createdb rag`) and install pgvector for your version, for example `sudo apt install postgresql-17-pgvector`. The migration enables the extension but cannot install it.

### 2. Environment

Create a `.env` file in the project root:

```dotenv
# Required
DATABASE_URL=postgres://postgres:postgres@localhost:5433/rag
GEMINI_API_KEY=your-key

# Optional (defaults shown)
PORT=3000
NODE_ENV=development          # development | production
LOG_LEVEL=info                # fatal | error | warn | info | debug | trace
CORS_ORIGIN=*                 # or a comma-separated list of origins
UPLOAD_DIR=uploads
MAX_UPLOAD_MB=20
GEN_MODEL=gemini-3.8-flash
EMBED_MODEL=gemini-embedding-2
EMBED_DIM=1536                # must match vector(N) in migrations/01_init.sql
```

`npm run dev` and `npm run migrate` load `.env` with Node's `--env-file-if-exists` flag. There is no `dotenv`, so running a file directly without that flag starts with no configuration. Invalid or missing values stop the app at startup with a list of what's wrong.

### 3. Migrate

```bash
npm run migrate
```

This applies the pending `migrations/*.sql` files in filename order, each in a transaction. Applied files are recorded in `schema_migrations` and never run again. To change the schema, add a new numbered file rather than editing one that has already run.

### 4. Run

```bash
npm run dev
```

The API starts on `http://localhost:3000`, and the dev server reloads when files change.

## API

Interactive docs (Swagger UI) are at **http://localhost:3000/docs**, and the raw OpenAPI spec is at `/openapi.json`. The spec lives in [src/openapi.ts](src/openapi.ts); update it when you change a route.

### Upload a document

```bash
curl -F file=@policy.pdf -F title="Leave policy" http://localhost:3000/documents
```

```json
{ "document": { "id": "c85f…", "title": "Leave policy", "source_type": "pdf", "status": "pending", "created_at": "…" } }
```

Accepted extensions are `.pdf`, `.docx`, `.md`, `.markdown` and `.txt`, one file per request. There is no status endpoint yet, so check `documents.status` in the database to see when a document is `ready`.

### Chat

```bash
curl http://localhost:3000/chat -H 'content-type: application/json' \
  -d '{"message": "How many days a week can I work from home?"}'
```

```json
{
  "answer": "Eligible employees can work from home up to 2 working days per week [1].",
  "sources": [
    { "ref": 1, "document_id": "c85f…", "title": "Leave policy", "chunk_index": 10, "similarity": 0.78, "content": "…" }
  ]
}
```

The server keeps no conversation state. For follow-up questions, send earlier turns in `history`, oldest first, up to 20 turns:

```json
{
  "message": "And who approves it?",
  "history": [
    { "role": "user", "content": "How many days a week can I work from home?" },
    { "role": "model", "content": "Up to 2 working days per week [1]." }
  ]
}
```

### Errors

Every error has the same shape:

```json
{ "error": { "code": "unsupported_file_type", "message": "Allowed extensions: …" } }
```

| Status | Code | When |
|---|---|---|
| 400 | `file_required`, `empty_file`, `limit_file_count` | Bad upload |
| 400 | `invalid_body` | Chat body failed validation; `details` lists the fields |
| 413 | `limit_file_size` | File larger than `MAX_UPLOAD_MB` |
| 415 | `unsupported_file_type` | Extension not accepted |
| 429 | — | More than 60 requests per minute per IP |
| 503 | `model_unavailable` | Gemini busy or rate-limited after 3 retries |
| 500 | `internal_error` | Anything else (details are in the server log) |

## Project structure

```
migrations/          SQL migrations, applied in filename order
src/
  server.ts          Entry point: starts HTTP server, graceful shutdown
  app.ts             Express app: middleware, routes, Swagger UI
  config.ts          Env var schema (zod), validated at startup
  gemini.ts          Shared Gemini client + retry with backoff for 429/5xx
  openapi.ts         OpenAPI spec served at /docs
  routes/
    documents.ts     POST /documents: upload with multer
    chat.ts          POST /chat
  ingest/
    extract.ts       File → plain text
    chunk.ts         500/50 character chunker (used for uploads and queries)
    embed.ts         Gemini embeddings (document and query modes)
    ingest.ts        Extract → chunk → embed → store pipeline
  chat/
    search.ts        pgvector similarity search
    answer.ts        Prompt + grounded answer generation
  db/
    pool.ts          Shared pg pool
    migrate.ts       Migration runner
  middleware/        HttpError and the JSON error handler
```

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run with hot reload |
| `npm run migrate` | Apply pending migrations |
| `npm run typecheck` | Type-check without emitting |
| `npm run build` | Compile to `dist/` |
| `npm start` | Run the compiled build. Does **not** read `.env`, so set real environment variables, or run `node --env-file=.env dist/server.js` locally |

## Known limitations

- **Ingestion runs inside the API process.** If the server restarts while a document is being processed, that document stays `processing`. Re-upload it.
- **Retrieval uses only the current message**, not the chat history. Vague follow-ups like "what about the other one?" may match the wrong chunks.
- **There is no vector index yet.** Search scans every chunk, which is fine for a few thousand. Add an HNSW index on `chunks.embedding` as data grows.
- **`sources` is always populated**, even for off-topic questions. Real matches score about 0.7 or higher and unrelated ones about 0.5, so a UI should hide low-similarity sources.
- **There is no authentication.** Anyone who can reach the API can upload files and query all of them.
