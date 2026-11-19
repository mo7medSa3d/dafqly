"use client";

import { LazyMotion, MotionConfig, domAnimation, useReducedMotion } from "motion/react";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Section reveal: pure-CSS fade + rise (`.reveal` in globals.css). CSS on
 * purpose: content must never sit in a JS-hydration-dependent hidden state
 * (SSR rendering opacity:0 until hydration showed blank sections before).
 * Collapses animation cleanly when the user prefers reduced motion.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const prefersReduced = useReducedMotion();
  const cls = prefersReduced ? className : className ? `reveal ${className}` : "reveal";
  return <div className={cls}>{children}</div>;
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
  const prefersReduced = useReducedMotion();
  return (
    <div key={prefersReduced ? undefined : pathname} className={prefersReduced ? "flex flex-col gap-6" : "ai-rise flex flex-col gap-6"}>
      {children}
    </div>
  );
}
