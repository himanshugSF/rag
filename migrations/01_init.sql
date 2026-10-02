CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    title         text,
    source_type   text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now(),
    status        text NOT NULL DEFAULT 'pending',
    CONSTRAINT documents_source_type_chk CHECK (source_type IN ('pdf','docx','markdown','text','url')),
    CONSTRAINT documents_status_chk      CHECK (status IN ('pending','processing','ready','failed'))
);

CREATE TABLE chunks (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id   uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    chunk_index   integer NOT NULL,  -- position within the document, for ordering neighbours
    content       text NOT NULL,
    embedding     vector(1536) NOT NULL,  -- must match EMBED_DIM
    CONSTRAINT chunks_document_chunk_uniq UNIQUE (document_id, chunk_index)
);