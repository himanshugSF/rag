/**
 * OpenAPI 3.1 description of the HTTP API, served at /docs (UI) and
 * /openapi.json (raw). Keep in sync with src/routes/*.
 */
export const openapi = {
  openapi: "3.1.0",
  info: {
    title: "RAG API",
    version: "1.0.0",
    description:
      "Upload documents, which are chunked and embedded with Gemini, then chat with them. " +
      "Answers are grounded in the stored chunks retrieved by vector search and cite them as [n].",
  },
  // Relative, so "Try it out" calls whichever host is serving these docs.
  servers: [{ url: "/" }],
  // The API has no authentication yet.
  security: [],
  tags: [
    { name: "Documents", description: "Upload files for ingestion" },
    { name: "Chat", description: "Ask questions answered from uploaded documents" },
  ],
  paths: {
    "/documents": {
      post: {
        operationId: "uploadDocument",
        tags: ["Documents"],
        summary: "Upload a document",
        description:
          "Stores the file and creates a `pending` document, then responds immediately. " +
          "In the background the text is extracted, split into 500-character chunks with " +
          "50 characters of overlap, embedded, and stored. The status then becomes `ready`, " +
          "or `failed` if any step errors.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["file"],
                properties: {
                  file: {
                    type: "string",
                    format: "binary",
                    description: "One file: .pdf, .docx, .md, .markdown or .txt. Max size is MAX_UPLOAD_MB (default 20 MB).",
                  },
                  title: {
                    type: "string",
                    description: "Display title. Defaults to the file name.",
                  },
                },
              },
            },
          },
        },
        responses: {
          "201": {
            description: "Document created. Ingestion continues in the background.",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { document: { $ref: "#/components/schemas/Document" } },
                },
              },
            },
          },
          "400": errorResponse("No file, an empty file, or more than one file (`file_required`, `empty_file`, `limit_file_count`)"),
          "413": errorResponse("File larger than MAX_UPLOAD_MB (`limit_file_size`)"),
          "415": errorResponse("Unsupported file extension (`unsupported_file_type`)"),
          "429": rateLimited(),
          "500": errorResponse("Unexpected server error (`internal_error`)"),
        },
      },
    },
    "/chat": {
      post: {
        operationId: "chat",
        tags: ["Chat"],
        summary: "Ask a question",
        description:
          "Splits the message into chunks the same way uploads are split, embeds each chunk, " +
          "retrieves the closest stored chunks by cosine similarity, and generates an answer " +
          "from them only. If the documents do not contain the answer, the reply says so. " +
          "The server keeps no conversation state: send earlier turns in `history`.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ChatRequest" },
              examples: {
                simple: { value: { message: "Who is eligible for work from home?" } },
                followUp: {
                  summary: "Follow-up with history",
                  value: {
                    message: "And how many days a week can they do it?",
                    history: [
                      { role: "user", content: "Who is eligible for work from home?" },
                      { role: "model", content: "Employees whose roles can be performed remotely may request WFH." },
                    ],
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Answer with the source chunks it was based on",
            content: { "application/json": { schema: { $ref: "#/components/schemas/ChatResponse" } } },
          },
          "400": errorResponse("Invalid body (`invalid_body`). `details` lists the failing fields."),
          "429": rateLimited(),
          "503": errorResponse("Gemini still busy or rate-limited after retries (`model_unavailable`). Try again shortly."),
          "500": errorResponse("Unexpected server error (`internal_error`)"),
        },
      },
    },
  },
  components: {
    schemas: {
      Document: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          title: { type: "string" },
          source_type: { type: "string", enum: ["pdf", "docx", "markdown", "text"] },
          status: { type: "string", enum: ["pending", "processing", "ready", "failed"] },
          created_at: { type: "string", format: "date-time" },
        },
        example: {
          id: "c85f181a-5206-48bb-be27-3a4799d07c70",
          title: "leave_policy.pdf",
          source_type: "pdf",
          status: "pending",
          created_at: "2026-09-27T10:51:28.743Z",
        },
      },
      ChatTurn: {
        type: "object",
        required: ["role", "content"],
        properties: {
          role: { type: "string", enum: ["user", "model"] },
          content: { type: "string", minLength: 1, maxLength: 8000 },
        },
      },
      ChatRequest: {
        type: "object",
        required: ["message"],
        properties: {
          message: { type: "string", minLength: 1, maxLength: 4000, description: "Trimmed; must not be blank." },
          history: {
            type: "array",
            maxItems: 20,
            items: { $ref: "#/components/schemas/ChatTurn" },
            description: "Earlier turns, oldest first. Used for the reply, not for retrieval.",
          },
        },
      },
      Source: {
        type: "object",
        properties: {
          ref: { type: "integer", description: "Matches the [n] citations in `answer`." },
          document_id: { type: "string", format: "uuid" },
          title: { type: ["string", "null"] },
          chunk_index: { type: "integer", description: "Position of the chunk within its document." },
          similarity: { type: "number", description: "Cosine similarity, 0 to 1. Relevant matches are typically about 0.7 or higher." },
          content: { type: "string" },
        },
      },
      ChatResponse: {
        type: "object",
        properties: {
          answer: { type: "string" },
          sources: { type: "array", items: { $ref: "#/components/schemas/Source" } },
        },
        example: {
          answer: "Eligible employees can work from home up to 2 working days per week [1].",
          sources: [
            {
              ref: 1,
              document_id: "c85f181a-5206-48bb-be27-3a4799d07c70",
              title: "leave_policy.pdf",
              chunk_index: 10,
              similarity: 0.7797,
              content: "…WFH is normally allowed up to 2 working days per week…",
            },
          ],
        },
      },
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
              details: { description: "Present on some errors, such as validation failures." },
            },
          },
        },
      },
    },
  },
} as const;

function errorResponse(description: string) {
  return {
    description,
    content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
  };
}

function rateLimited() {
  return {
    description: "More than 60 requests per minute from this IP. The `RateLimit-*` headers say when to retry.",
  };
}
