import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { AppError } from "@tahseel/core";
import { aiGlobalBudget, aiGlobalUsage, type Db } from "@tahseel/db";
import { primaryModelFor, resolveLlmProviderConfigs, type LlmProviderConfig, type OcrLlmProvider } from "@tahseel/providers";
import { ownerDb } from "./db";
import { env } from "./env";

const tenantContext = new AsyncLocalStorage<string>();
export function withAiTenantContext<T>(tenantId: string, run: () => T): T {
  return tenantContext.run(tenantId, run);
}
function activeAiTenantId(): string | undefined {
  return tenantContext.getStore();
}

function monthStart(date = new Date()): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export interface AiRateOverride { input: number; output: number }

function safeConfigs(): LlmProviderConfig[] {
  try { return resolveLlmProviderConfigs(env()); } catch { return []; }
}

/**
 * Operator-supplied rates (USD per 1M tokens) for providers whose models are
 * not in the built-in table.
 * Explicit rates win over the built-in table, so a re-priced/proxied model is
 * metered at what the operator actually pays.
 */


export function estimateAiCostUsdMicros(model: string, inputTokens: number, outputTokens: number, override?: AiRateOverride): bigint {
  const normalized = model.toLowerCase();
  // Rates are USD per million tokens, verified 2026-11-13 against the
  // providers' official pricing pages (Google Gemini Developer API pricing
  // and Anthropic Claude pricing, via ai.google.dev / platform.claude.com;
  // see ADR-032). Every default model id in core env.ts has an explicit
  // row here — see the ai-budget test, which derives the ids from parseEnv
  // defaults. Unrecognised model ids fall back to a deliberately
  // conservative $10/$40 so an unknown model can never understate cost.
  //
  // Scheduled changes to re-check before they take effect (do NOT bake
  // future rates into today's estimates): Gemini 3.6/3.8 Flash double to
  // $1.50/$7.50 on 2027-01-01. Claude Haiku 5.5 bills $0.50/$2.50 (not
  // $0.10/$0.50) on any request whose prompt exceeds 100,000 tokens — this
  // estimator uses the <=100K rate, so long-prompt Haiku calls are
  // understated; the per-request reserve still bounds admission.
  let inputRate = 10;
  let outputRate = 40;
  if (normalized.includes("gemini-2.5-flash") || normalized.includes("gemini-3.5-flash-lite")) {
    inputRate = 0.30; outputRate = 2.50;
  } else if (normalized.includes("gemini-3.8-flash") || normalized.includes("gemini-3.6-flash")) {
    inputRate = 0.75; outputRate = 3.75;
  } else if (normalized.includes("gemini-3.5-flash")) {
    inputRate = 1.50; outputRate = 9;
  } else if (normalized.includes("gpt-4o-mini")) {
    inputRate = 0.15; outputRate = 0.60;
  } else if (normalized.includes("claude-sonnet-4-5")) {
    inputRate = 3; outputRate = 15;
  } else if (normalized.includes("haiku-5-5")) {
    inputRate = 0.10; outputRate = 0.50;
  } else if (normalized.includes("sonnet-5-5")) {
    inputRate = 2; outputRate = 10;
  } else if (normalized.includes("deepseek")) {
    inputRate = 0.27; outputRate = 1.10;
  } else if (normalized.includes("llama-3.3-70b")) {
    inputRate = 0.59; outputRate = 0.79;
  }
  if (override) { inputRate = override.input; outputRate = override.output; }
  const safeIn = Number.isFinite(inputTokens) ? Math.max(0, inputTokens) : 0;
  const safeOut = Number.isFinite(outputTokens) ? Math.max(0, outputTokens) : 0;
  // USD per million tokens * tokens = micro-USD (one USD = one million micros).
  return BigInt(Math.ceil(safeIn * inputRate + safeOut * outputRate));
}

export async function reserveGlobalAiBudget(
  owner: Db, tenantId: string, requestKey: string, model: string,
): Promise<{ reservedUsdMicros: bigint; budgetPeriod: string }> {
  const config = env();
  const cap = BigInt(Math.round(config.AI_GLOBAL_MONTHLY_USD_CAP * 1_000_000));
  const reserveUsd = Math.min(config.AI_GLOBAL_REQUEST_RESERVE_USD, config.AI_GLOBAL_MONTHLY_USD_CAP);
  const reserve = BigInt(Math.round(reserveUsd * 1_000_000));
  const period = monthStart();
  return owner.transaction(async (tx) => {
    await tx.insert(aiGlobalBudget).values({ singletonId: 1, periodStart: period, capUsdMicros: cap })
      .onConflictDoNothing();
    const [budget] = await tx.select().from(aiGlobalBudget).where(eq(aiGlobalBudget.singletonId, 1)).for("update");
    if (!budget) throw new AppError("AI_BUDGET_UNAVAILABLE", "Global AI budget is not initialized", 503);
    // Configuration is deployment-controlled and may be tightened or raised
    // during a month. Apply the current cap on every serialized reservation,
    // not only on month rollover.
    const activeBudget = budget.periodStart === period ? {
      ...budget, capUsdMicros: cap,
    } : {
      ...budget, periodStart: period, capUsdMicros: cap, spentUsdMicros: 0n, reservedUsdMicros: 0n,
    };
    const total = activeBudget.spentUsdMicros + activeBudget.reservedUsdMicros + reserve;
    if (total > cap) throw new AppError("AI_GLOBAL_BUDGET_EXCEEDED", "The platform-wide monthly AI spending cap has been reached", 429, {
      capUsd: config.AI_GLOBAL_MONTHLY_USD_CAP,
    });
    await tx.update(aiGlobalBudget).set({
      periodStart: period, capUsdMicros: cap,
      spentUsdMicros: activeBudget.spentUsdMicros,
      reservedUsdMicros: activeBudget.reservedUsdMicros + reserve,
      updatedAt: new Date(),
    }).where(eq(aiGlobalBudget.singletonId, 1));
    await tx.insert(aiGlobalUsage).values({
      requestKey, tenantId, model, status: "reserved", reservedUsdMicros: reserve,
    });
    return { reservedUsdMicros: reserve, budgetPeriod: period };
  });
}

export async function settleGlobalAiBudget(
  owner: Db, requestKey: string, inputTokens: number, outputTokens: number, model?: string, budgetPeriod?: string,
): Promise<void> {
  await owner.transaction(async (tx) => {
    const [usage] = await tx.select().from(aiGlobalUsage).where(eq(aiGlobalUsage.requestKey, requestKey)).for("update");
    if (!usage || usage.status !== "reserved") return;
    const safeInputTokens = Number.isFinite(inputTokens) ? Math.max(0, Math.trunc(inputTokens)) : 0;
    const safeOutputTokens = Number.isFinite(outputTokens) ? Math.max(0, Math.trunc(outputTokens)) : 0;
    const meteredModel = model ?? usage.model;
    const actual = estimateAiCostUsdMicros(meteredModel, safeInputTokens, safeOutputTokens);
    const targetPeriod = budgetPeriod ?? monthStart(usage.createdAt);
    const [budget] = await tx.select().from(aiGlobalBudget).where(eq(aiGlobalBudget.singletonId, 1)).for("update");
    if (budget?.periodStart === targetPeriod) {
      const nextReserved = budget.reservedUsdMicros > usage.reservedUsdMicros
        ? budget.reservedUsdMicros - usage.reservedUsdMicros : 0n;
      // Record the full estimated cost computed from provider-reported token
      // usage, even when it exceeds the admission cap. The cap is checked
      // before the call; truncating here would hide overruns and admit more calls.
      await tx.update(aiGlobalBudget).set({
        reservedUsdMicros: nextReserved,
        spentUsdMicros: budget.spentUsdMicros + actual,
        updatedAt: new Date(),
      }).where(eq(aiGlobalBudget.singletonId, 1));
    }
    await tx.update(aiGlobalUsage).set({
      status: "settled", actualUsdMicros: actual, inputTokens: safeInputTokens, outputTokens: safeOutputTokens,
      model: model ?? usage.model, updatedAt: new Date(),
    }).where(eq(aiGlobalUsage.id, usage.id));
  });
}

export async function releaseGlobalAiBudget(owner: Db, requestKey: string, budgetPeriod?: string): Promise<void> {
  await owner.transaction(async (tx) => {
    const [usage] = await tx.select().from(aiGlobalUsage).where(eq(aiGlobalUsage.requestKey, requestKey)).for("update");
    if (!usage || usage.status !== "reserved") return;
    const targetPeriod = budgetPeriod ?? monthStart(usage.createdAt);
    const [budget] = await tx.select().from(aiGlobalBudget).where(eq(aiGlobalBudget.singletonId, 1)).for("update");
    if (budget?.periodStart === targetPeriod) {
      await tx.update(aiGlobalBudget).set({
        reservedUsdMicros: budget.reservedUsdMicros > usage.reservedUsdMicros
          ? budget.reservedUsdMicros - usage.reservedUsdMicros : 0n,
        updatedAt: new Date(),
      }).where(eq(aiGlobalBudget.singletonId, 1));
    }
    await tx.update(aiGlobalUsage).set({ status: "released", updatedAt: new Date() }).where(eq(aiGlobalUsage.id, usage.id));
  });
}

/**
 * A normal 4xx response (except timeout/too-early) is an explicit rejection,
 * so it is safe to release the reservation. A transport failure, timeout,
 * 5xx, or malformed successful response is ambiguous: the provider may
 * already have processed/billed the request, so keep the reservation for
 * reconciliation rather than treating an unknown outcome as free.
 */
export function providerDefinitelyRejected(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const match = /\bHTTP\s+(\d{3})\b/i.exec(message);
  if (!match) return false;
  const status = Number(match[1]);
  return status >= 400 && status < 500 && status !== 408 && status !== 425;
}

function usageFromResult(result: unknown): { inputTokens: number; outputTokens: number; model?: string } {
  if (!result || typeof result !== "object") return { inputTokens: 0, outputTokens: 0 };
  const value = result as { inputTokens?: unknown; outputTokens?: unknown; model?: unknown };
  return {
    inputTokens: typeof value.inputTokens === "number" && Number.isFinite(value.inputTokens) ? Math.max(0, Math.trunc(value.inputTokens)) : 0,
    outputTokens: typeof value.outputTokens === "number" && Number.isFinite(value.outputTokens) ? Math.max(0, Math.trunc(value.outputTokens)) : 0,
    model: typeof value.model === "string" ? value.model : undefined,
  };
}

/** Proxies every real provider operation through a cross-tenant, atomic monthly cap. */
export function budgetedLlmProvider<T extends OcrLlmProvider>(provider: T): T {
  return new Proxy(provider, {
    get(target, property, receiver) {
      const method = Reflect.get(target, property, receiver) as unknown;
      if (typeof method !== "function" || property === "constructor") return method;
      return async (...args: unknown[]) => {
        const tenantId = activeAiTenantId();
        if (env().NODE_ENV === "test" && !tenantId) return method.apply(target, args);
        if (!tenantId) {
          throw new AppError("AI_CONTEXT_MISSING", "AI calls must execute inside withAiTenantContext", 500);
        }
        const key = randomUUID();
        const methodName = String(property);
        // Model hint for the pre-call reservation row comes from the PRIMARY
        // configured provider (any vendor); the real model id reported by the
        // adapter replaces it when the call settles.
        const operation = methodName === "runAgent" ? "agent"
          : ["extractLedgerPage", "extractReceipt", "extractCheque"].includes(methodName) ? "vision" : "fast";
        const modelHint = primaryModelFor(safeConfigs(), operation) ?? "unknown-model";
        const { budgetPeriod } = await reserveGlobalAiBudget(ownerDb(), tenantId, key, modelHint);
        let result: unknown;
        try {
          result = await method.apply(target, args);
        } catch (error) {
          if (providerDefinitelyRejected(error)) {
            await releaseGlobalAiBudget(ownerDb(), key, budgetPeriod).catch((releaseError) => {
              console.error("[ai-budget] failed to release a provider-rejected reservation", {
                requestKey: key,
                errorClass: releaseError instanceof Error ? releaseError.name : "UnknownError",
              });
            });
          } else {
            // A timeout/transport/5xx error does not prove the provider did
            // not process the request. Retain the reserve for reconciliation.
            console.error("[ai-budget] provider call outcome is unknown; reservation retained", {
              requestKey: key,
              errorClass: error instanceof Error ? error.name : "UnknownError",
            });
          }
          throw error;
        }
        const usage = usageFromResult(result);
        try {
          await settleGlobalAiBudget(ownerDb(), key, usage.inputTokens, usage.outputTokens, usage.model, budgetPeriod);
        } catch (error) {
          // Provider usage has already happened. Releasing the reservation
          // here would undercount real spend and allow more calls through the
          // global cap. Keep it reserved for operator reconciliation.
          console.error("[ai-budget] provider call completed but usage settlement failed; reservation retained", {
            requestKey: key,
            errorClass: error instanceof Error ? error.name : "UnknownError",
          });
          throw new AppError(
            "AI_BUDGET_SETTLEMENT_FAILED",
            "AI completed but its usage could not be recorded. The budget reservation is retained for reconciliation.",
            503,
          );
        }
        return result;
      };
    },
  }) as T;
}
