export const BRAND = {
  name: "DAFQLY",
  displayNameEn: "Dafqly",
  nameAr: "دفقلي",
  tagline: "Track. Follow. Get Paid.",
  supportingLine: "Smarter Receivables. Better Cash Flow.",
  taglineAr: "تتبّع. تابع. وحصّل.",
  descriptionAr: "دفقلي — منصة إدارة المستحقات والتحصيل الذكي",
  descriptionEn: "Dafqly — Smarter Receivables. Better Cash Flow.",
  designSystem: "Quiet Ledger (DESIGN.md)",
  colors: {
    // Indigo Ledger: ink #1C2350 is identity, indigo #4338CA is the single
    // action accent (CTA/link/focus only). Teal #27C7A5 lives only in the
    // brand mark. The Yaseir scatter accents (yellow/pink/violet/coral)
    // are removed — colour means status or action only.
    navy: "#1C2350",
    primaryBlue: "#4338CA",
    teal: "#27C7A5",
    reserveTeal: "#12716B",
    canvas: "#F4F5FB",
    slate: "#535C75",
  },
  logo: {
    symbol: "/brand/logo/symbol.svg",
    markColor: "/brand/logo/mark-color.svg",
    markMono: "/brand/logo/mark-mono.svg",
    markWhite: "/brand/logo/mark-white.svg",
    lockupHorizontal: "/brand/logo/lockup-horizontal.svg",
    lockupStacked: "/brand/logo/lockup-stacked.svg",
    appIcon: "/brand/logo/app-icon.svg",
  },
  assets: {
    wordmarkHorizontalOutlined: "packages/brand/logo/wordmark-horizontal-outlined.svg",
    wordmarkHorizontalReversedOutlined: "packages/brand/logo/wordmark-horizontal-reversed-outlined.svg",
    wordmarkStackedOutlined: "packages/brand/logo/wordmark-stacked-outlined.svg",
    ogImage: "/og-image.png",
    splashDir: "/splash",
    emailHeaderPng: "packages/brand/email/email-header.png",
    emailHeaderHtml: "packages/brand/email/email-header.html",
  },
} as const;
