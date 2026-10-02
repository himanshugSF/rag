import { randomUUID } from "node:crypto";
import cors from "cors";
import express, { type Express } from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { pinoHttp } from "pino-http";
import swaggerUi from "swagger-ui-express";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { errorHandler } from "./middleware/index.js";
import { openapi } from "./openapi.js";
import { chatRouter } from "./routes/chat.js";
import { documentsRouter } from "./routes/documents.js";

export function createApp(): Express {
  const app = express();

  app.set("trust proxy", 1);
  app.use(pinoHttp({ logger, genReqId: () => randomUUID() }));
  app.use(helmet());
  app.use(cors({ origin: config.CORS_ORIGIN === "*" ? true : config.CORS_ORIGIN.split(",") }));

  app.use(rateLimit({ windowMs: 60_000, limit: 60, standardHeaders: true, legacyHeaders: false }));
  app.use(express.json({ limit: "1mb" })); // multer handles multipart per-route

  app.get("/openapi.json", (_req, res) => {
    res.json(openapi);
  });
  app.use("/docs", swaggerUi.serve, swaggerUi.setup(openapi));

  app.use("/documents", documentsRouter);
  app.use("/chat", chatRouter);

  app.use((_req, res) => {
    res.status(404).json({ error: { code: "not_found", message: "No such route" } });
  });

  app.use(errorHandler); // must be last, and must take four arguments
  return app;
}
