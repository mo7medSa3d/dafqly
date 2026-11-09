export const BRAND = {
  name: "DAFQLY",
  nameAr: "DAFQLY",
  tagline: "Track. Follow. Get Paid.",
  supportingLine: "Smarter Receivables. Better Cash Flow.",
  taglineAr: "تتبّع. تابع. وحصّل.",
  descriptionAr: "منصة إدارة المستحقات والتحصيل",
  descriptionEn: "Smarter Receivables. Better Cash Flow.",
  colors: { navy: "#14243A", teal: "#27C7A5", canvas: "#F6F8F7", slate: "#697989" },
  logo: {
    symbol: "/brand/logo/symbol.svg",
    markColor: "/brand/logo/mark-color.svg",
    markMono: "/brand/logo/mark-mono.svg",
    markWhite: "/brand/logo/mark-white.svg",
    lockupHorizontal: "/brand/logo/lockup-horizontal.svg",
    lockupStacked: "/brand/logo/lockup-stacked.svg",
    appIcon: "/brand/logo/app-icon.svg",
  },
  /** v0.9.0 completed asset set (paths are repo-relative unless they start with /). */
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
