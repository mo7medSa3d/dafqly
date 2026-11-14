"use client";

import { LazyMotion, MotionConfig, domAnimation } from "motion/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Section reveal: pure-CSS fade + rise (`.reveal` in globals.css). CSS on
 * purpose: content must never sit in a JS-hydration-dependent hidden state
 * (SSR rendering opacity:0 until hydration showed blank sections before).
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `reveal ${className}` : "reveal"}>{children}</div>;
}

/** Library provider: small bundle (LazyMotion) + honours the OS reduced-motion setting. */
export function MotionProvider({ children }: { children: ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}

/** Route change: CSS entrance re-triggered by the path key (SSR-safe: content is visible without JS). */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return <div key={pathname} className="ai-rise flex flex-col gap-6">{children}</div>;
}
