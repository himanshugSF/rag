import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { config } from "../config.js";
import { logger } from "../logger.js";

// ESM: __dirname does not exist. Derive it from import.meta.url.
const here = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(here, "..", "..", "migrations");

/**
 * Applies pending *.sql files in migrations/, in filename order, each inside
 * its own transaction.
 *
 * Deliberately uses its own plain pg.Client rather than the shared pool: the
 * pool registers pgvector types on connect, but the `vector` type does not
 * exist until 0001 creates the extension. The migration runner must not depend
 * on the schema it is creating.
 */
export async function migrate(): Promise<void> {
  const client = new pg.Client({ connectionString: config.DATABASE_URL });
  await client.connect();

  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    const { rows } = await client.query<{ filename: string }>(
      "SELECT filename FROM schema_migrations",
    );
    const applied = new Set(rows.map((r) => r.filename));
    const pending = files.filter((f) => !applied.has(f));

    if (pending.length === 0) {
      logger.info({ total: files.length }, "no pending migrations");
      return;
    }

    for (const file of pending) {
      const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
      try {
        await client.query("BEGIN");
        await client.query(sql);
        await client.query(
          "INSERT INTO schema_migrations (filename) VALUES ($1)",
          [file],
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        logger.error({ err, file }, "migration failed; rolled back");
        throw err;
      }
      logger.info({ file }, "migration applied");
    }

    logger.info({ applied: pending.length }, "migrations complete");
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, "migration run failed");
      process.exit(1);
    });
}
