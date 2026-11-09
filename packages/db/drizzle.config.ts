import { defineConfig } from "drizzle-kit";

// Migrations/seed connect as the owner role (DATABASE_URL). The application
// runtime connects as the RLS-bound `tahseel_app` role (APP_DATABASE_URL).
export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://tahseel:tahseel@localhost:5432/tahseel" },
});
