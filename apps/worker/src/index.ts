import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { parseEnv } from "@tahseel/core";
import { assertAppRole, createDb, createAppDb } from "@tahseel/db";
import { SystemClock } from "@tahseel/providers";
import { createEngineDeps } from "@tahseel/reminders";
import {
  processPlannerTick, processReplanInvoice, processReplanTenant,
  processDispatchTick, processMaintenanceTick,
} from "./processors";

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

// Runtime tenant access must use the RLS-bound role. The owner URL is
// retained only for the engine's explicitly platform-scoped enumeration.
if (env.NODE_ENV === "production" && !env.APP_DATABASE_URL) {
  throw new Error("APP_DATABASE_URL is required in production; DATABASE_URL bypasses tenant RLS");
}

// BullMQ requires maxRetriesPerRequest: null for Worker connections; Queue
// (producer) connections should stay separate with bounded retries.
const workerConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
const queueConnection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: 3 });
workerConnection.on("error", (err) => log.error({ err }, "worker redis error"));
queueConnection.on("error", (err) => log.error({ err }, "queue redis error"));
const appConnection = createAppDb(env.APP_DATABASE_URL ?? env.DATABASE_URL);
const ownerConnection = createDb(env.DATABASE_URL);
const engine = createEngineDeps({
  app: appConnection.db,
  owner: ownerConnection.db,
  dryRunMessaging: env.DRY_RUN_MESSAGING,
  whatsappApiVersion: env.WHATSAPP_API_VERSION,
  whatsappPhoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
  whatsappAccessToken: env.WHATSAPP_ACCESS_TOKEN,
  appUrl: env.APP_URL,
  sessionSecret: env.SESSION_SECRET,
});
const deps = { clock: new SystemClock(), dryRun: env.DRY_RUN_MESSAGING, engine };

const plannerQueue = new Queue("reminders-planner", { connection: queueConnection });
const dispatcherQueue = new Queue("reminders-dispatcher", { connection: queueConnection });
const maintenanceQueue = new Queue("maintenance", { connection: queueConnection });
plannerQueue.on("error", (err) => log.error({ err }, "planner queue error"));
dispatcherQueue.on("error", (err) => log.error({ err }, "dispatcher queue error"));
maintenanceQueue.on("error", (err) => log.error({ err }, "maintenance queue error"));

// Workers are deliberately created only after the RLS role assertion in
// main(). BullMQ Workers autorun by default; constructing them at module
// scope could consume a queued job before the security check completes.
let plannerWorker: Worker | null = null;
let dispatcherWorker: Worker | null = null;
let maintenanceWorker: Worker | null = null;

async function main(): Promise<void> {
  // Fail closed before any repeatable job can touch tenant data. A wrong
  // role silently disables PostgreSQL RLS and voids tenant isolation.
  if (env.NODE_ENV === "production" || env.APP_DATABASE_URL) {
    await assertAppRole(appConnection.client);
  }
  plannerWorker = new Worker(
    "reminders-planner",
    async (job) => {
      if (job.name === "replan-invoice") {
        return processReplanInvoice(deps, job.data as { tenantId: string; invoiceId: string });
      }
      if (job.name === "replan-tenant") {
        return processReplanTenant(deps, job.data as { tenantId: string });
      }
      return processPlannerTick(deps);
    },
    { connection: workerConnection, lockDuration: 120_000 },
  );
  dispatcherWorker = new Worker(
    "reminders-dispatcher",
    async (job) => {
      const tenantId = (job.data as { tenantId?: string } | undefined)?.tenantId;
      return processDispatchTick(tenantId ? { ...deps, tenantId } : deps);
    },
    { connection: workerConnection, lockDuration: 120_000 },
  );
  maintenanceWorker = new Worker("maintenance", async () => processMaintenanceTick(deps), { connection: workerConnection, lockDuration: 120_000 });
  plannerWorker.on("completed", (job, result) => log.info({ job: job.id, name: job.name, result }, "planner tick done"));
  dispatcherWorker.on("completed", (job, result) => log.info({ job: job.id, result }, "dispatch tick done"));
  maintenanceWorker.on("completed", (job, result) => log.info({ job: job.id, result }, "maintenance tick done"));
  plannerWorker.on("failed", (_job, err) => log.error({ err }, "planner tick failed"));
  dispatcherWorker.on("failed", (_job, err) => log.error({ err }, "dispatcher tick failed"));
  maintenanceWorker.on("failed", (_job, err) => log.error({ err }, "maintenance tick failed"));
  plannerWorker.on("error", (err) => log.error({ err }, "planner worker error"));
  dispatcherWorker.on("error", (err) => log.error({ err }, "dispatcher worker error"));
  maintenanceWorker.on("error", (err) => log.error({ err }, "maintenance worker error"));
  // Repeatable jobs (BUILD_PLAN §3): planner nightly, dispatcher every minute.
  // The engines behind them land in M2; the schedules are wired now.
  await plannerQueue.add("nightly", {}, { repeat: { pattern: "0 2 * * *", tz: env.DEFAULT_TIMEZONE }, removeOnComplete: 50, removeOnFail: 50 });
  await dispatcherQueue.add("every-minute", {}, { repeat: { every: 60_000 }, removeOnComplete: 50, removeOnFail: 50 });
  // M3/M6: nightly payload-retention purge (90-day tombstone) + failed webhook replay.
  await maintenanceQueue.add("nightly", {}, { repeat: { pattern: "0 3 * * *", tz: env.DEFAULT_TIMEZONE }, removeOnComplete: 50, removeOnFail: 50 });
  // One immediate tick so a fresh boot proves the plumbing end to end.
  await plannerQueue.add("boot-tick", {}, { removeOnComplete: 50, removeOnFail: 50 });
  await dispatcherQueue.add("boot-tick", {}, { removeOnComplete: 50, removeOnFail: 50 });
  // F-02: production + dry-run + a configured WhatsApp number is the silent
  // trap — the operator sees a working number and assumes messages go out,
  // but the dry-run renderer queues them and never sends. Warn loudly at
  // boot (deliberately NOT a throw: dry-run is the safe default).
  if (env.NODE_ENV === "production" && env.DRY_RUN_MESSAGING && env.WHATSAPP_ACCESS_TOKEN) {
    log.warn("DRY_RUN_MESSAGING=true in production with WhatsApp configured: reminders are queued but NEVER sent. Set DRY_RUN_MESSAGING=false to go live.");
  }
  log.info({ dryRunMessaging: env.DRY_RUN_MESSAGING, whatsappConfigured: Boolean(env.WHATSAPP_ACCESS_TOKEN), redis: env.REDIS_URL.replace(/\/\/.*@/, "//***@") }, "tahseel worker ready (M2 reminder engine wired)");
}

let shuttingDown = false;
async function shutdown(signal: string, exitCode = 0): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info({ signal }, "shutting down");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const closeTimeout = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, 10_000);
    timer.unref();
  });
  await Promise.race([
    (async () => {
      await Promise.allSettled([
        plannerWorker?.close(),
        dispatcherWorker?.close(),
        maintenanceWorker?.close(),
        plannerQueue.close(),
        dispatcherQueue.close(),
        maintenanceQueue.close(),
      ]);
      await Promise.allSettled([
        workerConnection.quit().catch(() => workerConnection.disconnect()),
        queueConnection.quit().catch(() => queueConnection.disconnect()),
        appConnection.client.end(),
        ownerConnection.client.end(),
      ]);
    })(),
    closeTimeout,
  ]);
  if (timer) clearTimeout(timer);
  process.exit(exitCode);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

main().catch((err) => {
  log.error({ err }, "worker failed to start");
  void shutdown("STARTUP_ERROR", 1);
});
