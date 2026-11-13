import "./load-env";
import { parseEnv, type AppEnv } from "@tahseel/core";

let cached: AppEnv | undefined;
/** Validated env; throws (fails fast) on the first server touch if invalid. */
export function env(): AppEnv {
  cached ??= parseEnv(process.env);
  return cached;
}
export interface RuntimeModeFlags {
  dryRunMessaging: boolean;
  fakeAi: boolean;
  fakePayments: boolean;
}
/**
 * Which parts of this deployment are simulated rather than live. Shown in
 * the AppShell banner so a demo/dry-run deployment can never be mistaken
 * for production: messages are queued but not sent (DRY_RUN_MESSAGING),
 * AI answers come from the deterministic fake provider (no API key), and
 * payment links come from the fake provider (Paymob not configured).
 */
let warnedProductionDryRun = false;
export function runtimeModeFlags(): RuntimeModeFlags {
  const e = env();
  // F-02: same silent trap as the worker boot warning — production with
  // dry-run on and WhatsApp configured looks live but never sends. Warn
  // once per process in the server log (the AppShell banner covers the UI).
  if (!warnedProductionDryRun && e.NODE_ENV === "production" && e.DRY_RUN_MESSAGING && e.WHATSAPP_ACCESS_TOKEN) {
    warnedProductionDryRun = true;
    console.warn("[env] DRY_RUN_MESSAGING=true in production with WhatsApp configured: reminders are queued but NEVER sent. Set DRY_RUN_MESSAGING=false to go live.");
  }
  return {
    dryRunMessaging: e.DRY_RUN_MESSAGING,
    fakeAi: !(e.GEMINI_API_KEY || e.ANTHROPIC_API_KEY || e.AI_API_KEY),
    fakePayments: !(e.PAYMOB_SECRET_KEY && e.PAYMOB_PUBLIC_KEY && e.PAYMOB_INTEGRATION_ID),
  };
}

let warnedAppDbFallback = false;
/**
 * The runtime (RLS-bound) connection URL. In production APP_DATABASE_URL is
 * mandatory: silently falling back to the owner DATABASE_URL would run
 * tenant requests as the table owner and bypass RLS entirely. In
 * development/test the fallback is allowed but warned about once.
 */
export function appDatabaseUrl(): string {
  const e = env();
  if (e.APP_DATABASE_URL) return e.APP_DATABASE_URL;
  if (e.NODE_ENV === "production") {
    throw new Error("APP_DATABASE_URL is required in production (the owner DATABASE_URL bypasses RLS)");
  }
  if (!warnedAppDbFallback) {
    warnedAppDbFallback = true;
    console.warn("[env] APP_DATABASE_URL is not set — using owner DATABASE_URL. Tenant isolation relies on RLS, which the owner role bypasses; set APP_DATABASE_URL (tahseel_app) before deploying.");
  }
  return e.DATABASE_URL;
}
