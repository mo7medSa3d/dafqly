/**
 * Landing illustrations: hand-built SVG, colored only by brand tokens (so they
 * follow light/dark), with no text inside (so they are identical in AR/EN/RTL).
 * Decorative: aria-hidden, no external files, no license obligations.
 */
import * as React from "react";

const C = {
  line: "var(--border)", strong: "var(--border-strong)", ink: "var(--foreground)", card: "var(--card)",
  soft: "var(--muted)", acc: "var(--chart-2)", amber: "var(--chart-1)", sub: "var(--text-subtle)",
  ok: "var(--status-paid-fg)", okBg: "var(--status-paid-bg)", bad: "var(--status-overdue-fg)", badBg: "var(--status-overdue-bg)",
};
const W = "white";

function Svg({ vb, children, className }: { vb: string; children: React.ReactNode; className?: string }) {
  return (
    <svg viewBox={vb} className={className ?? "h-full w-full"} fill="none" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet">
      {children}
    </svg>
  );
}
const Bars = ({ x, y, w, rows, gap = 14, fill = C.soft }: { x: number; y: number; w: number; rows: number; gap?: number; fill?: string }) => (
  <>{Array.from({ length: rows }, (_, i) => <rect key={i} x={x} y={y + i * gap} width={i % 2 ? w * 0.7 : w} height="5" rx="2.5" fill={fill} />)}</>
);
const Tick = ({ cx, cy, r = 14, bg = C.okBg, fg = C.ok }: { cx: number; cy: number; r?: number; bg?: string; fg?: string }) => (
  <g><circle cx={cx} cy={cy} r={r} fill={bg} /><path d={`M${cx - r * 0.42} ${cy + r * 0.02}l${r * 0.3} ${r * 0.32} ${r * 0.58}-${r * 0.7}`} stroke={fg} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></g>
);

/** Hero: soft dotted grid + orbit rings behind the product preview. */
export function HeroBackdrop() {
  return (
    <Svg vb="0 0 600 460" className="absolute inset-0 h-full w-full">
      <defs>
        <pattern id="lp-dots" width="22" height="22" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill={C.strong} /></pattern>
        <radialGradient id="lp-fade" cx="50%" cy="50%" r="50%"><stop offset="55%" stopColor="white" /><stop offset="100%" stopColor="black" /></radialGradient>
        <mask id="lp-mask"><rect width="600" height="460" fill="url(#lp-fade)" /></mask>
      </defs>
      <rect width="600" height="460" fill="url(#lp-dots)" mask="url(#lp-mask)" opacity=".7" />
      <circle cx="300" cy="230" r="210" stroke={C.line} strokeDasharray="3 7" />
      <circle cx="300" cy="230" r="150" stroke={C.line} />
      <circle cx="510" cy="120" r="7" fill={C.amber} /><circle cx="86" cy="330" r="5" fill={C.acc} />
    </Svg>
  );
}

/** Feature: scheduled reminders (calendar + chat bubbles + sent tick). */
export function RemindersArt() {
  return (
    <Svg vb="0 0 360 190">
      <rect x="22" y="22" width="124" height="146" rx="14" fill={C.card} stroke={C.line} />
      <path d="M22 50h124V36a14 14 0 0 0-14-14H36a14 14 0 0 0-14 14z" fill={C.acc} />
      {Array.from({ length: 15 }, (_, i) => (
        <circle key={i} cx={42 + (i % 5) * 20} cy={72 + Math.floor(i / 5) * 26} r="5" fill={i === 7 ? C.amber : C.soft} />
      ))}
      <circle cx="102" cy="98" r="11" stroke={C.amber} strokeWidth="2" />
      <rect x="176" y="28" width="160" height="48" rx="16" fill={C.acc} />
      <Bars x={192} y={44} w={110} rows={2} gap={12} fill={W} />
      <rect x="196" y="92" width="140" height="42" rx="16" fill={C.card} stroke={C.line} />
      <Bars x={212} y={106} w={92} rows={2} gap={11} fill={C.strong} />
      <Tick cx={316} cy={160} r={15} />
      <circle cx="186" cy="156" r="13" fill={C.soft} /><path d="M186 149v7l5 3" stroke={C.ink} strokeWidth="2" strokeLinecap="round" />
    </Svg>
  );
}

/** Feature: AI copilot (core node with satellites). */
export function AiArt() {
  const sats: [number, number][] = [[70, 46], [290, 50], [64, 146], [296, 142]];
  return (
    <Svg vb="0 0 360 190">
      {sats.map(([x, y], i) => <line key={i} x1="180" y1="95" x2={x} y2={y} stroke={C.strong} strokeDasharray="4 5" />)}
      {sats.map(([x, y], i) => (
        <g key={i}><rect x={x - 28} y={y - 18} width="56" height="36" rx="10" fill={C.card} stroke={C.line} /><Bars x={x - 17} y={y - 7} w={34} rows={2} gap={9} /></g>
      ))}
      <circle cx="180" cy="95" r="46" fill={C.acc} opacity=".12" />
      <circle cx="180" cy="95" r="32" fill={C.acc} />
      <path d="M180 76l4.6 12.4L197 93l-12.4 4.6L180 110l-4.6-12.4L163 93l12.4-4.6z" fill={W} />
      <circle cx="214" cy="68" r="4" fill={C.amber} /><circle cx="148" cy="124" r="3" fill={W} opacity=".9" />
    </Svg>
  );
}

/** Feature: ledger photo -> invoices (paper, scan beam, result card). */
export function OcrArt() {
  return (
    <Svg vb="0 0 360 190">
      <rect x="40" y="18" width="116" height="154" rx="10" fill={C.card} stroke={C.line} transform="rotate(-4 98 95)" />
      {Array.from({ length: 7 }, (_, i) => <line key={i} x1="56" y1={44 + i * 18} x2="140" y2={42 + i * 18} stroke={C.strong} strokeWidth="1.5" />)}
      <rect x="30" y="84" width="136" height="20" rx="4" fill={C.acc} opacity=".16" /><line x1="30" y1="94" x2="166" y2="94" stroke={C.acc} strokeWidth="2" />
      <path d="M176 95h30m-8-8 8 8-8 8" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="216" y="30" width="120" height="130" rx="12" fill={C.card} stroke={C.line} />
      {[0, 1, 2].map((i) => (
        <g key={i}><rect x="230" y={46 + i * 34} width="48" height="8" rx="4" fill={C.soft} /><rect x="288" y={44 + i * 34} width="34" height="12" rx="4" fill={i === 1 ? C.badBg : C.okBg} /></g>
      ))}
      <Tick cx={318} cy={146} r={11} />
    </Svg>
  );
}

/** Feature: cheque tracking (cheque with stamp + due tab). */
export function ChequeArt() {
  return (
    <Svg vb="0 0 360 190">
      <rect x="32" y="40" width="250" height="112" rx="12" fill={C.card} stroke={C.line} />
      <rect x="32" y="58" width="250" height="16" fill={C.soft} />
      <Bars x={52} y={92} w={130} rows={2} gap={16} />
      <rect x="198" y="88" width="66" height="26" rx="6" stroke={C.strong} />
      <line x1="52" y1="132" x2="170" y2="132" stroke={C.strong} />
      <g transform="rotate(-12 292 120)"><circle cx="292" cy="120" r="30" stroke={C.ok} strokeWidth="3" /><circle cx="292" cy="120" r="23" stroke={C.ok} strokeWidth="1.2" /><path d="M280 120l8 9 15-17" stroke={C.ok} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></g>
      <rect x="258" y="22" width="70" height="26" rx="8" fill={C.badBg} /><circle cx="274" cy="35" r="4" fill={C.bad} /><rect x="284" y="32" width="32" height="6" rx="3" fill={C.bad} opacity=".5" />
    </Svg>
  );
}

/** Feature: customer portal (phone with statement). */
export function PortalArt() {
  return (
    <Svg vb="0 0 360 190">
      <rect x="126" y="8" width="108" height="176" rx="18" fill={C.card} stroke={C.strong} strokeWidth="1.5" />
      <rect x="160" y="15" width="40" height="5" rx="2.5" fill={C.soft} />
      <rect x="138" y="32" width="84" height="38" rx="8" fill={C.acc} />
      <rect x="148" y="42" width="40" height="6" rx="3" fill={W} opacity=".7" /><rect x="148" y="54" width="58" height="8" rx="4" fill={W} />
      {[0, 1, 2].map((i) => <g key={i}><rect x="138" y={80 + i * 22} width="84" height="16" rx="6" fill={C.soft} /><circle cx="148" cy={88 + i * 22} r="4" fill={i === 0 ? C.bad : C.strong} /></g>)}
      <rect x="138" y="150" width="84" height="22" rx="8" fill={C.ink} />
      <rect x="40" y="50" width="62" height="40" rx="12" fill={C.card} stroke={C.line} /><Tick cx={71} cy={70} r={11} />
      <rect x="260" y="96" width="64" height="40" rx="12" fill={C.card} stroke={C.line} /><path d="M276 118h32M276 108h20" stroke={C.strong} strokeWidth="3" strokeLinecap="round" />
      <circle cx="296" cy="42" r="5" fill={C.amber} />
    </Svg>
  );
}

/** How it works: one small scene per step (1 import, 2 policy, 3 collect). */
export function StepArt({ step }: { step: 1 | 2 | 3 }) {
  return (
    <Svg vb="0 0 220 110">
      {step === 1 && (<>
        <rect x="30" y="20" width="76" height="74" rx="10" fill={C.card} stroke={C.line} /><Bars x={42} y={36} w={52} rows={4} gap={14} />
        <path d="M116 57h28m-8-8 8 8-8 8" stroke={C.sub} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="154" y="28" width="44" height="54" rx="8" fill={C.acc} /><path d="M176 66V46m-8 8 8-8 8 8" stroke={W} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </>)}
      {step === 2 && (<>
        {[0, 1, 2].map((i) => (<g key={i}><rect x="30" y={26 + i * 28} width="160" height="6" rx="3" fill={C.soft} /><circle cx={[70, 130, 100][i]} cy={29 + i * 28} r="9" fill={i === 1 ? C.amber : C.acc} /><circle cx={[70, 130, 100][i]} cy={29 + i * 28} r="3.5" fill={W} /></g>))}
      </>)}
      {step === 3 && (<>
        {[28, 44, 62, 84].map((h, i) => <rect key={i} x={36 + i * 38} y={96 - h} width="24" height={h} rx="5" fill={i === 3 ? C.acc : C.soft} />)}
        <Tick cx={176} cy={22} r={13} />
      </>)}
    </Svg>
  );
}

/** Final CTA: shield + coins + sparkles. */
export function CtaArt() {
  return (
    <Svg vb="0 0 300 240">
      <circle cx="150" cy="120" r="104" fill={C.acc} opacity=".08" /><circle cx="150" cy="120" r="76" stroke={C.line} strokeDasharray="3 6" />
      <path d="M150 42l56 20v44c0 36-24 62-56 78-32-16-56-42-56-78V62z" fill={C.card} stroke={C.strong} strokeWidth="1.5" />
      <path d="M150 58l40 14v34c0 27-17 47-40 59-23-12-40-32-40-59V72z" fill={C.acc} />
      <path d="M130 112l14 15 27-31" stroke={W} strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
      {[0, 1, 2].map((i) => <ellipse key={i} cx="236" cy={186 - i * 11} rx="26" ry="8" fill={C.amber} stroke={C.card} strokeWidth="2" />)}
      <circle cx="58" cy="70" r="6" fill={C.amber} /><circle cx="248" cy="62" r="4" fill={C.acc} /><circle cx="64" cy="188" r="4" fill={C.strong} />
    </Svg>
  );
}
