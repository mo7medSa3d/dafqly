import "./load-env";
import { parseEnv, type AppEnv } from "@tahseel/core";

let cached: AppEnv | undefined;
/** Validated env; throws (fails fast) on the first server touch if invalid. */
export function env(): AppEnv {
  cached ??= parseEnv(process.env);
  return cached;
}
export function appDatabaseUrl(): string {
  const e = env();
  return e.APP_DATABASE_URL ?? e.DATABASE_URL;
}
