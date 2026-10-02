import pg from "pg";
import { config } from "../config.js";
import { logger } from "../logger.js";

export const pool = new pg.Pool({
  connectionString: config.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
});

pool.on("error", (err) => {
  logger.error({ err }, "idle postgres client error");
});


export async function closePool(): Promise<void> {
  await pool.end();
}
