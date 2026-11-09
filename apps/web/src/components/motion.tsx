import type { ReactNode } from "react";

/**
 * Section reveal: CSS keyframe fade + 8px rise (`.reveal` in globals.css),
 * 350ms, transform/opacity only. Pure CSS on purpose: content is never in a
 * JS-hydration-dependent hidden state (the previous motion/react version
 * SSR-rendered opacity 0 until hydration — visible as blank sections in
 * early screenshots and a flash risk for reduced-motion users). Under
 * prefers-reduced-motion the global token rule collapses the duration, so
 * content is simply present.
 */
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `reveal ${className}` : "reveal"}>{children}</div>;
}
