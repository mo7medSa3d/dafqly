import {
  createLlmProvider, FailoverLlmProvider, FakeLlmProvider, FakeStorageProvider,
  hasUsableLlmConfig, resolveLlmProviderConfigs, S3CompatibleStorageProvider,
  type LlmProviderConfig, type OcrLlmProvider, type StorageProvider,
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
        import(/* webpackIgnore: true */ "bullmq") as Promise<{ Queue: new (name: string, opts: { connection: unknown }) => BullQueueLike }>,
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

/**
 * Best-effort re-planning hooks (BUILD_PLAN §7-F4: the planner re-runs on
 * invoice/payment change). Enqueues to BullMQ when Redis is reachable, and
 * falls back to in-process execution otherwise. A planning failure must never
 * fail the ledger write that triggered it.
 */
export function replanLater(tenantId: string, invoiceId: string): void {
  void enqueueOrFallback(
    "replan-invoice",
    { tenantId, invoiceId },
    () => planForInvoice(engineDeps(), tenantId, invoiceId, new Date()),
  ).catch((err) => {
    console.error("[replan] invoice planning failed", { tenantId, invoiceId, err });
  });
}

export function replanTenantLater(tenantId: string): void {
  void enqueueOrFallback(
    "replan-tenant",
    { tenantId },
    () => planForTenant(engineDeps(), tenantId, new Date()),
  ).catch((err) => {
    console.error("[replan] tenant planning failed", { tenantId, err });
  });
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

  // Provider-agnostic wiring: the env describes ANY provider(s) as data and the
  // registry builds them (see packages/providers/src/config.ts). Several
  // providers = automatic failover in the listed order.
  const configs = llmProviderConfigs();
  if (hasUsableLlmConfig(e)) {
    const members = configs.map((config) => ({ name: config.name ?? config.kind, provider: createLlmProvider(config) }));
    const llm: OcrLlmProvider = members.length === 1 ? members[0]!.provider : new FailoverLlmProvider(members, {
      onFailover: ({ from, to, error }) => console.warn("[ai] provider failover", { from, to, error }),
    });
    aiSingleton = { llm, storage, usingFakeLlm: false };
  } else {
    aiSingleton = { llm: new FakeLlmProvider(), storage, usingFakeLlm: true };
  }
  if (!aiSingleton.usingFakeLlm) {
    aiSingleton = { ...aiSingleton, llm: budgetedLlmProvider(aiSingleton.llm) };
  }
  return aiSingleton;
}

/** The resolved provider list (primary first). Throws a clear error on invalid AI_* configuration. */
function llmProviderConfigs(): LlmProviderConfig[] {
  return resolveLlmProviderConfigs(env());
}

/** Test seam: replace the AI singletons (integration suites inject their own fakes). */
export function setAiDepsForTests(deps: AiDeps | null): void {
  aiSingleton = deps;
}
