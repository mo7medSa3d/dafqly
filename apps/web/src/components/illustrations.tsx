/**
 * Theme-adaptive 2026 Fintech SaaS illustrations & security badges.
 * Every surface, stroke, and accent uses CSS variables (--illus-stage,
 * --illus-card, --illus-muted, --illus-border, --brand-mark-primary,
 * --brand-mark-accent, --yaseir-*) so both Light Mode and Dark Mode
 * render with balanced contrast and zero hardcoded hex colors.
 */

export function HeroDashboardIllustration({ size = 480 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.625)} viewBox="0 0 800 500" fill="none" aria-hidden="true" focusable="false" className="h-auto w-full max-w-2xl">
      <defs>
        <linearGradient id="hero-chart-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--brand-mark-primary)" stopOpacity="0.28" />
          <stop offset="100%" stopColor="var(--brand-mark-primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect width="800" height="500" rx="30" fill="var(--illus-stage)" />
      <circle cx="690" cy="84" r="90" fill="var(--yaseir-yellow)" opacity="0.55" />
      <circle cx="105" cy="430" r="105" fill="var(--brand-mark-accent)" opacity="0.22" />
      <g>
        <rect x="88" y="68" width="624" height="364" rx="22" fill="var(--illus-card)" stroke="var(--illus-border)" strokeWidth="2" />
        <path d="M88 90Q88 68 110 68H690Q712 68 712 90V120H88Z" fill="var(--brand-mark-primary)" />
        <circle cx="118" cy="94" r="6" fill="var(--yaseir-yellow)" />
        <circle cx="139" cy="94" r="6" fill="var(--yaseir-pink)" />
        <circle cx="160" cy="94" r="6" fill="var(--brand-mark-accent)" />
        <rect x="530" y="85" width="150" height="18" rx="9" fill="white" opacity="0.18" />
        {/* Sidebar */}
        <path d="M88 120H218V432H110Q88 432 88 410Z" fill="var(--illus-muted)" />
        <rect x="108" y="144" width="90" height="24" rx="8" fill="var(--brand-mark-primary)" opacity="0.16" />
        <rect x="118" y="152" width="56" height="8" rx="4" fill="var(--brand-mark-primary)" />
        <rect x="112" y="192" width="76" height="9" rx="4.5" fill="var(--slate-400)" />
        <rect x="112" y="224" width="62" height="9" rx="4.5" fill="var(--slate-400)" />
        <rect x="112" y="256" width="80" height="9" rx="4.5" fill="var(--slate-400)" />
        <rect x="112" y="288" width="66" height="9" rx="4.5" fill="var(--slate-400)" />
        {/* Bento KPI Row */}
        <rect x="240" y="142" width="142" height="78" rx="14" fill="var(--illus-muted)" stroke="var(--illus-border)" strokeWidth="1" />
        <rect x="394" y="142" width="142" height="78" rx="14" fill="var(--illus-muted)" stroke="var(--illus-border)" strokeWidth="1" />
        <rect x="548" y="142" width="144" height="78" rx="14" fill="var(--illus-muted)" stroke="var(--illus-border)" strokeWidth="1" />
        <rect x="256" y="158" width="54" height="7" rx="3.5" fill="var(--slate-400)" />
        <rect x="256" y="178" width="78" height="16" rx="5" fill="var(--brand-mark-primary)" />
        <rect x="410" y="158" width="54" height="7" rx="3.5" fill="var(--slate-400)" />
        <rect x="410" y="178" width="78" height="16" rx="5" fill="var(--yaseir-teal)" />
        <rect x="564" y="158" width="54" height="7" rx="3.5" fill="var(--slate-400)" />
        <rect x="564" y="178" width="78" height="16" rx="5" fill="var(--yaseir-violet)" />
        {/* Cashflow Area Chart Tile */}
        <rect x="240" y="236" width="296" height="174" rx="14" fill="var(--illus-muted)" stroke="var(--illus-border)" strokeWidth="1" />
        <line x1="258" y1="286" x2="518" y2="286" stroke="var(--illus-border)" strokeWidth="1" strokeDasharray="4 4" />
        <line x1="258" y1="330" x2="518" y2="330" stroke="var(--illus-border)" strokeWidth="1" strokeDasharray="4 4" />
        <line x1="258" y1="374" x2="518" y2="374" stroke="var(--illus-border)" strokeWidth="1.5" />
        <path d="M262 362 C298 352, 322 312, 358 318 C394 324, 420 272, 460 278 C484 282, 502 256, 514 252 L514 374 L262 374 Z" fill="url(#hero-chart-fill)" />
        <path d="M262 362 C298 352, 322 312, 358 318 C394 324, 420 272, 460 278 C484 282, 502 256, 514 252" fill="none" stroke="var(--brand-mark-primary)" strokeWidth="4" strokeLinecap="round" />
        <circle cx="460" cy="278" r="6" fill="var(--illus-card)" stroke="var(--brand-mark-primary)" strokeWidth="3" />
        <circle cx="514" cy="252" r="6" fill="var(--brand-mark-accent)" stroke="var(--illus-card)" strokeWidth="2.5" />
        {/* Collection Health Ring Tile */}
        <rect x="548" y="236" width="144" height="174" rx="14" fill="var(--illus-muted)" stroke="var(--illus-border)" strokeWidth="1" />
        <circle cx="620" cy="310" r="42" fill="none" stroke="var(--illus-border)" strokeWidth="12" />
        <path d="M620 268 A42 42 0 1 1 580 324" fill="none" stroke="var(--yaseir-teal)" strokeWidth="12" strokeLinecap="round" />
        <rect x="588" y="372" width="64" height="10" rx="5" fill="var(--brand-mark-primary)" opacity="0.25" />
      </g>
    </svg>
  );
}

export function ReceivablesIllustration({ size = 260 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.625)} viewBox="0 0 800 500" fill="none" aria-hidden="true" focusable="false" className="h-auto max-w-full">
      <rect width="800" height="500" rx="30" fill="var(--illus-stage)" />
      <circle cx="120" cy="180" r="90" fill="var(--brand-mark-accent)" opacity="0.25" />
      <circle cx="670" cy="370" r="110" fill="var(--yaseir-yellow)" opacity="0.55" />
      <g>
        <rect x="210" y="76" width="324" height="360" rx="24" fill="var(--illus-card)" stroke="var(--illus-border)" strokeWidth="2" />
        <rect x="245" y="114" width="125" height="12" rx="6" fill="var(--brand-mark-primary)" />
        <rect x="245" y="142" width="82" height="8" rx="4" fill="var(--slate-400)" />
        <line x1="245" y1="172" x2="499" y2="172" stroke="var(--illus-border)" strokeWidth="2" />
        <rect x="245" y="196" width="142" height="9" rx="4.5" fill="var(--slate-400)" />
        <rect x="415" y="196" width="70" height="9" rx="4.5" fill="var(--illus-bar)" />
        <rect x="245" y="226" width="110" height="9" rx="4.5" fill="var(--slate-400)" />
        <rect x="415" y="226" width="70" height="9" rx="4.5" fill="var(--illus-bar)" />
        <rect x="245" y="256" width="135" height="9" rx="4.5" fill="var(--slate-400)" />
        <rect x="415" y="256" width="70" height="9" rx="4.5" fill="var(--illus-bar)" />
        <rect x="243" y="302" width="258" height="64" rx="14" fill="var(--illus-muted)" />
        <rect x="263" y="324" width="72" height="7" rx="3.5" fill="var(--slate-400)" />
        <rect x="263" y="339" width="150" height="11" rx="5.5" fill="var(--brand-mark-primary)" />
      </g>
      <rect x="437" y="210" width="214" height="128" rx="18" fill="var(--brand-mark-primary)" />
      <circle cx="475" cy="242" r="15" fill="var(--brand-mark-accent)" />
      <rect x="475" y="270" width="90" height="8" rx="4" fill="white" />
      <rect x="475" y="286" width="52" height="5" rx="2.5" fill="var(--navy-200)" />
      <circle cx="617" cy="158" r="44" fill="var(--yaseir-teal)" />
      <path d="M597 158L611 172L637 144" stroke="white" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SecuritySignInIllustration({ size = 380 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.625)} viewBox="0 0 800 500" fill="none" aria-hidden="true" focusable="false" className="h-auto w-full max-w-lg">
      <rect width="800" height="500" rx="30" fill="var(--illus-stage)" />
      <circle cx="650" cy="120" r="110" fill="var(--brand-mark-accent)" opacity="0.25" />
      <circle cx="170" cy="400" r="90" fill="var(--yaseir-pink)" opacity="0.28" />
      <g>
        <rect x="145" y="130" width="510" height="250" rx="22" fill="var(--illus-card)" stroke="var(--illus-border)" strokeWidth="2" />
        <rect x="175" y="160" width="84" height="68" rx="14" fill="var(--illus-muted)" />
        <circle cx="217" cy="181" r="15" fill="var(--brand-mark-primary)" />
        <path d="M191 214C191 204.6 198.6 197 208 197H226C235.4 197 243 204.6 243 214V217H191V214Z" fill="var(--brand-mark-primary)" />
        <rect x="283" y="167" width="183" height="10" rx="5" fill="var(--slate-400)" />
        <rect x="283" y="191" width="120" height="9" rx="4.5" fill="var(--illus-bar)" />
        <rect x="175" y="256" width="300" height="36" rx="10" fill="var(--illus-muted)" stroke="var(--illus-border)" strokeWidth="1.5" />
        <rect x="175" y="308" width="300" height="36" rx="18" fill="var(--brand-mark-primary)" />
        <rect x="279" y="323" width="92" height="6" rx="3" fill="white" />
        <path d="M534 194V243H610V194C610 173.013 592.987 156 572 156C551.013 156 534 173.013 534 194Z" fill="none" stroke="var(--brand-mark-primary)" strokeWidth="13" strokeLinecap="round" />
        <rect x="520" y="243" width="105" height="76" rx="16" fill="var(--brand-mark-accent)" />
        <circle cx="572.5" cy="273.5" r="7.5" fill="var(--navy-700)" />
        <path d="M572.5 281V296" stroke="var(--navy-700)" strokeWidth="4" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function SecurityLockBadge({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 140 160" fill="none" aria-hidden="true" focusable="false" className="shrink-0">
      <path d="M36 56V96H104V56C104 37.222 88.778 22 70 22C51.222 22 36 37.222 36 56Z" fill="none" stroke="var(--brand-mark-primary)" strokeWidth="12" strokeLinecap="round" />
      <rect x="22" y="76" width="96" height="68" rx="16" fill="var(--brand-mark-accent)" />
      <circle cx="70" cy="103" r="7" fill="var(--navy-700)" />
      <path d="M70 110V124" stroke="var(--navy-700)" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyInvoicesIllustration({ size = 160 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 220 220" fill="none" aria-hidden="true" focusable="false">
      <circle cx="110" cy="110" r="88" fill="var(--illus-stage)" />
      <rect x="64" y="42" width="96" height="126" rx="16" fill="var(--illus-muted)" stroke="var(--illus-border)" strokeWidth="2.5" transform="rotate(-6 112 105)" />
      <rect x="62" y="48" width="96" height="126" rx="16" fill="var(--illus-card)" stroke="var(--brand-mark-primary)" strokeWidth="3" />
      <rect x="80" y="72" width="48" height="9" rx="4.5" fill="var(--brand-mark-primary)" />
      <rect x="80" y="94" width="60" height="7" rx="3.5" fill="var(--slate-400)" />
      <rect x="80" y="112" width="44" height="7" rx="3.5" fill="var(--slate-400)" />
      <rect x="80" y="136" width="60" height="18" rx="9" fill="var(--illus-muted)" />
      <circle cx="156" cy="156" r="24" fill="var(--brand-mark-accent)" />
      <path d="M156 146v20M146 156h20" stroke="var(--navy-700)" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

export function PaymentSuccessIllustration({ size = 150 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 220 220" fill="none" aria-hidden="true" focusable="false">
      <circle cx="110" cy="110" r="86" fill="var(--illus-stage)" />
      <circle cx="168" cy="54" r="14" fill="var(--yaseir-yellow)" opacity="0.85" />
      <circle cx="52" cy="162" r="10" fill="var(--brand-mark-accent)" opacity="0.6" />
      <rect x="54" y="46" width="112" height="132" rx="18" fill="var(--illus-card)" stroke="var(--illus-border)" strokeWidth="2.5" />
      <circle cx="110" cy="96" r="30" fill="var(--yaseir-teal)" />
      <path d="M96 96l10 10 20-22" stroke="white" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="76" y="140" width="68" height="8" rx="4" fill="var(--brand-mark-primary)" opacity="0.8" />
      <rect x="88" y="156" width="44" height="6" rx="3" fill="var(--slate-400)" />
    </svg>
  );
}

export function OnboardingIllustration({ size = 180 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.72)} viewBox="0 0 260 188" fill="none" aria-hidden="true" focusable="false">
      <rect x="10" y="10" width="240" height="168" rx="24" fill="var(--illus-stage)" />
      {/* Step 1: Ledger Card */}
      <rect x="28" y="44" width="68" height="88" rx="12" fill="var(--illus-card)" stroke="var(--brand-mark-primary)" strokeWidth="2.5" />
      <rect x="40" y="60" width="36" height="8" rx="4" fill="var(--brand-mark-primary)" />
      <rect x="40" y="78" width="44" height="6" rx="3" fill="var(--slate-400)" />
      <rect x="40" y="92" width="32" height="6" rx="3" fill="var(--slate-400)" />
      {/* Connector */}
      <path d="M102 88h18" stroke="var(--brand-mark-accent)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="3 5" />
      {/* Step 2: Hub */}
      <circle cx="138" cy="88" r="20" fill="var(--brand-mark-primary)" />
      <path d="M130 88l6 6 12-12" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      {/* Connector */}
      <path d="M162 88h18" stroke="var(--brand-mark-accent)" strokeWidth="3.5" strokeLinecap="round" strokeDasharray="3 5" />
      {/* Step 3: Collected */}
      <rect x="184" y="44" width="48" height="88" rx="12" fill="var(--illus-card)" stroke="var(--yaseir-teal)" strokeWidth="2.5" />
      <circle cx="208" cy="76" r="13" fill="var(--yaseir-teal)" opacity="0.18" />
      <circle cx="208" cy="76" r="6" fill="var(--yaseir-teal)" />
      <rect x="196" y="102" width="24" height="6" rx="3" fill="var(--slate-400)" />
      <rect x="196" y="114" width="18" height="6" rx="3" fill="var(--brand-mark-accent)" />
    </svg>
  );
}

export function ConnectionErrorIllustration({ size = 130 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect x="20" y="20" width="160" height="160" rx="28" fill="var(--illus-stage)" />
      <circle cx="62" cy="100" r="22" fill="var(--illus-card)" stroke="var(--brand-mark-primary)" strokeWidth="5" />
      <circle cx="138" cy="100" r="22" fill="var(--illus-card)" stroke="var(--brand-mark-primary)" strokeWidth="5" />
      <path d="M84 82c12-14 20-14 32 0" fill="none" stroke="var(--yaseir-pink)" strokeWidth="5" strokeLinecap="round" strokeDasharray="3 8" />
      <path d="M84 120c14 16 38 16 52-2" fill="none" stroke="var(--brand-mark-accent)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="100" cy="58" r="10" fill="var(--yaseir-yellow)" />
    </svg>
  );
}

export function HeroBandArt({ size = 320 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.68)} viewBox="0 0 360 244" aria-hidden="true" focusable="false" className="w-full max-w-[340px]">
      <rect x="14" y="14" width="332" height="216" rx="22" fill="white" opacity="0.08" stroke="white" strokeOpacity="0.26" strokeWidth="2" />
      <circle cx="42" cy="36" r="5.5" fill="var(--yaseir-yellow)" />
      <circle cx="60" cy="36" r="5.5" fill="var(--yaseir-pink)" />
      <circle cx="78" cy="36" r="5.5" fill="var(--brand-mark-accent)" />
      <rect x="34" y="58" width="136" height="72" rx="14" fill="white" opacity="0.12" />
      <path d="m54 96 12 12 26-28" fill="none" stroke="var(--brand-mark-accent)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="186" y="58" width="140" height="72" rx="14" fill="var(--brand-mark-accent)" opacity="0.92" />
      <rect x="204" y="80" width="76" height="10" rx="5" fill="var(--navy-700)" opacity="0.7" />
      <rect x="204" y="98" width="48" height="9" rx="4.5" fill="var(--navy-700)" opacity="0.45" />
      {/* Mini trend sparkline inside hero widget */}
      <path d="M44 196 C80 192, 110 168, 152 174 C194 180, 224 148, 270 154" fill="none" stroke="white" strokeOpacity="0.55" strokeWidth="3.5" strokeLinecap="round" />
      <circle cx="270" cy="154" r="5" fill="var(--brand-mark-accent)" />
      <rect x="34" y="206" width="210" height="10" rx="5" fill="white" opacity="0.18" />
      <circle cx="304" cy="188" r="20" fill="var(--yaseir-yellow)" />
      <path d="m295 188 7 7 13-15" fill="none" stroke="var(--navy-700)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ForecastIllustration({ size = 130 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect x="16" y="20" width="168" height="160" rx="22" fill="var(--illus-stage)" />
      <circle cx="154" cy="48" r="20" fill="var(--yaseir-yellow)" opacity="0.85" />
      <line x1="35" y1="158" x2="168" y2="158" stroke="var(--illus-border)" strokeWidth="4" strokeLinecap="round" />
      <rect x="48" y="114" width="24" height="44" rx="6" fill="var(--illus-bar)" />
      <rect x="88" y="88" width="24" height="70" rx="6" fill="var(--brand-mark-primary)" />
      <rect x="128" y="58" width="24" height="100" rx="6" fill="var(--brand-mark-accent)" />
      <path d="M44 96c26-20 46-28 68-36 16-6 30-12 46-22" fill="none" stroke="var(--text)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 9" />
    </svg>
  );
}

export function ChequesIllustration({ size = 130 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect x="18" y="44" width="164" height="112" rx="18" fill="var(--illus-card)" stroke="var(--brand-mark-primary)" strokeWidth="4" />
      <rect x="36" y="68" width="84" height="10" rx="5" fill="var(--brand-mark-primary)" />
      <rect x="36" y="92" width="110" height="8" rx="4" fill="var(--slate-400)" />
      <rect x="36" y="114" width="64" height="18" rx="9" fill="var(--brand-mark-accent)" opacity="0.45" />
      <circle cx="152" cy="64" r="20" fill="var(--yaseir-teal)" />
      <path d="m143 64 7 7 13-14" fill="none" stroke="white" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ImportIllustration({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <circle cx="152" cy="48" r="28" fill="var(--yaseir-yellow)" opacity="0.7" />
      <rect x="30" y="24" width="90" height="110" rx="14" fill="var(--illus-card)" stroke="var(--brand-mark-primary)" strokeWidth="4.5" />
      <line x1="48" y1="54" x2="100" y2="54" stroke="var(--brand-mark-primary)" strokeWidth="5" strokeLinecap="round" />
      <line x1="48" y1="78" x2="100" y2="78" stroke="var(--slate-400)" strokeWidth="5" strokeLinecap="round" />
      <line x1="48" y1="102" x2="82" y2="102" stroke="var(--slate-400)" strokeWidth="5" strokeLinecap="round" />
      <path d="M126 78h22m0 0-9-10m9 10-9 10" fill="none" stroke="var(--brand-mark-accent)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="96" y="116" width="80" height="62" rx="12" fill="var(--brand-mark-primary)" />
      <rect x="112" y="134" width="48" height="8" rx="4" fill="var(--brand-mark-accent)" />
      <rect x="112" y="152" width="34" height="8" rx="4" fill="white" opacity="0.8" />
    </svg>
  );
}
