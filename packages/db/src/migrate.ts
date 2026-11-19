// Applies drizzle migrations as the owner role. Run via `pnpm db:migrate`.
import "./load-env";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { createDb } from "./client";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL is required"); process.exit(1); }
const { db, client } = createDb(url);
try {
  await migrate(db, { migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
  console.log("migrations applied");
} finally {
  await client.end();
}
