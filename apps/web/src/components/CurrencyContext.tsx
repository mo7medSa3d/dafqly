"use client";

import { createContext, useContext, useMemo } from "react";
import {
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
  children,
}: {
  currency?: string;
  locale?: string;
  children: React.ReactNode;
}) {
  const normCurrency = (currency || "EGP").toUpperCase() as SupportedCurrency;
  const symbol = getCurrencySymbol(normCurrency, locale);

  const value = useMemo<CurrencyContextValue>(() => ({
    currency: normCurrency,
    symbol,
    format: (minor, opts) => formatMoney(minor, normCurrency, { locale, ...opts }),
    formatAmountOnly: (minor, opts) => {
      const b = typeof minor === "bigint" ? minor : BigInt(String(minor || "0"));
      return formatEgp(b, opts);
    },
  }), [normCurrency, symbol, locale]);

  return (
    <CurrencyContext.Provider value={value}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency(): CurrencyContextValue {
  return useContext(CurrencyContext);
}
