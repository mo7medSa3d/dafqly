/**
 * Landing page SVG illustrations: 4 bespoke, animated, token-colored SVGs.
 * Uses only CSS brand tokens (follows Light/Dark automatically) and zero
 * embedded text (identical across Arabic RTL and English LTR).
 */
import * as React from "react";

const T = {
  bg: "var(--background)",
  card: "var(--card)",
  muted: "var(--muted)",
  border: "var(--border)",
  strong: "var(--border-strong)",
  ink: "var(--foreground)",
  subtle: "var(--text-subtle)",
  primary: "var(--primary)",
  primaryFg: "var(--primary-foreground)",
  accent: "var(--chart-2)",
  amber: "var(--chart-1)",
  okFg: "var(--status-paid-fg)",
  okBg: "var(--status-paid-bg)",
  dueFg: "var(--status-due-fg)",
  dueBg: "var(--status-due-bg)",
  badFg: "var(--status-overdue-fg)",
  badBg: "var(--status-overdue-bg)",
};

function Frame({
  vb,
  children,
  className,
}: {
  vb: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <svg
      viewBox={vb}
      className={className ?? "h-auto w-full"}
      fill="none"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid meet"
    >
      {children}
    </svg>
  );
}

/** 1. Hero SVG: Live cashflow pipeline (Invoice -> Automated Follow-up -> Instant Settlement). */
export function HeroCashflowSvg() {
  return (
    <Frame vb="0 0 560 400">
      <defs>
        <pattern id="hero-grid" width="24" height="24" patternUnits="userSpaceOnUse">
          <circle cx="2" cy="2" r="1.2" fill={T.strong} opacity="0.45" />
        </pattern>
        <radialGradient id="hero-mask-grad" cx="50%" cy="50%" r="52%">
          <stop offset="50%" stopColor="white" />
          <stop offset="100%" stopColor="black" />
        </radialGradient>
        <mask id="hero-mask">
          <rect width="560" height="400" fill="url(#hero-mask-grad)" />
        </mask>
      </defs>

      {/* Subtle dotted grid */}
      <rect width="560" height="400" fill="url(#hero-grid)" mask="url(#hero-mask)" />

      {/* Main dashboard canvas card */}
      <rect x="44" y="48" width="472" height="304" rx="20" fill={T.card} stroke={T.border} strokeWidth="1.5" />
      <rect x="44" y="48" width="472" height="44" rx="20" fill={T.muted} />
      <rect x="44" y="72" width="472" height="20" fill={T.muted} />
      <line x1="44" y1="92" x2="516" y2="92" stroke={T.border} />

      {/* Window dots */}
      <circle cx="72" cy="70" r="4.5" fill={T.strong} />
      <circle cx="88" cy="70" r="4.5" fill={T.strong} />
      <circle cx="104" cy="70" r="4.5" fill={T.strong} />
      <rect x="396" y="62" width="96" height="16" rx="8" fill={T.okBg} />
      <circle cx="410" cy="70" r="3.5" fill={T.okFg} />
      <rect x="420" y="67.5" width="56" height="5" rx="2.5" fill={T.okFg} opacity="0.7" />

      {/* Cashflow area & animated pulse curve */}
      <path
        d="M78 272 C132 272, 146 218, 200 222 C254 226, 268 168, 322 174 C376 180, 404 126, 482 122 L482 308 L78 308 Z"
        fill={T.primary}
        opacity="0.08"
      />
      <path
        d="M78 272 C132 272, 146 218, 200 222 C254 226, 268 168, 322 174 C376 180, 404 126, 482 122"
        stroke={T.primary}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="M78 272 C132 272, 146 218, 200 222 C254 226, 268 168, 322 174 C376 180, 404 126, 482 122"
        stroke={T.accent}
        strokeWidth="3"
        strokeLinecap="round"
        className="dafqly-beam"
        opacity="0.85"
      />

      {/* KPI bars on left */}
      <rect x="78" y="114" width="126" height="62" rx="12" fill={T.muted} stroke={T.border} />
      <rect x="92" y="128" width="52" height="6" rx="3" fill={T.strong} />
      <rect x="92" y="144" width="84" height="12" rx="4" fill={T.ink} opacity="0.85" />

      {/* Floating node 1: WhatsApp reminder dispatched */}
      <g className="dafqly-float">
        <rect x="20" y="210" width="168" height="58" rx="14" fill={T.card} stroke={T.strong} strokeWidth="1.5" />
        <circle cx="48" cy="239" r="14" fill={T.accent} opacity="0.16" />
        <circle cx="48" cy="239" r="7" fill={T.accent} />
        <rect x="72" y="227" width="86" height="7" rx="3.5" fill={T.ink} opacity="0.8" />
        <rect x="72" y="242" width="58" height="6" rx="3" fill={T.strong} />
      </g>

      {/* Floating node 2: Payment confirmed */}
      <g className="dafqly-float-slow">
        <rect x="356" y="24" width="184" height="62" rx="14" fill={T.card} stroke={T.strong} strokeWidth="1.5" />
        <circle cx="386" cy="55" r="15" fill={T.okBg} />
        <circle cx="386" cy="55" r="15" stroke={T.okFg} strokeWidth="1.5" className="dafqly-pulse-ring" />
        <path d="M380 55l4 4.5 8.5-9.5" stroke={T.okFg} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="412" y="42" width="98" height="7" rx="3.5" fill={T.ink} opacity="0.85" />
        <rect x="412" y="57" width="64" height="6" rx="3" fill={T.okFg} opacity="0.7" />
      </g>

      {/* Live target dot on curve */}
      <circle cx="482" cy="122" r="12" fill={T.amber} opacity="0.22" className="dafqly-pulse-ring" />
      <circle cx="482" cy="122" r="6" fill={T.amber} stroke={T.card} strokeWidth="2" />
    </Frame>
  );
}

/** 2. Capability SVG: AI Copilot + Automated WhatsApp & Quiet-Hours Guard. */
export function AutomationEngineSvg() {
  return (
    <Frame vb="0 0 480 340">
      <rect x="24" y="24" width="432" height="292" rx="22" fill={T.muted} stroke={T.border} />

      {/* Connection beams */}
      <path d="M132 108 L240 170 L348 108" stroke={T.strong} strokeWidth="2" className="dafqly-beam" />
      <path d="M132 232 L240 170 L348 232" stroke={T.strong} strokeWidth="2" className="dafqly-beam" />

      {/* Satellite cards */}
      <g className="dafqly-float">
        <rect x="52" y="72" width="128" height="64" rx="14" fill={T.card} stroke={T.border} />
        <circle cx="78" cy="104" r="12" fill={T.okBg} />
        <path d="M73 104l3.5 3.5 7-7.5" stroke={T.okFg} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="100" y="94" width="60" height="7" rx="3.5" fill={T.ink} opacity="0.8" />
        <rect x="100" y="109" width="42" height="5" rx="2.5" fill={T.strong} />
      </g>

      <g className="dafqly-float-slow">
        <rect x="300" y="72" width="128" height="64" rx="14" fill={T.card} stroke={T.border} />
        <circle cx="326" cy="104" r="12" fill={T.dueBg} />
        <path d="M326 98v6l4 2.5" stroke={T.dueFg} strokeWidth="2.2" strokeLinecap="round" />
        <rect x="348" y="94" width="60" height="7" rx="3.5" fill={T.ink} opacity="0.8" />
        <rect x="348" y="109" width="46" height="5" rx="2.5" fill={T.strong} />
      </g>

      <g className="dafqly-float-slow">
        <rect x="52" y="204" width="128" height="64" rx="14" fill={T.card} stroke={T.border} />
        <rect x="68" y="220" width="96" height="10" rx="5" fill={T.primary} opacity="0.16" />
        <rect x="68" y="220" width="62" height="10" rx="5" fill={T.primary} />
        <rect x="68" y="242" width="76" height="6" rx="3" fill={T.strong} />
      </g>

      <g className="dafqly-float">
        <rect x="300" y="204" width="128" height="64" rx="14" fill={T.card} stroke={T.border} />
        <circle cx="326" cy="236" r="12" fill={T.amber} opacity="0.2" />
        <circle cx="326" cy="236" r="5" fill={T.amber} />
        <rect x="348" y="226" width="62" height="7" rx="3.5" fill={T.ink} opacity="0.8" />
        <rect x="348" y="241" width="44" height="5" rx="2.5" fill={T.strong} />
      </g>

      {/* Center AI Core */}
      <circle cx="240" cy="170" r="52" fill={T.primary} opacity="0.12" className="dafqly-pulse-ring" />
      <circle cx="240" cy="170" r="36" fill={T.primary} />
      <path d="M240 150l5 13.5L258.5 168.5 245 173.5 240 187l-5-13.5-13.5-5 13.5-5z" fill={T.primaryFg} />
    </Frame>
  );
}

/** 3. Capability SVG: Ledger OCR Scan & Cheque Clearing. */
export function LedgerScanSvg() {
  return (
    <Frame vb="0 0 480 340">
      <rect x="24" y="24" width="432" height="292" rx="22" fill={T.muted} stroke={T.border} />

      {/* Paper ledger on left */}
      <g>
        <rect x="52" y="58" width="154" height="224" rx="14" fill={T.card} stroke={T.strong} strokeWidth="1.5" />
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <g key={i}>
            <rect x="70" y={84 + i * 28} width="68" height="7" rx="3.5" fill={T.strong} opacity="0.7" />
            <rect x="150" y={84 + i * 28} width="38" height="7" rx="3.5" fill={i === 2 ? T.amber : T.muted} />
          </g>
        ))}
        {/* Animated scan beam */}
        <g className="dafqly-scan">
          <rect x="44" y="74" width="170" height="26" rx="6" fill={T.primary} opacity="0.16" />
          <line x1="44" y1="87" x2="214" y2="87" stroke={T.primary} strokeWidth="2.5" strokeLinecap="round" />
        </g>
      </g>

      {/* Arrow beam */}
      <path d="M224 170h34" stroke={T.primary} strokeWidth="2.5" strokeLinecap="round" className="dafqly-beam" />
      <path d="M250 162l8 8-8 8" stroke={T.primary} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />

      {/* Structured digital ledger & cheque status on right */}
      <rect x="272" y="58" width="156" height="224" rx="14" fill={T.card} stroke={T.border} strokeWidth="1.5" />
      {[
        { bg: T.okBg, fg: T.okFg },
        { bg: T.okBg, fg: T.okFg },
        { bg: T.dueBg, fg: T.dueFg },
        { bg: T.badBg, fg: T.badFg },
      ].map((s, i) => (
        <g key={i}>
          <rect x="288" y={78 + i * 48} width="124" height="36" rx="9" fill={T.muted} />
          <rect x="298" y={91 + i * 48} width="56" height="8" rx="4" fill={T.ink} opacity="0.75" />
          <rect x="366" y={87 + i * 48} width="36" height="16" rx="8" fill={s.bg} />
          <circle cx="384" cy={95 + i * 48} r="3.5" fill={s.fg} />
        </g>
      ))}
    </Frame>
  );
}

/** 4. Capability SVG: Self-Serve Customer Portal & Instant Settlement. */
export function PortalFlowSvg() {
  return (
    <Frame vb="0 0 480 340">
      <rect x="24" y="24" width="432" height="292" rx="22" fill={T.muted} stroke={T.border} />

      {/* Mobile statement portal */}
      <rect x="164" y="38" width="152" height="264" rx="24" fill={T.card} stroke={T.strong} strokeWidth="2" />
      <rect x="216" y="48" width="48" height="5" rx="2.5" fill={T.strong} />

      {/* Balance header inside phone */}
      <rect x="180" y="68" width="120" height="58" rx="12" fill={T.primary} />
      <rect x="194" y="82" width="46" height="6" rx="3" fill={T.primaryFg} opacity="0.65" />
      <rect x="194" y="96" width="84" height="12" rx="4" fill={T.primaryFg} />

      {/* Invoice rows */}
      {[0, 1, 2].map((i) => (
        <g key={i}>
          <rect x="180" y={138 + i * 32} width="120" height="24" rx="7" fill={T.muted} />
          <circle cx="194" cy={150 + i * 32} r="4.5" fill={i === 0 ? T.badFg : T.okFg} />
          <rect x="206" y={147 + i * 32} width="64" height="6" rx="3" fill={T.strong} />
        </g>
      ))}

      {/* Pay button */}
      <rect x="180" y="246" width="120" height="34" rx="10" fill={T.okFg} />
      <rect x="212" y="260" width="56" height="6" rx="3" fill={T.okBg} />

      {/* Floating confirmation badges */}
      <g className="dafqly-float">
        <rect x="44" y="106" width="104" height="54" rx="14" fill={T.card} stroke={T.border} />
        <circle cx="70" cy="133" r="12" fill={T.okBg} />
        <path d="M65 133l3.5 3.5 7-7.5" stroke={T.okFg} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="90" y="125" width="44" height="6" rx="3" fill={T.ink} opacity="0.8" />
        <rect x="90" y="137" width="30" height="5" rx="2.5" fill={T.strong} />
      </g>

      <g className="dafqly-float-slow">
        <rect x="332" y="168" width="104" height="54" rx="14" fill={T.card} stroke={T.border} />
        <circle cx="358" cy="195" r="12" fill={T.amber} opacity="0.2" />
        <circle cx="358" cy="195" r="5" fill={T.amber} />
        <rect x="378" y="187" width="44" height="6" rx="3" fill={T.ink} opacity="0.8" />
        <rect x="378" y="199" width="32" height="5" rx="2.5" fill={T.strong} />
      </g>
    </Frame>
  );
}
