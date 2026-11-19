import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Queue, UnrecoverableError, Worker, type Job } from "bullmq";
import { Redis } from "ioredis";
import pino from "pino";
import { parseEnv } from "@tahseel/core";
import { assertAppRole, createDb, createAppDb } from "@tahseel/db";
import { SystemClock } from "@tahseel/providers";
import { createEngineDeps } from "@tahseel/reminders";
import {
  InvalidJobPayloadError,
  processPlannerTick, processReplanInvoice, processReplanTenant,
  processDispatchTick, processMaintenanceTick,
} from "./processors";

// Same monorepo root-.env convenience as the web app (no-op in production).
(function loadRootEnv() {
  if (process.env.DATABASE_URL) return;
  const candidates = [
    resolve(process.cwd(), ".env"),
    resolve(process.cwd(), "../../.env"),
  ];
  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    for (const rawLine of readFileSync(candidate, "utf8").split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(rawLine);
      if (!m || !m[1] || process.env[m[1]] !== undefined) continue;
      let value = m[2] ?? "";
      // dotenv semantics: quoted values keep everything up to the closing
      // quote; unquoted values end at an inline " #" comment. (.env.example
      // uses trailing comments, e.g. NEXT_PUBLIC_BRAND_FONT=off  # on only…)
      if (value.startsWith('"') || value.startsWith("'")) {
        const quote = value[0]!;
        const end = value.indexOf(quote, 1);
        value = end > 0 ? value.slice(1, end) : value.slice(1);
      } else {
        value = value.split(" #")[0]?.trim() ?? "";
      }
      process.env[m[1]] = value;
    }
    return;
  }
})();

const env = parseEnv(process.env); // fails fast on invalid env
// §8 (M6): no PII or secrets in logs — phone-shaped and credential fields are
// censored by pino's redactor before reaching stdout.
const log = pino({
  level: env.LOG_LEVEL,
  redact: [
    "phoneE164", "toE164", "debtorPhone", "phone", "waId",
    "*.phoneE164", "*.toE164", "*.phone",
    "*.authorization", "*.password", "*.token", "*.accessToken", "*.secret",
  ],
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

// BullMQ production lock tuning (>2x outbound HTTP timeout, explicit stall cap)
// so I/O-heavy reminder/maintenance ticks do not prematurely stall and double-run.
const WORKER_LOCK_OPTIONS = {
  lockDuration: 60_000,
  stalledInterval: 30_000,
  maxStalledCount: 2,
} as const;

const SHUTDOWN_TIMEOUT_MS = 15_000;

const plannerQueue = new Queue("reminders-planner", {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 5_000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});
const dispatcherQueue = new Queue("reminders-dispatcher", {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: "exponential", delay: 2_000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});
const maintenanceQueue = new Queue("maintenance", {
  connection: queueConnection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: "exponential", delay: 10_000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});
plannerQueue.on("error", (err) => log.error({ err }, "planner queue error"));
dispatcherQueue.on("error", (err) => log.error({ err }, "dispatcher queue error"));
maintenanceQueue.on("error", (err) => log.error({ err }, "maintenance queue error"));

// Workers are deliberately created only after the RLS role assertion in
// main(). BullMQ Workers autorun by default; constructing them at module
// scope could consume a queued job before the security check completes.
let plannerWorker: Worker | null = null;
let dispatcherWorker: Worker | null = null;
let maintenanceWorker: Worker | null = null;

function jobDurationMs(job: Job | undefined): number | undefined {
  if (!job?.processedOn) return undefined;
  return Math.max(0, (job.finishedOn ?? Date.now()) - job.processedOn);
}

function logJobCompleted(label: string, job: Job, result: unknown): void {
  log.info(
    {
      jobId: job.id,
      jobName: job.name,
      attemptsMade: job.attemptsMade,
      durationMs: jobDurationMs(job),
      result,
    },
    `${label} done`,
  );
}

function logJobFailure(label: string, job: Job | undefined, err: Error): void {
  log.error(
    {
      jobId: job?.id,
      jobName: job?.name,
      attemptsMade: job?.attemptsMade,
      maxAttempts: job?.opts.attempts,
      durationMs: jobDurationMs(job),
      err,
    },
    `${label} failed`,
  );
}

async function main(): Promise<void> {
  // Fail closed before any repeatable job can touch tenant data. A wrong
  // role silently disables PostgreSQL RLS and voids tenant isolation.
  if (env.NODE_ENV === "production" || env.APP_DATABASE_URL) {
    await assertAppRole(appConnection.client);
  }
  plannerWorker = new Worker(
    "reminders-planner",
    async (job) => {
      try {
        if (job.name === "replan-invoice") {
          return await processReplanInvoice(deps, job.data as { tenantId: string; invoiceId: string });
        }
        if (job.name === "replan-tenant") {
          return await processReplanTenant(deps, job.data as { tenantId: string });
        }
        return await processPlannerTick(deps);
      } catch (err) {
        if (err instanceof InvalidJobPayloadError) {
          throw new UnrecoverableError(err.message);
        }
        throw err;
      }
    },
    { connection: workerConnection, concurrency: 2, ...WORKER_LOCK_OPTIONS },
  );
  dispatcherWorker = new Worker(
    "reminders-dispatcher",
    async (job) => {
      const tenantId = (job.data as { tenantId?: string } | undefined)?.tenantId;
      return processDispatchTick(tenantId ? { ...deps, tenantId } : deps);
    },
    { connection: workerConnection, concurrency: 1, ...WORKER_LOCK_OPTIONS },
  );
  maintenanceWorker = new Worker(
    "maintenance",
    async () => processMaintenanceTick(deps),
    { connection: workerConnection, concurrency: 1, ...WORKER_LOCK_OPTIONS },
  );
  plannerWorker.on("completed", (job, result) => logJobCompleted("planner tick", job, result));
  dispatcherWorker.on("completed", (job, result) => logJobCompleted("dispatch tick", job, result));
  maintenanceWorker.on("completed", (job, result) => logJobCompleted("maintenance tick", job, result));
  plannerWorker.on("failed", (job, err) => logJobFailure("planner tick", job, err));
  dispatcherWorker.on("failed", (job, err) => logJobFailure("dispatch tick", job, err));
  maintenanceWorker.on("failed", (job, err) => logJobFailure("maintenance tick", job, err));
  plannerWorker.on("stalled", (jobId) => log.warn({ jobId }, "planner job stalled"));
  dispatcherWorker.on("stalled", (jobId) => log.warn({ jobId }, "dispatch job stalled"));
  maintenanceWorker.on("stalled", (jobId) => log.warn({ jobId }, "maintenance job stalled"));
  plannerWorker.on("error", (err) => log.error({ err }, "planner worker error"));
  dispatcherWorker.on("error", (err) => log.error({ err }, "dispatcher worker error"));
  maintenanceWorker.on("error", (err) => log.error({ err }, "maintenance worker error"));
  // Repeatable jobs (BUILD_PLAN §3): planner nightly, dispatcher every minute.
  await plannerQueue.add("nightly", {}, { repeat: { pattern: "0 2 * * *", tz: env.DEFAULT_TIMEZONE } });
  await dispatcherQueue.add("every-minute", {}, { repeat: { every: 60_000 } });
  // M3/M6: nightly payload-retention purge (90-day tombstone) + failed webhook replay.
  await maintenanceQueue.add("nightly", {}, { repeat: { pattern: "0 3 * * *", tz: env.DEFAULT_TIMEZONE } });
  // One immediate tick so a fresh boot proves the plumbing end to end.
  // Minute-bucket jobId dedupes simultaneous multi-replica restarts.
  const bootBucket = Math.floor(Date.now() / 60_000);
  await plannerQueue.add("boot-tick", {}, { jobId: `boot-tick-${bootBucket}` });
  await dispatcherQueue.add("boot-tick", {}, { jobId: `boot-tick-${bootBucket}` });
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
  let timedOut = false;
  const closeTimeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => {
      timedOut = true;
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);
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
        appConnection.client.end({ timeout: 5 }),
        ownerConnection.client.end({ timeout: 5 }),
      ]);
    })(),
    closeTimeout,
  ]);
  if (timer) clearTimeout(timer);
  if (timedOut) {
    log.warn({ signal, timeoutMs: SHUTDOWN_TIMEOUT_MS }, "graceful shutdown timed out; forcing exit");
  }
  process.exit(exitCode);
}
process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => {
  log.fatal({ err: reason }, "unhandled promise rejection");
  void shutdown("UNHANDLED_REJECTION", 1);
});
process.on("uncaughtException", (err) => {
  log.fatal({ err }, "uncaught exception");
  void shutdown("UNCAUGHT_EXCEPTION", 1);
});

main().catch((err) => {
  log.error({ err }, "worker failed to start");
  void shutdown("STARTUP_ERROR", 1);
});
