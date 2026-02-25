import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Kysely, Migrator, FileMigrationProvider, PostgresDialect } from "kysely";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is required");
    process.exit(1);
  }

  const db = new Kysely({
    dialect: new PostgresDialect({
      pool: new pg.Pool({ connectionString }),
    }),
  });

  const migrator = new Migrator({
    db,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder: path.join(__dirname, "..", "migrations"),
    }),
  });

  const { error, results } = await migrator.migrateToLatest();

  results?.forEach((it) => {
    if (it.status === "Success") {
      console.log(`  ✓ ${it.migrationName}`);
    } else if (it.status === "Error") {
      console.error(`  ✕ ${it.migrationName}`);
    }
  });

  if (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }

  if (!results?.length) {
    console.log("  No pending migrations.");
  }

  await db.destroy();
}

main();
