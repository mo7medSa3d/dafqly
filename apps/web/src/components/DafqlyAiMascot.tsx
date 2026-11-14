"use client";

import * as React from "react";

export type MascotMood = "idle" | "thinking" | "writing" | "happy";

/**
 * Interactive 3D-shaded Cartoon AI Assistant SVG Mascot for DAFQLY.
 * Adapts automatically to Light & Dark modes via CSS variables (--primary,
 * --primary-foreground, --chart-1, --chart-2, --card, --border).
 */
export function DafqlyAiMascot({
  size = 44,
  mood = "idle",
  followPointer = false,
  className = "",
}: {
  size?: number;
  mood?: MascotMood;
  followPointer?: boolean;
  className?: string;
}) {
  const uid = React.useId().replace(/:/g, "");
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const [look, setLook] = React.useState({ x: 0, y: 0 });
  const [blink, setBlink] = React.useState(false);

  // Natural periodic blink
  React.useEffect(() => {
    let t1: ReturnType<typeof setTimeout>;
    let t2: ReturnType<typeof setTimeout>;
    const schedule = () => {
      t1 = setTimeout(() => {
        setBlink(true);
        t2 = setTimeout(() => {
          setBlink(false);
          schedule();
        }, 140);
      }, 3200 + Math.random() * 2400);
    };
    schedule();
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  // Optional pointer-tracking pupils
  React.useEffect(() => {
    if (!followPointer) {
      setLook({ x: 0, y: 0 });
      return;
    }
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const el = svgRef.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        const cx = r.left + r.width / 2;
        const cy = r.top + r.height / 2;
        const dx = e.clientX - cx;
        const dy = e.clientY - cy;
        const dist = Math.hypot(dx, dy) || 1;
        const maxOffset = 2.6;
        const scale = Math.min(1, dist / 220);
        setLook({
          x: (dx / dist) * maxOffset * scale,
          y: (dy / dist) * maxOffset * scale,
        });
      });
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      window.removeEventListener("pointermove", onMove);
      cancelAnimationFrame(raf);
    };
  }, [followPointer]);

  const accent =
    mood === "thinking"
      ? "var(--chart-1)"
      : mood === "writing" || mood === "happy"
        ? "var(--chart-2)"
        : "var(--chart-2)";

  const eyeOffsetX = mood === "thinking" ? 1.8 : look.x;
  const eyeOffsetY = mood === "thinking" ? -2.0 : look.y;

  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      aria-hidden="true"
      className={`shrink-0 select-none ${className}`}
    >
      <defs>
        {/* 3D Soft Shell Gradient */}
        <radialGradient id={`${uid}-shell`} cx="35%" cy="28%" r="72%">
          <stop offset="0%" stopColor="var(--card)" />
          <stop offset="65%" stopColor="var(--muted)" />
          <stop offset="100%" stopColor="var(--border-strong)" />
        </radialGradient>

        {/* 3D Dark Glossy Visor */}
        <linearGradient id={`${uid}-visor`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="oklch(0.18 0 0)" />
          <stop offset="100%" stopColor="oklch(0.06 0 0)" />
        </linearGradient>

        {/* Glowing Orb */}
        <radialGradient id={`${uid}-orb`} cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="oklch(0.98 0 0)" />
          <stop offset="45%" stopColor={accent} />
          <stop offset="100%" stopColor={accent} stopOpacity="0.85" />
        </radialGradient>

        {/* Ground Shadow */}
        <radialGradient id={`${uid}-shadow`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--foreground)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--foreground)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Subtle Floating Shadow */}
      <ellipse cx="60" cy="109" rx="28" ry="5.5" fill={`url(#${uid}-shadow)`} />

      {/* Main Floating Character Group */}
      <g
        style={{
          transformOrigin: "60px 62px",
          animation: mood === "thinking" ? "float-y 2.2s ease-in-out infinite" : "float-y 4.5s ease-in-out infinite",
        }}
      >
        {/* Thinking Orbit Ring */}
        {mood === "thinking" && (
          <ellipse
            cx="60"
            cy="24"
            rx="22"
            ry="6"
            stroke={accent}
            strokeWidth="2"
            strokeDasharray="4 4"
            opacity="0.75"
          />
        )}

        {/* Antenna Stem & Glowing 3D Orb */}
        <path d="M60 28V16" stroke="var(--border-strong)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="60" cy="13" r="6.5" fill={`url(#${uid}-orb)`} />
        <circle cx="58" cy="11" r="2" fill="oklch(0.99 0 0)" opacity="0.8" />

        {/* 3D Ear Pods */}
        <rect x="13" y="50" width="10" height="24" rx="5" fill={`url(#${uid}-shell)`} stroke="var(--border)" strokeWidth="1.5" />
        <rect x="97" y="50" width="10" height="24" rx="5" fill={`url(#${uid}-shell)`} stroke="var(--border)" strokeWidth="1.5" />
        <circle cx="18" cy="62" r="2.5" fill={accent} />
        <circle cx="102" cy="62" r="2.5" fill={accent} />

        {/* 3D Rounded Head Body */}
        <rect
          x="20"
          y="28"
          width="80"
          height="68"
          rx="32"
          fill={`url(#${uid}-shell)`}
          stroke="var(--border)"
          strokeWidth="2"
        />

        {/* Top Specular Highlight */}
        <path
          d="M36 35c12-4 36-4 48 0"
          stroke="oklch(1 0 0)"
          strokeOpacity="0.45"
          strokeWidth="3"
          strokeLinecap="round"
        />

        {/* Inner Glossy Visor */}
        <rect x="29" y="42" width="62" height="40" rx="18" fill={`url(#${uid}-visor)`} />
        <path
          d="M37 47c14-2.5 32-2.5 46 0"
          stroke="oklch(1 0 0)"
          strokeOpacity="0.16"
          strokeWidth="2"
          strokeLinecap="round"
        />

        {/* Expressive Eyes */}
        <g transform={`translate(${eyeOffsetX.toFixed(2)}, ${eyeOffsetY.toFixed(2)})`}>
          {mood === "happy" ? (
            <>
              <path d="M41 59c2.5-4 6.5-4 9 0" stroke={accent} strokeWidth="3.5" strokeLinecap="round" />
              <path d="M70 59c2.5-4 6.5-4 9 0" stroke={accent} strokeWidth="3.5" strokeLinecap="round" />
            </>
          ) : blink ? (
            <>
              <line x1="40" y1="58" x2="50" y2="58" stroke={accent} strokeWidth="3.2" strokeLinecap="round" />
              <line x1="70" y1="58" x2="80" y2="58" stroke={accent} strokeWidth="3.2" strokeLinecap="round" />
            </>
          ) : (
            <>
              <rect x="40" y="51" width="10" height="14" rx="5" fill={accent} />
              <rect x="70" y="51" width="10" height="14" rx="5" fill={accent} />
              {/* Glossy eye catchlights */}
              <circle cx="43.5" cy="54.5" r="2" fill="oklch(0.99 0 0)" />
              <circle cx="73.5" cy="54.5" r="2" fill="oklch(0.99 0 0)" />
            </>
          )}
        </g>

        {/* Expressive Mouth */}
        {mood === "writing" ? (
          <rect x="52" y="70" width="16" height="5" rx="2.5" fill={accent} opacity="0.95" />
        ) : mood === "thinking" ? (
          <circle cx="62" cy="72" r="3" fill={accent} opacity="0.9" />
        ) : (
          <path
            d="M52 70c3.5 4 12.5 4 16 0"
            stroke={accent}
            strokeWidth="3"
            strokeLinecap="round"
          />
        )}

        {/* Cute Floating Hand Wave on Happy / Idle */}
        {mood === "happy" && (
          <circle cx="103" cy="84" r="6.5" fill={`url(#${uid}-orb)`} />
        )}
      </g>
    </svg>
  );
}
