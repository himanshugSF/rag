import { createApp } from "./app.js";
import { config } from "./config.js";
import { closePool } from "./db/pool.js";
import { logger } from "./logger.js";

const app = createApp();
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, env: config.NODE_ENV }, "api listening");
});

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "shutting down");

  const forced = setTimeout(() => {
    logger.warn("graceful shutdown timed out; forcing exit");
    process.exit(1);
  }, 10_000);
  forced.unref();

  await new Promise<void>((resolve) => server.close(() => resolve()));
  await closePool();
  logger.info("shutdown complete");
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
