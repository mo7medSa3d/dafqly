import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { parseEnv } from "@tahseel/core";
import { createDb, createAppDb } from "@tahseel/db";
import {
  SystemClock, FakeMessagingProvider, DryRunMessagingProvider, NotConfiguredSmsProvider,
  WhatsAppCloudProvider, type TextCapableProvider,
} from "@tahseel/providers";
import { quotaExceededFromDb, type EngineDeps } from "@tahseel/reminders";
import { processPlannerTick, processDispatchTick } from "./processors";

// Same monorepo root-.env convenience as the web app (no-op in production).
(function loadRootEnv() {
  if (process.env.DATABASE_URL) return;
  const candidate = resolve(process.cwd(), "../../.env");
  if (!existsSync(candidate)) return;
  for (const line of readFileSync(candidate, "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || !m[1] || process.env[m[1]] !== undefined) continue;
    let value = m[2] ?? "";
    // dotenv semantics: quoted values keep everything up to the closing
    // quote; unquoted values end at an inline " #" comment. (.env.example
    // uses trailing comments, e.g. NEXT_PUBLIC_BRAND_FONT=off  # on only…)
    if (value.startsWith('"')) {
      const end = value.indexOf('"', 1);
      value = end > 0 ? value.slice(1, end) : value.replace(/^"|"$/g, "");
    } else {
      value = value.split(" #")[0]?.trim() ?? "";
    }
    process.env[m[1]] = value;
  }
})();

const env = parseEnv(process.env); // fails fast on invalid env
// §8 (M6): no PII in logs — any phone-shaped field is censored by pino's
// redactor before it can reach stdout (see core maskPhone for display use).
const log = pino({
  level: env.LOG_LEVEL,
  redact: ["phoneE164", "toE164", "debtorPhone", "phone", "waId", "*.phoneE164", "*.toE164", "*.phone"],
});

const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });

// Engine wiring (M2, ADR-016): the real WhatsApp adapter only when a token
// is configured; DRY_RUN_MESSAGING=true (the default) wraps everything in
// the dry-run renderer, so the worker can never send for real in dev/CI.
const realWhatsapp: TextCapableProvider = env.WHATSAPP_ACCESS_TOKEN
  ? new WhatsAppCloudProvider({
      apiVersion: env.WHATSAPP_API_VERSION, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
      accessToken: env.WHATSAPP_ACCESS_TOKEN,
    })
  : new FakeMessagingProvider();
const whatsapp = env.DRY_RUN_MESSAGING ? new DryRunMessagingProvider(realWhatsapp) : realWhatsapp;
const smsBase: TextCapableProvider = env.SMS_API_KEY ? new FakeMessagingProvider() : new NotConfiguredSmsProvider();
const sms = env.DRY_RUN_MESSAGING ? new DryRunMessagingProvider(smsBase) : smsBase;
const engineAppDb = createAppDb(env.APP_DATABASE_URL ?? env.DATABASE_URL).db;
const engine: EngineDeps = {
  app: engineAppDb,
  owner: createDb(env.DATABASE_URL).db,
  providers: { whatsapp, sms },
  appUrl: env.APP_URL,
  // F13: block sends when the tenant is at/over its monthly quota.
  quotaExceeded: (tenantId: string) => quotaExceededFromDb(engineAppDb, tenantId, new Date()),
};
const deps = { clock: new SystemClock(), dryRun: env.DRY_RUN_MESSAGING, engine };

const plannerQueue = new Queue("reminders-planner", { connection });
const dispatcherQueue = new Queue("reminders-dispatcher", { connection });

const plannerWorker = new Worker("reminders-planner", async () => processPlannerTick(deps), { connection });
const dispatcherWorker = new Worker("reminders-dispatcher", async () => processDispatchTick(deps), { connection });

plannerWorker.on("completed", (job, result) => log.info({ job: job.id, result }, "planner tick done"));
dispatcherWorker.on("completed", (job, result) => log.info({ job: job.id, result }, "dispatch tick done"));
plannerWorker.on("failed", (_job, err) => log.error({ err }, "planner tick failed"));
dispatcherWorker.on("failed", (_job, err) => log.error({ err }, "dispatcher tick failed"));

async function main(): Promise<void> {
  // Repeatable jobs (BUILD_PLAN §3): planner nightly, dispatcher every minute.
  // The engines behind them land in M2; the schedules are wired now.
  await plannerQueue.add("nightly", {}, { repeat: { pattern: "0 2 * * *", tz: env.DEFAULT_TIMEZONE }, removeOnComplete: 50 });
  await dispatcherQueue.add("every-minute", {}, { repeat: { every: 60_000 }, removeOnComplete: 50 });
  // One immediate tick so a fresh boot proves the plumbing end to end.
  await plannerQueue.add("boot-tick", {});
  await dispatcherQueue.add("boot-tick", {});
  log.info({ dryRunMessaging: env.DRY_RUN_MESSAGING, whatsappConfigured: Boolean(env.WHATSAPP_ACCESS_TOKEN), redis: env.REDIS_URL.replace(/\/\/.*@/, "//***@") }, "tahseel worker ready (M2 reminder engine wired)");
}

async function shutdown(signal: string): Promise<void> {
  log.info({ signal }, "shutting down");
  await plannerWorker.close();
  await dispatcherWorker.close();
  await plannerQueue.close();
  await dispatcherQueue.close();
  connection.disconnect();
  process.exit(0);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((err) => {
  log.error({ err }, "worker failed to start");
  process.exit(1);
});
