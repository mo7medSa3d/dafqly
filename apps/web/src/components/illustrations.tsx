/**
 * Theme-adaptive 2026 Apple/Vercel-grade SVG illustrations.
 * Every fill & stroke uses CSS variables (--card, --muted, --border,
 * --foreground, --primary, --primary-foreground, --chart-1, --chart-2,
 * --status-paid-fg) so Light and Dark modes render with crisp contrast.
 */

export function HeroDashboardIllustration({ size = 480 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.625)} viewBox="0 0 800 500" fill="none" aria-hidden="true" focusable="false" className="h-auto w-full max-w-2xl">
      <rect width="800" height="500" rx="28" fill="var(--illus-stage)" />
      <circle cx="670" cy="95" r="78" fill="var(--chart-2)" opacity="0.14" />
      <circle cx="120" cy="410" r="95" fill="var(--chart-1)" opacity="0.14" />
      <g>
        <rect x="95" y="78" width="610" height="344" rx="20" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
        <path d="M95 98Q95 78 115 78H685Q705 78 705 98V124H95Z" fill="var(--primary)" />
        <circle cx="122" cy="101" r="5.5" fill="var(--primary-foreground)" opacity="0.55" />
        <circle cx="142" cy="101" r="5.5" fill="var(--primary-foreground)" opacity="0.35" />
        <circle cx="162" cy="101" r="5.5" fill="var(--chart-1)" />
        <path d="M95 124H224V422H115Q95 422 95 402Z" fill="var(--muted)" />
        <rect x="115" y="151" width="88" height="20" rx="7" fill="var(--primary)" opacity="0.85" />
        <rect x="115" y="197" width="72" height="9" rx="4" fill="var(--muted-foreground)" opacity="0.4" />
        <rect x="115" y="232" width="58" height="9" rx="4" fill="var(--muted-foreground)" opacity="0.3" />
        <rect x="115" y="267" width="75" height="9" rx="4" fill="var(--muted-foreground)" opacity="0.3" />
        <rect x="248" y="149" width="130" height="74" rx="12" fill="var(--muted)" />
        <rect x="392" y="149" width="130" height="74" rx="12" fill="var(--muted)" />
        <rect x="536" y="149" width="142" height="74" rx="12" fill="var(--muted)" />
        <rect x="264" y="166" width="60" height="7" rx="3" fill="var(--muted-foreground)" opacity="0.45" />
        <rect x="264" y="187" width="42" height="18" rx="4" fill="var(--chart-2)" />
        <rect x="410" y="166" width="60" height="7" rx="3" fill="var(--muted-foreground)" opacity="0.45" />
        <rect x="410" y="187" width="42" height="18" rx="4" fill="var(--chart-1)" />
        <rect x="554" y="166" width="60" height="7" rx="3" fill="var(--muted-foreground)" opacity="0.45" />
        <rect x="554" y="187" width="42" height="18" rx="4" fill="var(--foreground)" />
        <rect x="248" y="244" width="268" height="151" rx="12" fill="var(--muted)" />
        <path d="M267 371H493" stroke="var(--border)" strokeWidth="2" />
        <rect x="272" y="327" width="27" height="44" rx="5" fill="var(--chart-3)" />
        <rect x="316" y="298" width="27" height="73" rx="5" fill="var(--chart-3)" />
        <rect x="360" y="276" width="27" height="95" rx="5" fill="var(--chart-2)" />
        <rect x="404" y="310" width="27" height="61" rx="5" fill="var(--chart-1)" />
        <rect x="448" y="260" width="27" height="111" rx="5" fill="var(--foreground)" />
        <rect x="536" y="244" width="142" height="151" rx="12" fill="var(--muted)" />
        <circle cx="607" cy="316" r="42" fill="none" stroke="var(--border)" strokeWidth="14" />
        <path d="M607 274A42 42 0 1 1 565 316" fill="none" stroke="var(--chart-2)" strokeWidth="14" strokeLinecap="round" />
      </g>
    </svg>
  );
}

export function ReceivablesIllustration({ size = 260 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.625)} viewBox="0 0 800 500" fill="none" aria-hidden="true" focusable="false" className="h-auto max-w-full">
      <rect width="800" height="500" rx="28" fill="var(--illus-stage)" />
      <circle cx="120" cy="180" r="88" fill="var(--chart-2)" opacity="0.14" />
      <circle cx="670" cy="370" r="105" fill="var(--chart-1)" opacity="0.14" />
      <g>
        <rect x="210" y="80" width="324" height="360" rx="24" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
        <rect x="245" y="118" width="125" height="12" rx="6" fill="var(--foreground)" />
        <rect x="245" y="146" width="82" height="8" rx="4" fill="var(--muted-foreground)" opacity="0.5" />
        <line x1="245" y1="176" x2="499" y2="176" stroke="var(--border)" strokeWidth="2" />
        <rect x="245" y="200" width="142" height="9" rx="4.5" fill="var(--muted-foreground)" opacity="0.45" />
        <rect x="415" y="200" width="70" height="9" rx="4.5" fill="var(--chart-2)" opacity="0.7" />
        <rect x="245" y="230" width="110" height="9" rx="4.5" fill="var(--muted-foreground)" opacity="0.45" />
        <rect x="415" y="230" width="70" height="9" rx="4.5" fill="var(--chart-1)" opacity="0.7" />
        <rect x="245" y="260" width="135" height="9" rx="4.5" fill="var(--muted-foreground)" opacity="0.45" />
        <rect x="415" y="260" width="70" height="9" rx="4.5" fill="var(--foreground)" opacity="0.5" />
        <rect x="243" y="306" width="258" height="64" rx="12" fill="var(--muted)" />
        <rect x="263" y="328" width="72" height="7" rx="3.5" fill="var(--muted-foreground)" opacity="0.5" />
        <rect x="263" y="343" width="150" height="11" rx="5.5" fill="var(--foreground)" />
      </g>
      <rect x="437" y="210" width="210" height="124" rx="18" fill="var(--primary)" />
      <circle cx="475" cy="242" r="14" fill="var(--chart-1)" />
      <rect x="475" y="270" width="86" height="8" rx="4" fill="var(--primary-foreground)" />
      <rect x="475" y="286" width="50" height="5" rx="2.5" fill="var(--primary-foreground)" opacity="0.6" />
      <circle cx="617" cy="158" r="44" fill="var(--status-paid-fg)" />
      <path d="M597 158L611 172L637 144" stroke="var(--primary-foreground)" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SecuritySignInIllustration({ size = 380 }: { size?: number }) {
  return (
    <svg width={size} height={Math.round(size * 0.625)} viewBox="0 0 800 500" fill="none" aria-hidden="true" focusable="false" className="h-auto w-full max-w-lg">
      <rect width="800" height="500" rx="28" fill="var(--illus-stage)" />
      <circle cx="650" cy="120" r="105" fill="var(--chart-2)" opacity="0.14" />
      <circle cx="170" cy="400" r="88" fill="var(--chart-1)" opacity="0.14" />
      <rect x="145" y="130" width="510" height="250" rx="20" fill="var(--card)" stroke="var(--border)" strokeWidth="2" />
      <rect x="175" y="160" width="84" height="68" rx="12" fill="var(--muted)" />
      <circle cx="217" cy="181" r="15" fill="var(--foreground)" />
      <path d="M191 214C191 204.6 198.6 197 208 197H226C235.4 197 243 204.6 243 214V217H191V214Z" fill="var(--foreground)" />
      <rect x="283" y="167" width="183" height="10" rx="5" fill="var(--muted-foreground)" opacity="0.5" />
      <rect x="283" y="191" width="120" height="9" rx="4.5" fill="var(--chart-2)" opacity="0.7" />
      <rect x="175" y="256" width="300" height="36" rx="8" fill="var(--muted)" stroke="var(--border)" strokeWidth="1.5" />
      <rect x="175" y="308" width="300" height="36" rx="18" fill="var(--primary)" />
      <rect x="279" y="323" width="92" height="6" rx="3" fill="var(--primary-foreground)" />
      <path d="M534 194V243H610V194C610 173.013 592.987 156 572 156C551.013 156 534 173.013 534 194Z" fill="none" stroke="var(--foreground)" strokeWidth="13" strokeLinecap="round" />
      <rect x="520" y="243" width="105" height="76" rx="16" fill="var(--chart-2)" />
      <circle cx="572.5" cy="273.5" r="7.5" fill="var(--primary-foreground)" />
      <path d="M572.5 281V296" stroke="var(--primary-foreground)" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function SecurityLockBadge({ size = 44 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 140 160" fill="none" aria-hidden="true" focusable="false" className="shrink-0">
      <path d="M36 56V96H104V56C104 37.222 88.778 22 70 22C51.222 22 36 37.222 36 56Z" fill="none" stroke="currentColor" strokeWidth="12" strokeLinecap="round" />
      <rect x="22" y="76" width="96" height="68" rx="16" fill="var(--chart-2)" />
      <circle cx="70" cy="103" r="7.5" fill="oklch(0.99 0 0)" />
      <path d="M70 110V124" stroke="oklch(0.99 0 0)" strokeWidth="4.5" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyInvoicesIllustration({ size = 160 }: { size?: number }) {
  return <ReceivablesIllustration size={size} />;
}

export function PaymentSuccessIllustration({ size = 150 }: { size?: number }) {
  return <ReceivablesIllustration size={size} />;
}

export function OnboardingIllustration({ size = 180 }: { size?: number }) {
  return <HeroDashboardIllustration size={size} />;
}

export function ConnectionErrorIllustration({ size = 130 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect x="20" y="20" width="160" height="160" rx="28" fill="var(--illus-stage)" />
      <circle cx="62" cy="100" r="22" fill="var(--card)" stroke="var(--foreground)" strokeWidth="5" />
      <circle cx="138" cy="100" r="22" fill="var(--card)" stroke="var(--foreground)" strokeWidth="5" />
      <path d="M84 82c12-14 20-14 32 0" fill="none" stroke="var(--muted-foreground)" strokeWidth="5" strokeLinecap="round" strokeDasharray="3 8" />
      <path d="M84 120c14 16 38 16 52-2" fill="none" stroke="var(--chart-2)" strokeWidth="6" strokeLinecap="round" />
      <circle cx="100" cy="58" r="10" fill="var(--chart-1)" />
    </svg>
  );
}

export function HeroBandArt({ size = 320 }: { size?: number }) {
  return <HeroDashboardIllustration size={size} />;
}

export function ForecastIllustration({ size = 130 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect x="16" y="20" width="168" height="160" rx="22" fill="var(--illus-stage)" />
      <circle cx="154" cy="48" r="20" fill="var(--chart-1)" opacity="0.45" />
      <line x1="35" y1="158" x2="168" y2="158" stroke="var(--border)" strokeWidth="4" strokeLinecap="round" />
      <rect x="48" y="114" width="24" height="44" rx="6" fill="var(--chart-3)" />
      <rect x="88" y="88" width="24" height="70" rx="6" fill="var(--chart-2)" />
      <rect x="128" y="58" width="24" height="100" rx="6" fill="var(--foreground)" />
      <path d="M44 96c26-20 46-28 68-36 16-6 30-12 46-22" fill="none" stroke="var(--chart-1)" strokeWidth="4" strokeLinecap="round" strokeDasharray="2 9" />
    </svg>
  );
}

export function ChequesIllustration({ size = 130 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <rect x="18" y="44" width="164" height="112" rx="16" fill="var(--card)" stroke="var(--border-strong)" strokeWidth="3.5" />
      <rect x="36" y="68" width="84" height="10" rx="5" fill="var(--foreground)" />
      <rect x="36" y="92" width="110" height="8" rx="4" fill="var(--muted-foreground)" opacity="0.5" />
      <rect x="36" y="114" width="64" height="18" rx="9" fill="var(--chart-2)" opacity="0.25" />
      <circle cx="152" cy="64" r="20" fill="var(--status-paid-fg)" />
      <path d="m143 64 7 7 13-14" fill="none" stroke="var(--primary-foreground)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ImportIllustration({ size = 120 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
      <circle cx="152" cy="48" r="28" fill="var(--chart-2)" opacity="0.22" />
      <rect x="30" y="24" width="90" height="110" rx="14" fill="var(--card)" stroke="var(--foreground)" strokeWidth="4" />
      <line x1="48" y1="54" x2="100" y2="54" stroke="var(--foreground)" strokeWidth="5" strokeLinecap="round" />
      <line x1="48" y1="78" x2="100" y2="78" stroke="var(--muted-foreground)" strokeOpacity="0.55" strokeWidth="5" strokeLinecap="round" />
      <line x1="48" y1="102" x2="82" y2="102" stroke="var(--muted-foreground)" strokeOpacity="0.55" strokeWidth="5" strokeLinecap="round" />
      <path d="M126 78h22m0 0-9-10m9 10-9 10" fill="none" stroke="var(--chart-2)" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="96" y="116" width="80" height="62" rx="12" fill="var(--primary)" />
      <rect x="112" y="134" width="48" height="8" rx="4" fill="var(--primary-foreground)" opacity="0.8" />
      <rect x="112" y="152" width="34" height="8" rx="4" fill="var(--chart-1)" />
    </svg>
  );
}

export function ReminderScheduleIllustration({ size = 140 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 200 200" fill="none" aria-hidden="true" focusable="false" className="shrink-0">
      <rect x="16" y="20" width="168" height="160" rx="24" fill="var(--illus-stage)" />
      <circle cx="154" cy="48" r="24" fill="var(--chart-2)" opacity="0.18" />
      <circle cx="46" cy="154" r="28" fill="var(--chart-1)" opacity="0.18" />
      <rect x="34" y="42" width="132" height="116" rx="16" fill="var(--card)" stroke="var(--border-strong)" strokeWidth="3" />
      <path d="M34 58C34 49.163 41.163 42 50 42H150C158.837 42 166 49.163 166 58V72H34V58Z" fill="var(--primary)" />
      <circle cx="54" cy="57" r="4.5" fill="var(--primary-foreground)" opacity="0.6" />
      <circle cx="70" cy="57" r="4.5" fill="var(--chart-1)" />
      <rect x="50" y="88" width="44" height="10" rx="5" fill="var(--foreground)" />
      <rect x="50" y="108" width="76" height="8" rx="4" fill="var(--muted-foreground)" opacity="0.5" />
      <rect x="50" y="126" width="56" height="16" rx="8" fill="var(--chart-2)" opacity="0.25" />
      <circle cx="142" cy="122" r="22" fill="var(--chart-2)" />
      <path d="M142 111v12l8 5" stroke="var(--primary-foreground)" strokeWidth="3.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
