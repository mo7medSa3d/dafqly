/**
 * Original inline illustrations for the DAFQLY rebrand. CSS variables only
 * (no hex), aria-hidden, no text inside — text stays real HTML.
 */
const common = { fill: "none", stroke: "var(--navy-700)", strokeWidth: 6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export function EmptyInvoicesIllustration({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect x="45" y="55" width="100" height="120" rx="10" fill="var(--surface-muted)" stroke="var(--border-strong)" strokeWidth="3" />
      <rect x="60" y="35" width="100" height="120" rx="10" fill="var(--surface)" stroke="var(--navy-700)" strokeWidth="5" />
      <line x1="80" y1="70" x2="140" y2="70" {...common} strokeWidth="5" />
      <line x1="80" y1="95" x2="125" y2="95" stroke="var(--slate-400)" strokeWidth="5" strokeLinecap="round" />
      <path d="m88 128 14 14 28-30" fill="none" stroke="var(--teal-400)" strokeWidth="8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PaymentSuccessIllustration({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect x="55" y="25" width="90" height="130" rx="10" fill="var(--surface)" stroke="var(--navy-700)" strokeWidth="5" />
      <line x1="72" y1="55" x2="128" y2="55" stroke="var(--slate-400)" strokeWidth="5" strokeLinecap="round" />
      <line x1="72" y1="78" x2="128" y2="78" stroke="var(--slate-400)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="145" cy="145" r="32" fill="var(--teal-400)" />
      <path d="m130 145 11 11 22-24" fill="none" stroke="var(--navy-700)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OnboardingIllustration({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect x="25" y="35" width="150" height="110" rx="12" fill="var(--surface)" stroke="var(--navy-700)" strokeWidth="5" />
      <line x1="25" y1="62" x2="175" y2="62" stroke="var(--border-strong)" strokeWidth="3" />
      <rect x="40" y="78" width="52" height="22" rx="6" fill="var(--teal-400)" opacity="0.55" />
      <rect x="40" y="110" width="120" height="10" rx="5" fill="var(--surface-muted)" />
      <rect x="105" y="78" width="55" height="22" rx="6" fill="var(--surface-muted)" stroke="var(--border-strong)" strokeWidth="2" />
    </svg>
  );
}

export function ConnectionErrorIllustration({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <circle cx="55" cy="100" r="20" fill="var(--surface)" stroke="var(--navy-700)" strokeWidth="5" />
      <circle cx="145" cy="100" r="20" fill="var(--surface)" stroke="var(--navy-700)" strokeWidth="5" />
      <path d="M78 82c14-16 30-16 44 0" fill="none" stroke="var(--slate-400)" strokeWidth="5" strokeLinecap="round" strokeDasharray="2 10" />
      <path d="M78 122c16 18 48 18 64-2" fill="none" stroke="var(--teal-400)" strokeWidth="6" strokeLinecap="round" />
      <path d="m136 108 8 14-16 2" fill="none" stroke="var(--teal-400)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function HeroDashboardIllustration({ size = 320 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.75} viewBox="0 0 320 240" aria-hidden="true" focusable="false" className="w-full max-w-md">
      <rect x="20" y="20" width="280" height="200" rx="14" fill="var(--surface)" stroke="var(--navy-700)" strokeWidth="5" />
      <line x1="20" y1="58" x2="300" y2="58" stroke="var(--border-strong)" strokeWidth="3" />
      <circle cx="42" cy="39" r="5" fill="var(--teal-400)" />
      <rect x="40" y="78" width="110" height="52" rx="8" fill="var(--surface-muted)" />
      <rect x="170" y="78" width="110" height="52" rx="8" fill="var(--teal-400)" opacity="0.4" />
      <rect x="40" y="148" width="240" height="12" rx="6" fill="var(--surface-muted)" />
      <rect x="40" y="172" width="180" height="12" rx="6" fill="var(--surface-muted)" />
      <path d="m58 104 12 12 24-26" fill="none" stroke="var(--teal-400)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Abstract dashboard motif for the navy hero band (white/teal on transparent). */
export function HeroBandArt({ size = 300 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.72} viewBox="0 0 300 216" aria-hidden="true" focusable="false" className="w-full max-w-[300px]">
      <rect x="14" y="14" width="272" height="188" rx="16" fill="white" opacity="0.06" stroke="white" strokeOpacity="0.35" strokeWidth="2" />
      <rect x="36" y="38" width="104" height="58" rx="10" fill="white" opacity="0.1" />
      <path d="m52 74 11 11 22-24" fill="none" stroke="var(--teal-300)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="156" y="38" width="108" height="58" rx="10" fill="var(--teal-400)" opacity="0.85" />
      <rect x="172" y="58" width="58" height="9" rx="4.5" fill="var(--navy-800)" opacity="0.55" />
      <rect x="172" y="74" width="38" height="9" rx="4.5" fill="var(--navy-800)" opacity="0.35" />
      <rect x="36" y="116" width="228" height="10" rx="5" fill="white" opacity="0.22" />
      <rect x="36" y="140" width="168" height="10" rx="5" fill="white" opacity="0.14" />
      <rect x="36" y="164" width="196" height="10" rx="5" fill="white" opacity="0.14" />
      <circle cx="252" cy="169" r="13" fill="var(--teal-400)" />
      <path d="m245 169 5 5 10-11" fill="none" stroke="var(--navy-800)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Cash-flow forecast motif: rising bars with a trend path. */
export function ForecastIllustration({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <line x1="35" y1="165" x2="170" y2="165" stroke="var(--border-strong)" strokeWidth="4" strokeLinecap="round" />
      <rect x="48" y="118" width="22" height="47" rx="5" fill="var(--surface-muted)" stroke="var(--navy-700)" strokeWidth="4" />
      <rect x="88" y="94" width="22" height="71" rx="5" fill="var(--teal-400)" opacity="0.55" />
      <rect x="128" y="64" width="22" height="101" rx="5" fill="var(--teal-400)" />
      <path d="M42 96c26-22 44-30 66-38 16-6 32-14 50-26" fill="none" stroke="var(--navy-700)" strokeWidth="5" strokeLinecap="round" strokeDasharray="1 12" />
      <circle cx="158" cy="32" r="7" fill="var(--surface)" stroke="var(--navy-700)" strokeWidth="4" />
    </svg>
  );
}

/** Cheque motif: a cheque sheet with bank line and confirmation seal. */
export function ChequesIllustration({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect x="22" y="52" width="156" height="96" rx="10" fill="var(--surface)" stroke="var(--navy-700)" strokeWidth="5" />
      <line x1="40" y1="84" x2="118" y2="84" stroke="var(--slate-400)" strokeWidth="5" strokeLinecap="round" />
      <line x1="40" y1="108" x2="96" y2="108" stroke="var(--slate-400)" strokeWidth="5" strokeLinecap="round" />
      <rect x="40" y="126" width="52" height="10" rx="5" fill="var(--surface-muted)" />
      <path d="M126 128c8-12 18-18 30-20" fill="none" stroke="var(--teal-500)" strokeWidth="5" strokeLinecap="round" />
      <circle cx="152" cy="62" r="17" fill="var(--teal-400)" />
      <path d="m143 62 7 7 13-14" fill="none" stroke="var(--navy-800)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Import motif: a sheet flowing into an organized tray/dashboard. */
export function ImportIllustration({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect x="34" y="22" width="86" height="104" rx="9" fill="var(--surface)" stroke="var(--navy-700)" strokeWidth="5" />
      <line x1="52" y1="52" x2="102" y2="52" stroke="var(--slate-400)" strokeWidth="5" strokeLinecap="round" />
      <line x1="52" y1="76" x2="102" y2="76" stroke="var(--slate-400)" strokeWidth="5" strokeLinecap="round" />
      <line x1="52" y1="100" x2="84" y2="100" stroke="var(--slate-400)" strokeWidth="5" strokeLinecap="round" />
      <path d="M126 74h22m0 0-9-10m9 10-9 10" fill="none" stroke="var(--teal-500)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="98" y="118" width="76" height="60" rx="9" fill="var(--surface-muted)" stroke="var(--navy-700)" strokeWidth="4" />
      <rect x="112" y="134" width="48" height="8" rx="4" fill="var(--teal-400)" opacity="0.6" />
      <rect x="112" y="152" width="34" height="8" rx="4" fill="var(--slate-400)" opacity="0.6" />
    </svg>
  );
}
