"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * F-10: the dashboard is a server component (force-dynamic) — its numbers
 * are a snapshot from load time. Re-run the server components when the user
 * comes back to the tab, so a payment or invoice recorded in another tab
 * (or by the Copilot drawer) shows up without a manual reload. Throttled
 * to at most once per 30s so rapid focus/visibility flapping cannot spam
 * the server with re-renders.
 */
export function DashboardRefresher() {
  const router = useRouter();
  const lastRefresh = useRef(0);
  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (now - lastRefresh.current < 30_000) return;
      lastRefresh.current = now;
      router.refresh();
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [router]);
  return null;
}
