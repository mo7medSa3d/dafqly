"use client";

import { createContext, useContext, useMemo } from "react";
import {
  formatCurrencyMinor,
  formatEgp,
  formatMoney,
  getCurrencySymbol,
  type SupportedCurrency,
} from "@tahseel/core";

export interface CurrencyContextValue {
  currency: string;
  symbol: string;
  format: (minor: bigint | number | string, opts?: { digits?: "latin" | "eastern" }) => string;
  formatAmountOnly: (minor: bigint | number | string, opts?: { digits?: "latin" | "eastern" }) => string;
}

const defaultContext: CurrencyContextValue = {
  currency: "EGP",
  symbol: "ج.م",
  format: (minor, opts) => formatMoney(minor, "EGP", { locale: "ar", ...opts }),
  formatAmountOnly: (minor, opts) => {
    const b = typeof minor === "bigint" ? minor : BigInt(String(minor || "0"));
    return formatEgp(b, opts);
  },
};

export const CurrencyContext = createContext<CurrencyContextValue>(defaultContext);

export function CurrencyProvider({
  currency = "EGP",
  locale = "ar",
  digits = "latin",
  children,
}: {
  currency?: string;
  locale?: string;
  /** "eastern" renders Eastern Arabic digits (١٢٣) when the tenant opted in. */
  digits?: "latin" | "eastern";
  children: React.ReactNode;
}) {
  const normCurrency = (currency || "EGP").toUpperCase() as SupportedCurrency;
  const symbol = getCurrencySymbol(normCurrency, locale);

  const value = useMemo<CurrencyContextValue>(() => ({
    currency: normCurrency,
    symbol,
    format: (minor, opts) => formatMoney(minor, normCurrency, { locale, digits: opts?.digits ?? digits }),
    // Amount without the symbol, still in the tenant currency and its
    // minor-unit exponent (KWD 3 decimals, JPY 0) — not EGP.
    formatAmountOnly: (minor, opts) => {
      const b = typeof minor === "bigint" ? minor : BigInt(String(minor || "0"));
      return formatCurrencyMinor(b, normCurrency, { digits: opts?.digits ?? digits });
    },
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
