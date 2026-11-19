import {
  createAiProvider, FakeLlmProvider, FakeStorageProvider,
  hasUsableLlmConfig, resolveAiConfig, S3CompatibleStorageProvider,
  type OcrLlmProvider, type StorageProvider,
} from "@tahseel/providers";
import {
  createEngineDeps, planForInvoice, planForTenant, type EngineDeps,
} from "@tahseel/reminders";
import { appDb, ownerDb } from "./db";
import { env } from "./env";
import { budgetedLlmProvider } from "./ai-budget";

/**
 * Engine wiring for the web process (ADR-016): uses the shared
 * createEngineDeps factory from @tahseel/reminders. Cached in non-test
 * environments; in test mode, rebuilds per call so env/fake flag flips
 * take effect immediately.
 */
let engineSingleton: EngineDeps | null = null;
export function engineDeps(): EngineDeps {
  const e = env();
  if (engineSingleton && e.NODE_ENV !== "test") return engineSingleton;
  const built = createEngineDeps({
    app: appDb(),
    owner: ownerDb(),
    dryRunMessaging: e.DRY_RUN_MESSAGING,
    whatsappApiVersion: e.WHATSAPP_API_VERSION,
    whatsappPhoneNumberId: e.WHATSAPP_PHONE_NUMBER_ID,
    whatsappAccessToken: e.WHATSAPP_ACCESS_TOKEN,
    appUrl: e.APP_URL,
    sessionSecret: e.SESSION_SECRET,
  });
  if (e.NODE_ENV !== "test") engineSingleton = built;
  return built;
}

// ------------------------------------------------------------ BullMQ / Redis
interface BullQueueLike {
  add(name: string, data: unknown, opts?: Record<string, unknown>): Promise<unknown>;
  close(): Promise<void>;
}
interface RedisLike {
  status?: string;
  connect(): Promise<void>;
  on(event: string, listener: (...args: unknown[]) => void): void;
  disconnect(): void;
}
interface QueueState {
  redis: RedisLike;
  planner: BullQueueLike;
}

let queueState: QueueState | null = null;
let queueInitPromise: Promise<QueueState | null> | null = null;
let redisBackoffUntil = 0;

async function getQueues(): Promise<QueueState | null> {
  const e = env();
  if (e.NODE_ENV === "test" || !e.REDIS_URL || Date.now() < redisBackoffUntil) {
    return null;
  }
  if (queueState) return queueState;
  if (queueInitPromise) return queueInitPromise;

  queueInitPromise = (async () => {
    let redis: (RedisLike & { disconnect?: () => void }) | null = null;
    try {
      const [{ Queue }, { Redis }] = await Promise.all([
        // @ts-expect-error - optional dynamic import
        import(/* webpackIgnore: true */ "bullmq") as Promise<{ Queue: new (name: string, opts: { connection: unknown }) => BullQueueLike }>,
        // @ts-expect-error - optional dynamic import
        import(/* webpackIgnore: true */ "ioredis") as Promise<{ Redis: new (url: string, opts: Record<string, unknown>) => RedisLike & { disconnect?: () => void } }>,
      ]);
      redis = new Redis(e.REDIS_URL, {
        maxRetriesPerRequest: 1,
        connectTimeout: 1000,
        enableOfflineQueue: false,
        lazyConnect: true,
        retryStrategy: () => null,
      });
      redis.on("error", () => { /* handled via connect/enqueue catch */ });
      await redis.connect();
      const planner = new Queue("reminders-planner", { connection: redis });
      queueState = { redis, planner };
      return queueState;
    } catch (err) {
      console.warn("[engine] Redis connect failed; falling back to in-process execution", err);
      try { redis?.disconnect?.(); } catch { /* ignore */ }
      redisBackoffUntil = Date.now() + 30_000;
      return null;
    } finally {
      queueInitPromise = null;
    }
  })();

  return queueInitPromise;
}

async function enqueueOrFallback(
  jobName: string,
  data: unknown,
  fallback: () => Promise<unknown>,
): Promise<void> {
  const queues = await getQueues();
  if (queues) {
    try {
      await queues.planner.add(jobName, data, { removeOnComplete: 50, removeOnFail: 50 });
      return;
    } catch (err) {
      console.warn("[engine] BullMQ enqueue failed; closing stale Redis state and falling back", err);
      const stale = queueState;
      queueState = null;
      redisBackoffUntil = Date.now() + 30_000;
      if (stale) {
        await Promise.allSettled([
          stale.planner.close(),
        ]);
        try { (stale.redis as unknown as { disconnect?: () => void }).disconnect?.(); } catch { /* ignore */ }
      }
    }
  }
  await fallback();
}

const activeReplans = new Set<Promise<unknown>>();

/**
 * Best-effort re-planning hooks (BUILD_PLAN §7-F4: the planner re-runs on
 * invoice/payment change). Enqueues to BullMQ when Redis is reachable, and
 * falls back to in-process execution otherwise. A planning failure must never
 * fail the ledger write that triggered it.
 */
export function replanLater(tenantId: string, invoiceId: string): void {
  const p = enqueueOrFallback(
    "replan-invoice",
    { tenantId, invoiceId },
    () => planForInvoice(engineDeps(), tenantId, invoiceId, new Date()),
  ).catch((err) => {
    console.error("[replan] invoice planning failed", { tenantId, invoiceId, err });
  }).finally(() => {
    activeReplans.delete(p);
  });
  activeReplans.add(p);
}

export function replanTenantLater(tenantId: string): void {
  const p = enqueueOrFallback(
    "replan-tenant",
    { tenantId },
    () => planForTenant(engineDeps(), tenantId, new Date()),
  ).catch((err) => {
    console.error("[replan] tenant planning failed", { tenantId, err });
  }).finally(() => {
    activeReplans.delete(p);
  });
  activeReplans.add(p);
}

export async function drainReplans(): Promise<void> {
  await Promise.all(Array.from(activeReplans));
}

/**
 * AI provider seam (F6/F7/F8, ADR-022): real Gemini/Anthropic when configured;
 * otherwise a clearly marked deterministic FAKE for dev/test. Uploaded bytes use
 * private S3-compatible storage (MinIO locally, S3-compatible in production).
 */
export interface AiDeps { llm: OcrLlmProvider; storage: StorageProvider; usingFakeLlm: boolean }
let aiSingleton: AiDeps | null = null;
export function aiDeps(): AiDeps {
  if (aiSingleton) return aiSingleton;
  const e = env();
  // Never make real provider calls from unit/integration tests unless an
  // explicitly enabled sandbox suite opts in. Test storage remains isolated.
  // ADR-033: the e2e server runs production-mode with E2E_FAKE_PROVIDERS —
  // same fake LLM + fake storage, because the sandbox has no MinIO and no
  // AI key (the e2e specs depend on the deterministic fake, e.g. m4's
  // synthetic ledger-photo extraction).
  if ((e.NODE_ENV === "test" || e.E2E_FAKE_PROVIDERS) && !e.RUN_SANDBOX_TESTS) {
    aiSingleton = { llm: new FakeLlmProvider(), storage: new FakeStorageProvider(), usingFakeLlm: true };
    return aiSingleton;
  }
  const storage = new S3CompatibleStorageProvider({
    endpoint: e.S3_ENDPOINT, region: e.S3_REGION, bucket: e.S3_BUCKET,
    accessKey: e.S3_ACCESS_KEY, secretKey: e.S3_SECRET_KEY, forcePathStyle: e.S3_FORCE_PATH_STYLE,
    allowInsecureLocal: e.ALLOW_LOCAL_S3,
  });

  // Single unified AI provider configured once in code/env for all tenants.
  if (hasUsableLlmConfig(e)) {
    const llm = createAiProvider(resolveAiConfig(e));
    aiSingleton = { llm, storage, usingFakeLlm: false };
  } else {
    aiSingleton = { llm: new FakeLlmProvider(), storage, usingFakeLlm: true };
  }
  if (!aiSingleton.usingFakeLlm) {
    aiSingleton = { ...aiSingleton, llm: budgetedLlmProvider(aiSingleton.llm) };
  }
  return aiSingleton;
}

/** Test seam: replace the AI singletons (integration suites inject their own fakes). */
export function setAiDepsForTests(deps: AiDeps | null): void {
  aiSingleton = deps;
}
