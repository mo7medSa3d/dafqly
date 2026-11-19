"use client";

import { createContext, useContext, useMemo } from "react";
import {
  formatCurrencyMinor,
  formatMoney,
  getCurrencySymbol,
  type SupportedCurrency,
} from "@tahseel/core";
import { toSafeBigInt } from "@/lib/format";

const DEFAULT_CURRENCY: SupportedCurrency = "USD";

export interface CurrencyContextValue {
  currency: string;
  symbol: string;
  format: (minor: bigint | number | string, opts?: { digits?: "latin" | "eastern"; currency?: string }) => string;
  formatAmountOnly: (minor: bigint | number | string, opts?: { digits?: "latin" | "eastern"; currency?: string }) => string;
}

const defaultContext: CurrencyContextValue = {
  currency: DEFAULT_CURRENCY,
  symbol: getCurrencySymbol(DEFAULT_CURRENCY, "en"),
  format: (minor, opts) =>
    formatMoney(minor, (opts?.currency ?? DEFAULT_CURRENCY) as SupportedCurrency, { locale: "en", ...opts }),
  formatAmountOnly: (minor, opts) =>
    formatCurrencyMinor(toSafeBigInt(minor), (opts?.currency ?? DEFAULT_CURRENCY) as SupportedCurrency, opts),
};

const CurrencyContext = createContext<CurrencyContextValue>(defaultContext);

export function CurrencyProvider({
  currency = DEFAULT_CURRENCY,
  locale = "en",
  digits = "latin",
  children,
}: {
  currency?: string;
  locale?: string;
  /** "eastern" renders Eastern Arabic digits (١٢٣) when the tenant opted in. */
  digits?: "latin" | "eastern";
  children: React.ReactNode;
}) {
  const normCurrency = (currency || DEFAULT_CURRENCY).toUpperCase() as SupportedCurrency;
  const symbol = getCurrencySymbol(normCurrency, locale);

  const value = useMemo<CurrencyContextValue>(() => ({
    currency: normCurrency,
    symbol,
    format: (minor, opts) => formatMoney(minor, (opts?.currency ?? normCurrency) as SupportedCurrency, { locale, digits: opts?.digits ?? digits }),
    // Amount without the symbol, still in the tenant currency and its
    // minor-unit exponent (KWD 3 decimals, JPY 0) — not EGP.
    formatAmountOnly: (minor, opts) =>
      formatCurrencyMinor(toSafeBigInt(minor), (opts?.currency ?? normCurrency) as SupportedCurrency, { digits: opts?.digits ?? digits }),
  }), [normCurrency, symbol, locale, digits]);

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}
