"use client";

import * as React from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ThemeToggle } from "./ThemeToggle";
import { LocaleToggle } from "./LocaleToggle";

/* ------------------------------------------------------------------ types */

type NavLink = { label: string; target: string };
type Palette = {
  name: string;
  accent: string;
  frame: string;
  colors: string[];
};
type ModuleItem = {
  code: string;
  title: string;
  summary: string;
  detail: string;
  status: "open" | "ongoing" | "archived";
  progress: number;
  goal: string;
  cta: string;
};
type CycleEvent = {
  offsetDays: number;
  time: string;
  title: string;
  place: string;
  kind: string;
  target: string;
  seats: number;
  going: number;
};
type Tier = {
  name: string;
  price: string;
  period?: string;
  blurb: string;
  perks: string[];
  featured?: boolean;
};

/* ------------------------------------------------------------------ logic */

function clamp(v: number, a: number, b: number): number {
  return Math.min(b, Math.max(a, v));
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function isEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.trim());
}

function easeOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - Math.pow(1 - c, 3);
}

function lines(s: string): string[] {
  return s.split(/\n|\\n/).filter((l) => l.length > 0);
}

type Bubble = { x: number; y: number; r: number; c: number; ph: number; amp: number; sp: number };

function buildBubbles(seed: number, w: number, h: number, nColors: number, density = 1, scale = 1): Bubble[] {
  const rnd = mulberry32(seed);
  const unit = Math.max(6, Math.min(w, h) * 0.12 * scale);
  const n = Math.round(clamp(((w * h) / (unit * unit * 1.25)) * density, 12, 1400));
  const out: Bubble[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.round(unit * (0.22 + 1.3 * Math.pow(rnd(), 2.3)) * 100) / 100;
    out.push({
      x: Math.round((rnd() * (w + r) - r / 2) * 100) / 100,
      y: Math.round((rnd() * (h + r) - r / 2) * 100) / 100,
      r,
      c: 1 + Math.floor(rnd() * Math.max(1, nColors - 1)),
      ph: rnd() * Math.PI * 2,
      amp: 1 + rnd() * 3.5,
      sp: 0.25 + rnd() * 0.6,
    });
  }
  return out.sort((a, b) => b.r - a.r);
}

function bubbleCss(seed: number, colors: string[], n = 34, maxR = 46): string {
  const rnd = mulberry32(seed);
  const layers: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = Math.round(6 + (maxR - 6) * Math.pow(rnd(), 1.8));
    const x = Math.round(rnd() * 100);
    const y = Math.round(rnd() * 100);
    const c = colors[1 + Math.floor(rnd() * Math.max(1, colors.length - 1))] ?? colors[0];
    layers.push(`radial-gradient(circle at ${x}% ${y}%, ${c} 0 ${r}px, transparent ${r + 0.6}px)`);
  }
  return `${layers.reverse().join(", ")}, ${colors[0] ?? "oklch(0.14 0 0)"}`;
}

const CYCLE_DAYS = 29.530588853;
const REF_MS = Date.UTC(2000, 0, 6, 18, 14);

function cyclePhase(at: Date | number) {
  const ms = typeof at === "number" ? at : at.getTime();
  const days = (ms - REF_MS) / 86400000;
  const age = ((days % CYCLE_DAYS) + CYCLE_DAYS) % CYCLE_DAYS;
  const fraction = age / CYCLE_DAYS;
  const illumination = (1 - Math.cos(2 * Math.PI * fraction)) / 2;
  return {
    age,
    fraction,
    illumination,
    waxing: fraction < 0.5,
    daysToClose: (((0.5 - fraction) % 1) + 1) % 1 * CYCLE_DAYS,
    daysToReset: ((1 - fraction) % 1) * CYCLE_DAYS,
  };
}

function phasePath(fraction: number, r: number): string {
  const f = ((fraction % 1) + 1) % 1;
  const waxing = f < 0.5;
  const c = Math.cos(2 * Math.PI * f);
  const rx = Math.abs(c) * r;
  const limb = waxing ? 1 : 0;
  const term = waxing ? (c > 0 ? 0 : 1) : c < 0 ? 0 : 1;
  const R = r.toFixed(2);
  return `M0,-${R}A${R},${R} 0 0 ${limb} 0,${R}A${rx.toFixed(2)},${R} 0 0 ${term} 0,-${R}Z`;
}

function splitStat(s: string): { prefix: string; value: number; decimals: number; suffix: string } | null {
  const m = s.match(/^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/);
  if (!m) return null;
  const num = m[2].replace(/,/g, "");
  const dot = num.indexOf(".");
  return { prefix: m[1], value: parseFloat(num), decimals: dot < 0 ? 0 : num.length - dot - 1, suffix: m[3] };
}

function formatStat(s: string, t: number): string {
  const p = splitStat(s);
  if (!p) return s;
  const v = p.value * easeOutCubic(t);
  const grouped = p.value >= 1000 && p.decimals === 0;
  const body = grouped ? Math.round(v).toLocaleString("en-US") : v.toFixed(p.decimals);
  return p.prefix + body + p.suffix;
}

function unwrapAngle(prev: number, next: number): number {
  let d = (next - prev) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return prev + d;
}

function workspaceNumber(name: string, email: string): string {
  return "#" + String(100 + (hashStr(name.trim().toLowerCase() + "|" + email.trim().toLowerCase()) % 9900)).padStart(4, "0");
}

/* ---------------------------------------------------------------- palettes */
/* Uses oklch() exclusively so no hardcoded hex values exist in app code. */

const PALETTES: Palette[] = [
  {
    name: "Monochrome",
    accent: "oklch(0.14 0 0)",
    frame: "oklch(0.86 0 0)",
    colors: [
      "oklch(0.14 0 0)",
      "oklch(0.24 0 0)",
      "oklch(0.38 0 0)",
      "oklch(0.55 0.22 264.53)",
      "oklch(0.81 0.17 75.35)",
      "oklch(0.72 0 0)",
      "oklch(0.92 0 0)",
      "oklch(0.44 0 0)",
    ],
  },
  {
    name: "Cobalt",
    accent: "oklch(0.55 0.22 264.53)",
    frame: "oklch(0.76 0.10 264.53)",
    colors: [
      "oklch(0.45 0.22 264.53)",
      "oklch(0.55 0.22 264.53)",
      "oklch(0.65 0.19 258)",
      "oklch(0.78 0.14 230)",
      "oklch(0.88 0.08 250)",
      "oklch(0.28 0.16 264)",
      "oklch(0.81 0.17 75.35)",
    ],
  },
  {
    name: "Amber",
    accent: "oklch(0.65 0.18 65)",
    frame: "oklch(0.88 0.08 75.35)",
    colors: [
      "oklch(0.58 0.17 55)",
      "oklch(0.81 0.17 75.35)",
      "oklch(0.72 0.19 65)",
      "oklch(0.88 0.14 85)",
      "oklch(0.46 0.15 40)",
      "oklch(0.95 0.06 85)",
      "oklch(0.22 0 0)",
    ],
  },
  {
    name: "Graphite",
    accent: "oklch(0.32 0 0)",
    frame: "oklch(0.80 0 0)",
    colors: [
      "oklch(0.22 0 0)",
      "oklch(0.36 0 0)",
      "oklch(0.52 0 0)",
      "oklch(0.68 0 0)",
      "oklch(0.84 0 0)",
      "oklch(0.94 0 0)",
      "oklch(0.12 0 0)",
    ],
  },
];

/* -------------------------------------------------------------------- css */

const DF_CSS = `
.df-root{--df-accent:var(--primary);--df-frame:var(--border);--df-paper:var(--background);--df-ink:var(--foreground);--df-soft:var(--muted-foreground);--df-muted:var(--text-subtle);--df-card:var(--card);--df-moon:var(--muted);--df-blue:var(--df-accent);--df-line:var(--border);--df-line-strong:var(--border-strong);--df-display:var(--font-brand);--df-body:var(--font-brand);--df-mono:var(--font-mono);position:relative;width:100%;box-sizing:border-box;background:var(--df-paper);color:var(--df-ink);font-family:var(--df-body);font-size:15px;line-height:1.5;-webkit-font-smoothing:antialiased;border:clamp(6px,1.1vw,12px) solid var(--df-frame);transition:background-color .4s ease,color .4s ease,border-color .4s ease;overflow:clip}
.dark .df-root,:root[data-theme="dark"] .df-root{--df-blue:var(--primary);border-color:var(--border)}
.df-root :where(*){box-sizing:border-box}
.df-shell{width:100%;container-type:inline-size;position:relative}
.df-in{width:100%;max-width:1240px;margin:0 auto;padding:0 clamp(16px,4cqi,48px)}

.df-disp{font-family:var(--df-display);font-weight:800;letter-spacing:-.02em;line-height:.88}
.df-mono{font-family:var(--df-mono);font-size:11px;letter-spacing:.06em;text-transform:uppercase}
.df-label{font-family:var(--df-display);font-weight:800;font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--df-blue)}
[dir="rtl"] .df-label,[dir="rtl"] .df-mono{letter-spacing:0}
.df-echo{display:inline-block;white-space:nowrap}
.df-title{display:flex;flex-direction:column;font-family:var(--df-display);font-weight:800;letter-spacing:-.01em;line-height:.95}
.df-title>span:last-child{padding-bottom:.32em}

/* nav */
.df-nav{position:sticky;top:0;z-index:40;background:color-mix(in srgb,var(--df-paper) 86%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-bottom:1px solid var(--df-line)}
.df-nav .df-in{display:flex;align-items:center;gap:12px;height:64px}
.df-brand{display:inline-flex;align-items:center;gap:10px;font-family:var(--df-display);font-weight:800;font-size:17px;white-space:nowrap}
.df-issue{display:none;padding:3px 9px;border:1.5px solid currentColor;border-radius:999px;font-family:var(--df-mono);font-weight:700;font-size:11px;color:var(--df-ink)}
.df-links{display:none;align-items:center;gap:2px;margin:0 auto}
.df-link{position:relative;padding:8px 12px;font-weight:700;font-size:13px;color:var(--df-soft);transition:color .2s}
.df-link::after{content:"";position:absolute;inset-inline:12px;bottom:3px;height:2px;border-radius:2px;background:var(--df-ink);transform:scaleX(0);transform-origin:start;transition:transform .35s cubic-bezier(.2,.8,.2,1)}
.df-link:hover,.df-link[aria-current="true"]{color:var(--df-ink)}
.df-link[aria-current="true"]::after,.df-link:hover::after{transform:scaleX(1)}
.df-nav-end{display:flex;align-items:center;gap:8px;margin-inline-start:auto}
.df-swatches{display:none;align-items:center;gap:5px;padding:4px;border:1px solid var(--df-line);border-radius:999px}
.df-sw{position:relative;width:18px;height:18px;border-radius:999px;transition:transform .25s cubic-bezier(.2,.8,.2,1)}
.df-sw:hover{transform:scale(1.15)}
.df-sw[aria-checked="true"]{box-shadow:0 0 0 2px var(--df-paper),0 0 0 3.5px var(--df-ink)}
.df-icon{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:999px;color:var(--df-soft);border:1px solid var(--df-line);transition:color .2s,border-color .2s}
.df-icon:hover{color:var(--df-ink);border-color:var(--df-ink)}
.df-menu-btn{display:inline-grid}
.df-mobile{position:absolute;left:0;right:0;top:100%;display:grid;gap:4px;padding:12px clamp(16px,4cqi,48px) 18px;background:var(--df-paper);border-bottom:1px solid var(--df-line);animation:df-drop .3s cubic-bezier(.2,.8,.2,1) both}
.df-mobile .df-link{padding:10px 0;font-size:16px}
.df-mobile .df-swatches{display:inline-flex;justify-self:start;margin-top:8px}
@container (min-width:900px){.df-links{display:flex}.df-menu-btn{display:none}.df-mobile{display:none}.df-nav-end{margin-inline-start:0}.df-issue{display:inline-block}.df-nav-end .df-swatches{display:inline-flex}}

/* buttons */
.df-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:12px 20px;border-radius:999px;font-weight:800;font-size:13px;line-height:1;white-space:nowrap;transition:background-color .2s,color .2s,box-shadow .25s,transform .25s cubic-bezier(.2,.8,.2,1)}
.df-btn-solid{background:var(--primary);color:var(--primary-foreground);box-shadow:0 10px 24px -14px var(--foreground)}
.df-btn-solid:hover{transform:translateY(-2px)}
.df-btn-line{color:var(--df-ink);box-shadow:inset 0 0 0 1.5px var(--df-ink)}
.df-btn-line:hover{background:var(--df-ink);color:var(--df-paper)}
.df-btn-ink{background:var(--df-ink);color:var(--df-paper)}
.df-btn-ink:hover{transform:translateY(-2px)}
.df-btn:active{transform:scale(.97)}
.df-btn[disabled]{opacity:.55;cursor:default;transform:none}
.df-nav .df-btn{padding:10px 16px;font-size:12px}

/* bubbles */
.df-bub{position:absolute;inset:0}
.df-bub canvas{position:absolute;left:0;top:0;width:100%;height:100%}

/* hero */
.df-hero{position:relative;display:flex;flex-direction:column;justify-content:center;min-height:calc(100svh - 76px);padding:clamp(14px,2.4cqi,30px) 0 clamp(24px,4cqi,48px);scroll-margin-top:64px;overflow:hidden}
.df-orbits{position:absolute;inset:0;pointer-events:none;color:var(--df-line-strong);opacity:.55}
.df-orbits svg{position:absolute}
.df-orbit-spin{transform-box:view-box;transform-origin:50% 50%;animation:df-spin 60s linear infinite}
.df-orbit-spin-r{animation-duration:90s;animation-direction:reverse}
.df-wm{position:relative;height:clamp(190px,36cqi,460px);margin:0 calc(-1 * clamp(4px,1cqi,14px));cursor:crosshair;touch-action:pan-y}
.df-hero-mark{position:absolute;inset-inline-end:clamp(16px,4cqi,56px);top:clamp(4px,1.4cqi,20px);display:flex;flex-direction:column;align-items:flex-end;gap:clamp(6px,1cqi,12px);pointer-events:none;z-index:2}
.df-hero-mark .df-logo{pointer-events:auto;color:var(--df-ink);width:clamp(64px,12cqi,150px);height:auto}
.df-hero-title{font-size:clamp(22px,4.2cqi,54px);color:var(--df-ink);text-align:start}
.df-hero-title>span{background:var(--df-paper);padding:0 .12em;box-decoration-break:clone;-webkit-box-decoration-break:clone}
.df-hero-row{position:relative;display:grid;gap:clamp(18px,3cqi,32px);align-items:end;margin-top:clamp(-44px,-3.5cqi,-6px);z-index:3}
.df-issue-big{font-family:var(--df-mono);font-weight:800;font-size:clamp(46px,9.5cqi,130px);line-height:.85;letter-spacing:-.04em;color:var(--df-ink);background:var(--df-paper);justify-self:start;padding:.06em .12em 0 0}
.df-hero-copy{display:flex;flex-direction:column;gap:16px;max-width:520px}
.df-hero-copy p{font-size:clamp(14px,1.4cqi,16.5px);color:var(--df-soft);line-height:1.65}
.df-ctas{display:flex;flex-wrap:wrap;gap:10px}
.df-credit{display:flex;align-items:center;gap:12px;padding-top:10px;border-top:1.5px solid var(--df-ink);font-family:var(--df-mono);font-weight:700;font-size:11px}
.df-hint{display:inline-flex;align-items:center;gap:8px;color:var(--df-muted)}
.df-hint b{color:var(--df-ink);font-weight:800}
.df-pop-dot{width:7px;height:7px;border-radius:99px;background:var(--chart-2);animation:df-blink 1.6s ease-in-out infinite}
@container (min-width:760px){.df-hero-row{grid-template-columns:auto 1fr;column-gap:clamp(24px,5cqi,80px)}.df-hero-copy{justify-self:end}}

/* asterisk & logo */
.df-ast{display:inline-grid;place-items:center;color:var(--df-ink);transition:transform .8s cubic-bezier(.2,.8,.2,1)}
.df-ast:hover{transform:rotate(60deg) scale(1.15)}
.df-logo{overflow:visible}
.df-logo-spin{transform-box:view-box;transform-origin:50% 50%;transition:transform .9s cubic-bezier(.2,.8,.2,1)}
.df-brand:hover .df-logo-spin{transform:rotate(-360deg)}

/* band */
.df-band{position:relative;height:clamp(190px,28cqi,340px);color:var(--primary-foreground);overflow:hidden}
.df-band-title{position:absolute;inset-inline-start:clamp(16px,3cqi,40px);top:50%;transform:translateY(-54%);font-size:clamp(22px,4.4cqi,56px);z-index:1;pointer-events:none;color:oklch(0.99 0 0);text-shadow:0 2px 18px oklch(0 0 0 / 0.25)}
.df-band .df-ast{position:absolute;inset-inline-start:clamp(16px,3cqi,40px);bottom:clamp(14px,2.6cqi,30px);color:oklch(0.99 0 0);z-index:1}

/* sections */
.df-sec{position:relative;scroll-margin-top:64px}
.df-pad{padding:clamp(48px,8cqi,100px) 0}
.df-reveal{opacity:0;transform:translateY(22px);transition:opacity .85s cubic-bezier(.2,.7,.2,1),transform .85s cubic-bezier(.2,.7,.2,1)}
.df-reveal[data-in="true"]{opacity:1;transform:none}
.df-kicker{display:flex;flex-direction:column;align-items:center;gap:14px;padding:clamp(18px,3cqi,30px) 0 clamp(26px,4cqi,44px)}
.df-meta{display:flex;flex-wrap:wrap;justify-content:space-between;gap:8px 20px;padding:10px 0;border-top:1px solid var(--df-line-strong)}
.df-h2{font-family:var(--df-display);font-weight:800;font-size:clamp(28px,4.6cqi,56px);line-height:1.05;letter-spacing:-.02em}
[dir="rtl"] .df-h2{letter-spacing:0;line-height:1.18}
.df-lede{font-size:clamp(15px,1.5cqi,17px);color:var(--df-soft);line-height:1.7;max-width:56ch}
.df-mission{display:grid;gap:clamp(28px,5cqi,64px);padding-top:clamp(32px,5cqi,64px)}
.df-stats{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0;border-top:1.5px solid var(--df-ink)}
.df-stat{padding:18px 4px 18px 0;border-bottom:1px solid var(--df-line-strong)}
.df-stat dt{font-family:var(--df-mono);font-weight:800;font-size:clamp(32px,4.4cqi,54px);line-height:1;letter-spacing:-.03em;color:var(--df-ink);font-variant-numeric:tabular-nums}
.df-stat dd{margin-top:6px}
@container (min-width:860px){.df-mission{grid-template-columns:1.1fr 1fr;align-items:start}}

/* ribbons */
.df-stage{position:relative;height:clamp(400px,64cqi,720px);overflow:hidden;margin-top:clamp(20px,3cqi,40px);--mx:0;--my:0}
.df-stage-type{position:absolute;inset-inline-start:clamp(8px,2cqi,24px);top:12%;font-size:clamp(40px,12cqi,170px);color:var(--df-ink);line-height:.88;letter-spacing:-.03em;pointer-events:none;opacity:.9}
.df-stage-type sup{position:relative;top:-.85em;margin-inline-start:.06em;font-size:.4em;color:var(--chart-2);vertical-align:baseline}
.df-rib{position:absolute;left:var(--x);top:var(--y);width:var(--w);height:clamp(48px,8cqi,100px);transform:translate(-50%,-50%) translate(calc(var(--mx) * var(--k) * 1px),calc(var(--my) * var(--k) * 1px)) rotate(var(--r));transition:transform .7s cubic-bezier(.2,.8,.2,1),box-shadow .4s;overflow:hidden;box-shadow:0 18px 40px -26px oklch(0 0 0 / 0.5)}
.df-rib:hover{box-shadow:0 26px 60px -24px oklch(0 0 0 / 0.65);z-index:4}
.df-rib-ink{background:var(--df-ink);color:var(--df-paper);display:flex;align-items:center}
.df-marq{display:flex;width:max-content;animation:df-marq var(--d,26s) linear infinite}
.df-rib:hover .df-marq{animation-play-state:paused}
.df-marq-r{animation-direction:reverse}
.df-marq-item{display:inline-flex;align-items:center;gap:clamp(10px,1.6cqi,22px);padding-right:clamp(16px,2.6cqi,36px);font-weight:800;font-size:clamp(17px,2.8cqi,38px);white-space:nowrap}
.df-stage-foot{position:absolute;inset-inline:clamp(16px,3cqi,40px);bottom:clamp(16px,3cqi,36px);display:grid;gap:16px;align-items:end;z-index:5;pointer-events:none}
.df-stage-foot>*{pointer-events:auto}
.df-stage-body{max-width:44ch;font-weight:700;font-size:clamp(12px,1.2cqi,14px);line-height:1.6;color:var(--df-ink);background:color-mix(in srgb,var(--df-paper) 90%,transparent);padding:10px 12px;border:1px solid var(--df-line);border-radius:var(--radius);justify-self:end}
.df-stage-sign{display:flex;align-items:center;gap:12px}
.df-stage-sign b{font-weight:800;font-size:clamp(22px,3.2cqi,42px);background:var(--df-paper);padding:0 .12em}

/* modules grid */
.df-proj-head{display:flex;flex-wrap:wrap;align-items:end;justify-content:space-between;gap:16px;margin-bottom:clamp(22px,3.4cqi,40px)}
.df-proj-grid{display:grid;gap:14px}
@container (min-width:760px){.df-proj-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.df-stage-foot{grid-template-columns:1fr auto}}
.df-card{position:relative;display:flex;flex-direction:column;border:1.5px solid var(--df-line);border-radius:20px;background:var(--df-card);overflow:hidden;transition:border-color .3s,transform .4s cubic-bezier(.2,.8,.2,1),box-shadow .4s}
.df-card:hover{border-color:var(--df-ink);transform:translateY(-3px);box-shadow:0 24px 50px -32px oklch(0 0 0 / 0.3)}
.df-card-top{position:relative;height:clamp(112px,14cqi,156px);overflow:hidden;--px:50%;--py:50%;border-bottom:1px solid var(--df-line)}
.df-card-fill{position:absolute;inset:0;clip-path:circle(0% at var(--px) var(--py));transition:clip-path .8s cubic-bezier(.2,.8,.2,1)}
.df-card:hover .df-card-fill,.df-card[data-open="true"] .df-card-fill{clip-path:circle(150% at var(--px) var(--py))}
.df-card-code{position:absolute;inset-inline-start:18px;bottom:8px;font-family:var(--df-mono);font-weight:800;font-size:clamp(48px,7.5cqi,86px);line-height:.9;letter-spacing:-.04em;color:var(--df-ink);transition:color .5s}
.df-card:hover .df-card-code,.df-card[data-open="true"] .df-card-code{color:oklch(0.99 0 0)}
.df-card-top .df-logo{position:absolute;inset-inline-end:16px;top:14px;width:40px;height:auto;color:var(--df-ink);transition:color .5s}
.df-card:hover .df-card-top .df-logo,.df-card[data-open="true"] .df-card-top .df-logo{color:oklch(0.99 0 0)}
.df-card-body{display:flex;flex-direction:column;gap:10px;padding:18px 20px 20px}
.df-chip{display:inline-flex;align-items:center;gap:6px;align-self:flex-start;padding:4px 10px;border-radius:999px;font-family:var(--df-mono);font-weight:800;font-size:10.5px;border:1.5px solid currentColor;color:var(--df-ink)}
.df-chip i{width:6px;height:6px;border-radius:9px;background:var(--chart-2)}
.df-chip[data-s="ongoing"] i{animation:df-blink 1.6s ease-in-out infinite}
.df-card h3{font-weight:800;font-size:clamp(19px,2.2cqi,24px);line-height:1.2}
.df-card p{color:var(--df-soft);font-size:14.5px;line-height:1.6}
.df-bar{height:8px;border-radius:9px;background:var(--df-line);overflow:hidden}
.df-bar i{display:block;height:100%;border-radius:9px;background:var(--df-ink);transform-origin:left;transition:transform 1.4s cubic-bezier(.2,.8,.2,1)}
[dir="rtl"] .df-bar i{transform-origin:right}
.df-more{display:grid;grid-template-rows:0fr;transition:grid-template-rows .5s cubic-bezier(.2,.8,.2,1)}
.df-card[data-open="true"] .df-more{grid-template-rows:1fr}
.df-more>div{overflow:hidden}
.df-more-in{display:flex;flex-direction:column;gap:14px;padding-top:6px}
.df-card-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:4px}
.df-toggle{display:inline-flex;align-items:center;gap:8px;font-weight:800;font-size:12px;color:var(--df-ink)}
.df-toggle svg{transition:transform .4s cubic-bezier(.2,.8,.2,1)}
.df-toggle[aria-expanded="true"] svg{transform:rotate(45deg)}

/* interactive cycle + schedule */
.df-nights{display:grid;gap:clamp(18px,3cqi,28px);margin-top:clamp(24px,4cqi,44px)}
@container (min-width:900px){.df-nights{grid-template-columns:minmax(300px,.8fr) 1.4fr;align-items:start}}
.df-sky{position:relative;display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px 22px 22px;border-radius:24px;background:var(--df-card);border:1.5px solid var(--df-line);overflow:hidden}
.df-sky-moon{position:relative;width:min(210px,60cqi);height:auto}
.df-sky-moon .df-orbit-spin{animation-duration:40s}
.df-sky h3{font-weight:800;font-size:24px;line-height:1.1}
.df-sky-row{display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%}
.df-sky-facts{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));width:100%;border-top:1px solid var(--df-line)}
.df-sky-facts div{padding:12px 4px 0;text-align:center}
.df-sky-facts b{display:block;font-family:var(--df-mono);font-weight:800;font-size:20px;color:var(--df-ink);font-variant-numeric:tabular-nums}
.df-step{display:inline-grid;place-items:center;width:36px;height:36px;border-radius:999px;border:1.5px solid var(--df-line-strong);color:var(--df-ink);transition:background-color .2s,color .2s,border-color .2s}
.df-step:hover{background:var(--df-ink);color:var(--df-paper);border-color:var(--df-ink)}
.df-today{font-family:var(--df-mono);font-weight:800;font-size:11px;color:var(--df-muted)}
.df-today[data-on="true"]{color:var(--df-ink);text-decoration:underline;text-underline-offset:3px}
.df-filters{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}
.df-filter{padding:8px 14px;border-radius:999px;border:1.5px solid var(--df-line);font-weight:800;font-size:12px;color:var(--df-soft);transition:background-color .2s,color .2s,border-color .2s}
.df-filter:hover{border-color:var(--df-ink);color:var(--df-ink)}
.df-filter[aria-pressed="true"]{background:var(--df-ink);border-color:var(--df-ink);color:var(--df-paper)}
.df-events{display:flex;flex-direction:column;border-top:1.5px solid var(--df-ink)}
.df-event{display:grid;grid-template-columns:auto 1fr;gap:8px 16px;align-items:center;padding:16px 0;border-bottom:1px solid var(--df-line);animation:df-rise .5s cubic-bezier(.2,.8,.2,1) both}
.df-date{display:flex;flex-direction:column;align-items:center;justify-content:center;width:62px;height:66px;border-radius:14px;background:var(--df-ink);color:var(--df-paper);font-family:var(--df-mono);font-weight:800;line-height:1}
.df-date b{font-size:24px}
.df-date span{font-size:10px;margin-top:4px}
.df-event h3{font-weight:800;font-size:17px;line-height:1.25}
.df-event-meta{display:flex;flex-wrap:wrap;align-items:center;gap:4px 12px;margin-top:4px;color:var(--df-muted);font-size:13px}
.df-event-act{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:12px}
.df-going{font-size:12px;color:var(--df-muted);font-variant-numeric:tabular-nums}
.df-rsvp{min-width:112px;padding:10px 14px;font-size:11.5px}
.df-rsvp[aria-pressed="true"]{background:var(--df-ink);color:var(--df-paper)}
@container (min-width:620px){.df-event{grid-template-columns:auto 1fr auto}.df-event-act{grid-column:auto;flex-direction:column;align-items:flex-end}}

/* join + 3d card */
.df-join{display:grid;gap:clamp(28px,5cqi,64px);margin-top:clamp(24px,4cqi,44px)}
@container (min-width:900px){.df-join{grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);align-items:center}}
.df-tiers{display:grid;gap:10px}
@container (min-width:620px){.df-tiers{grid-template-columns:repeat(3,minmax(0,1fr))}}
.df-tier{position:relative;display:flex;flex-direction:column;gap:8px;padding:16px;border-radius:16px;border:1.5px solid var(--df-line);background:var(--df-card);transition:border-color .25s,background-color .25s,transform .3s cubic-bezier(.2,.8,.2,1);text-align:start}
.df-tier:hover{border-color:var(--df-ink);transform:translateY(-2px)}
.df-tier[aria-checked="true"]{border-color:var(--df-ink);background:var(--muted);box-shadow:inset 0 0 0 1px var(--df-ink)}
.df-tier-name{display:flex;align-items:center;justify-content:space-between;font-weight:800;font-size:14px}
.df-radio{width:18px;height:18px;border-radius:99px;border:2px solid var(--df-line-strong);display:grid;place-items:center}
.df-tier[aria-checked="true"] .df-radio{border-color:var(--df-ink)}
.df-tier[aria-checked="true"] .df-radio::after{content:"";width:8px;height:8px;border-radius:9px;background:var(--df-ink)}
.df-price{font-family:var(--df-mono);font-weight:800;font-size:26px;color:var(--df-ink);line-height:1.1}
.df-price small{font-size:12px;color:var(--df-muted)}
.df-tier ul{display:flex;flex-direction:column;gap:4px;font-size:12.5px;color:var(--df-soft)}
.df-tier li{display:flex;gap:7px;align-items:flex-start}
.df-badge{position:absolute;top:-10px;inset-inline-end:14px;padding:3px 9px;border-radius:999px;background:var(--df-ink);color:var(--df-paper);font-family:var(--df-mono);font-weight:800;font-size:9.5px}
.df-form{display:grid;gap:10px;margin-top:18px}
@container (min-width:620px){.df-form{grid-template-columns:1fr 1fr auto}}
.df-field{height:48px;padding:0 16px;border-radius:999px;border:1.5px solid var(--df-line);background:var(--df-card);outline:none;transition:border-color .2s,box-shadow .2s}
.df-field:focus{border-color:var(--df-ink);box-shadow:0 0 0 4px var(--df-line)}
.df-field[aria-invalid="true"]{border-color:var(--destructive)}
.df-msg{min-height:22px;margin-top:10px;font-size:13.5px;color:var(--df-muted)}
.df-msg[data-s="error"]{color:var(--destructive)}
.df-msg[data-s="done"]{color:var(--df-ink);font-weight:700}
.df-card-wrap{perspective:1100px;display:flex;flex-direction:column;align-items:center;gap:14px}
.df-member{position:relative;width:min(100%,460px);aspect-ratio:1.586;border-radius:22px;overflow:hidden;color:oklch(0.99 0 0);transform:rotateX(var(--ry,0deg)) rotateY(var(--rx,0deg));transform-style:preserve-3d;transition:transform .5s cubic-bezier(.2,.8,.2,1),box-shadow .5s;box-shadow:0 34px 70px -34px oklch(0 0 0 / 0.55);cursor:grab}
.df-member-bg{position:absolute;inset:0;transition:opacity .5s}
.df-member-rib{position:absolute;left:-12%;top:38%;width:130%;height:19%;background:oklch(0.08 0 0);color:oklch(0.99 0 0);transform:rotate(-14deg);display:flex;align-items:center;overflow:hidden}
.df-member-rib .df-marq-item{font-size:clamp(13px,2.2cqi,18px)}
.df-member-in{position:absolute;inset:0;background:linear-gradient(to top,oklch(0 0 0 / 0.48),transparent 45%);display:flex;flex-direction:column;justify-content:space-between;padding:clamp(14px,2.4cqi,22px)}
.df-member-top{display:flex;align-items:flex-start;justify-content:space-between}
.df-member-bottom{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;font-weight:800}
.df-member-name{font-size:clamp(16px,2.5cqi,24px);line-height:1.1;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.df-member-bottom small{display:block;font-size:10px;opacity:.85;margin-bottom:3px}
.df-member-no{text-align:end;font-family:var(--df-mono);font-size:clamp(14px,2cqi,18px)}
.df-member-shine{position:absolute;inset:0;background:linear-gradient(115deg,transparent 30%,oklch(1 0 0 / 0.25) 46%,transparent 60%);background-size:250% 100%;background-position:var(--sx,100%) 0;mix-blend-mode:soft-light;pointer-events:none;transition:background-position .5s}
.df-printed{animation:df-print .9s cubic-bezier(.2,.8,.2,1)}

/* footer */
.df-foot-band{position:relative;height:clamp(120px,16cqi,190px);color:oklch(0.99 0 0);overflow:hidden;margin-top:clamp(40px,7cqi,84px)}
.df-foot-band .df-title{position:absolute;inset-inline-start:clamp(16px,3cqi,40px);top:50%;transform:translateY(-54%);font-size:clamp(18px,3.6cqi,44px);z-index:1;pointer-events:none;color:oklch(0.99 0 0)}
.df-foot{display:flex;flex-direction:column;align-items:center;gap:14px;padding:clamp(18px,3cqi,30px) 0 clamp(24px,4cqi,40px);text-align:center}
.df-tagline{font-weight:800;font-size:clamp(15px,2.1cqi,24px);color:var(--df-ink)}
.df-foot-links{display:flex;flex-wrap:wrap;justify-content:center;gap:6px 18px}
.df-foot-links a{font-weight:700;font-size:12.5px;color:var(--df-soft);transition:color .2s}
.df-foot-links a:hover{color:var(--df-ink)}
.df-foot-end{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:10px 16px;color:var(--df-muted)}

@keyframes df-spin{to{transform:rotate(360deg)}}
@keyframes df-marq{to{transform:translateX(-50%)}}
@keyframes df-blink{0%,100%{opacity:1}50%{opacity:.25}}
@keyframes df-drop{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
@keyframes df-rise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes df-print{0%{transform:translateY(16px) scale(.96);filter:brightness(1.4)}100%{transform:none;filter:none}}
`;

/* ------------------------------------------------------------------ svg */

const DAFQLY_PATHS = {
  outer: "M118 142c0-49 40-89 89-89h101c104 0 188 84 188 188s-84 188-188 188H199c-50 0-90-40-90-90",
  flow: "M72 252c0-50 40-90 90-90h105c32 0 61 12 84 34",
  check: "m236 258 44 43 86-93",
};

function DafqlyLogo({ size = 40, follow = false, className = "" }: { size?: number; follow?: boolean; className?: string }) {
  const svg = React.useRef<SVGSVGElement | null>(null);
  const gRef = React.useRef<SVGGElement | null>(null);
  React.useEffect(() => {
    if (!follow) return;
    let raf = 0;
    let deg = 0;
    let px = 0;
    let py = 0;
    const apply = () => {
      raf = 0;
      const el = svg.current;
      const g = gRef.current;
      if (!el || !g) return;
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (Math.hypot(px - cx, py - cy) < r.width * 0.4) return;
      const target = clamp(((Math.atan2(py - cy, px - cx) * 180) / Math.PI) * 0.12, -14, 14);
      deg = unwrapAngle(deg, target);
      g.style.transform = `rotate(${deg.toFixed(1)}deg)`;
    };
    const move = (e: PointerEvent) => {
      px = e.clientX;
      py = e.clientY;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    window.addEventListener("pointermove", move, { passive: true });
    return () => {
      window.removeEventListener("pointermove", move);
      cancelAnimationFrame(raf);
    };
  }, [follow]);
  return (
    <svg ref={svg} className={`df-logo ${className}`} width={size} height={size} viewBox="0 0 540 512" fill="none" stroke="currentColor" aria-hidden="true">
      <g ref={gRef} className="df-logo-spin" style={{ transition: "transform 0.5s cubic-bezier(.2,.8,.2,1)" }}>
        <path d={DAFQLY_PATHS.outer} strokeWidth="66" strokeLinecap="round" />
        <path d={DAFQLY_PATHS.flow} stroke="var(--chart-2)" strokeWidth="66" strokeLinecap="round" />
        <path d={DAFQLY_PATHS.check} stroke="var(--chart-1)" strokeWidth="44" strokeLinecap="round" strokeLinejoin="round" />
      </g>
    </svg>
  );
}

function Asterisk({ size = 22, className = "" }: { size?: number; className?: string }) {
  const [turn, setTurn] = React.useState(0);
  return (
    <button
      type="button"
      className={`df-ast ${className}`}
      style={{ transform: turn ? `rotate(${turn * 120}deg)` : undefined }}
      onClick={() => setTurn((t) => t + 1)}
      aria-label="Spin"
      tabIndex={-1}
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" aria-hidden="true">
        <path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5" />
      </svg>
    </button>
  );
}

function Title({ text, className = "", as = "div" }: { text: string; className?: string; as?: "div" | "h1" | "h2" }) {
  const ls = lines(text);
  const Tag = as;
  return (
    <Tag className={`df-title ${className}`}>
      {ls.map((l, i) => (
        <span key={i}>{i === ls.length - 1 ? <span className="df-echo">{l}</span> : l}</span>
      ))}
    </Tag>
  );
}

function Arrow({ size = 14, rtl = false }: { size?: number; rtl?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" style={rtl ? { transform: "scaleX(-1)" } : undefined} aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
      <path d="M8 2.5v11M2.5 8h11" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2 6.5l2.6 2.5L10 3.5" />
    </svg>
  );
}

/* ---------------------------------------------------------------- bubbles */

type BubbleMask =
  | { kind: "text"; text: string; font: string; fit: number; x: number; baseline: number }
  | { kind: "logo"; cx: number; cy: number; size: number }
  | null;

type Spark = { x: number; y: number; vx: number; vy: number; r: number; c: number; life: number };

function Bubbles({
  seed,
  colors,
  density = 1,
  scale = 1,
  mask = null,
  interactive = true,
  onPop,
}: {
  seed: number;
  colors: string[];
  density?: number;
  scale?: number;
  mask?: BubbleMask;
  interactive?: boolean;
  onPop?: () => void;
}) {
  const ref = React.useRef<HTMLCanvasElement | null>(null);
  const live = React.useRef({ colors, mask, onPop });
  live.current = { colors, mask, onPop };
  const redraw = React.useRef(() => {});
  const maskKey = mask ? JSON.stringify(mask) : "";

  React.useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const host = (cv.parentElement?.parentElement ?? cv.parentElement) as HTMLElement;
    const rand = mulberry32(seed ^ 0x5bd1e995);
    const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    let w = 0;
    let h = 0;
    let dpr = 1;
    let list: (Bubble & { ox: number; oy: number; s: number })[] = [];
    let sparks: Spark[] = [];
    let raf = 0;
    let running = false;
    let visible = true;
    let knock: HTMLCanvasElement | null = null;
    const ptr = { x: -1e4, y: -1e4, on: false, dx: 0, dy: 0 };

    const buildKnock = () => {
      const m = live.current.mask;
      knock = null;
      if (!m || m.kind !== "logo" || typeof Path2D !== "function" || !w || !h) return;
      const off = document.createElement("canvas");
      off.width = Math.round(w * dpr);
      off.height = Math.round(h * dpr);
      const o = off.getContext("2d");
      if (!o) return;
      const s = (h * m.size) / 512;
      o.setTransform(dpr, 0, 0, dpr, 0, 0);
      o.translate(m.cx * w - s * 270, m.cy * h - s * 256);
      o.scale(s, s);
      o.lineCap = "round";
      o.lineJoin = "round";
      o.strokeStyle = "oklch(0 0 0)";
      o.lineWidth = 66;
      o.stroke(new Path2D(DAFQLY_PATHS.outer));
      o.stroke(new Path2D(DAFQLY_PATHS.flow));
      o.lineWidth = 44;
      o.stroke(new Path2D(DAFQLY_PATHS.check));
      knock = off;
    };

    let textSize = 0;
    let textFor = "";
    const draw = (t: number) => {
      const { colors: cols, mask: m } = live.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = cols[0] ?? "oklch(0.14 0 0)";
      ctx.fillRect(0, 0, w, h);
      const ts = t / 1000;
      const R = Math.max(70, Math.min(h, w) * 0.34);
      for (const b of list) {
        let tx = 0;
        let ty = 0;
        if (ptr.on) {
          const dx = b.x + b.ox - ptr.x;
          const dy = b.y + b.oy - ptr.y;
          const d = Math.hypot(dx, dy) || 1;
          const reach = R + b.r;
          if (d < reach) {
            const f = 1 - d / reach;
            const push = f * f * R * 0.6;
            tx = (dx / d) * push + ptr.dx * f * 0.6;
            ty = (dy / d) * push + ptr.dy * f * 0.6;
          }
        }
        if (reduced) {
          b.ox = tx;
          b.oy = ty;
          b.s = 1;
        } else {
          b.ox += (tx - b.ox) * 0.09;
          b.oy += (ty - b.oy) * 0.09;
          b.s += (1 - b.s) * 0.07;
        }
        const wx = reduced ? 0 : Math.sin(ts * b.sp + b.ph) * b.amp;
        const wy = reduced ? 0 : Math.cos(ts * b.sp * 0.8 + b.ph) * b.amp;
        ctx.fillStyle = cols[b.c % cols.length];
        ctx.beginPath();
        ctx.arc(b.x + b.ox + wx, b.y + b.oy + wy, Math.max(0.1, b.r * b.s), 0, Math.PI * 2);
        ctx.fill();
      }
      ptr.dx *= 0.85;
      ptr.dy *= 0.85;
      if (sparks.length) {
        for (const s of sparks) {
          s.x += s.vx;
          s.y += s.vy;
          s.vx *= 0.94;
          s.vy = s.vy * 0.94 - 0.05;
          s.life -= 0.022;
          if (s.life <= 0) continue;
          ctx.fillStyle = cols[s.c % cols.length];
          ctx.beginPath();
          ctx.arc(s.x, s.y, s.r * s.life, 0, Math.PI * 2);
          ctx.fill();
        }
        sparks = sparks.filter((s) => s.life > 0);
      }
      if (m && m.kind === "text") {
        const key = `${m.font}|${m.text}|${w}|${h}|${m.fit}`;
        if (key !== textFor) {
          ctx.font = `800 100px ${m.font}`;
          const mw = ctx.measureText(m.text).width || 1;
          textSize = Math.min((100 * w * m.fit) / mw, h * 1.15);
          textFor = key;
        }
        ctx.globalCompositeOperation = "destination-in";
        ctx.fillStyle = "oklch(0 0 0)";
        ctx.font = `800 ${textSize.toFixed(1)}px ${m.font}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(m.text, w * 0.5, h * 0.54);
      } else if (knock) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = "destination-out";
        ctx.drawImage(knock, 0, 0);
      }
    };

    const loop = (t: number) => {
      draw(t);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (running || reduced || !visible || !w) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
    };
    redraw.current = () => {
      buildKnock();
      if (!running) draw(performance.now());
    };

    const resize = () => {
      if (!cv.clientWidth || !cv.clientHeight) return;
      w = cv.clientWidth;
      h = cv.clientHeight;
      dpr = Math.min(2, devicePixelRatio || 1);
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      list = buildBubbles(seed, w, h, live.current.colors.length, density, scale).map((b) => ({ ...b, ox: 0, oy: 0, s: 1 }));
      textFor = "";
      buildKnock();
      draw(performance.now());
      start();
    };

    const local = (e: PointerEvent) => {
      const r = cv.getBoundingClientRect();
      return [e.clientX - r.left, e.clientY - r.top] as const;
    };
    const onMove = (e: PointerEvent) => {
      const [x, y] = local(e);
      if (ptr.on) {
        ptr.dx = clamp(x - ptr.x, -40, 40);
        ptr.dy = clamp(y - ptr.y, -40, 40);
      }
      ptr.x = x;
      ptr.y = y;
      ptr.on = x >= -40 && y >= -40 && x <= w + 40 && y <= h + 40;
      if (!running) draw(performance.now());
    };
    const onLeave = () => {
      ptr.on = false;
      if (!running) draw(performance.now());
    };
    let downAt = [0, 0];
    const onDown = (e: PointerEvent) => {
      downAt = [e.clientX, e.clientY];
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
      if ((e.target as HTMLElement | null)?.closest?.("a,button,input,label,select,textarea")) return;
      const [x, y] = local(e);
      if (x < 0 || y < 0 || x > w || y > h) return;
      const px = ctx.getImageData(Math.round(x * dpr), Math.round(y * dpr), 1, 1).data;
      if (px[3] < 10) return;
      for (let i = list.length - 1; i >= 0; i--) {
        const b = list[i];
        if (Math.hypot(b.x + b.ox - x, b.y + b.oy - y) > b.r * b.s + 2) continue;
        const n = live.current.colors.length;
        const old = b.c;
        b.c = 1 + ((b.c + Math.floor(rand() * (n - 2))) % Math.max(1, n - 1));
        b.s = reduced ? 1 : 0;
        if (!reduced) {
          for (let k = 0; k < 9; k++) {
            const a = (k / 9) * Math.PI * 2 + rand() * 0.5;
            const sp = 2 + rand() * 4;
            sparks.push({ x: b.x + b.ox, y: b.y + b.oy, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: b.r * (0.18 + rand() * 0.22), c: old, life: 1 });
          }
        }
        live.current.onPop?.();
        if (!running) draw(performance.now());
        break;
      }
    };

    resize();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    ro?.observe(cv);
    const io = typeof IntersectionObserver === "function"
      ? new IntersectionObserver((es) => {
          visible = es.some((e) => e.isIntersecting);
          if (visible) start();
          else stop();
        })
      : null;
    io?.observe(cv);
    const vis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", vis);
    if (interactive) {
      host.addEventListener("pointermove", onMove, { passive: true });
      host.addEventListener("pointerleave", onLeave);
      host.addEventListener("pointerdown", onDown);
      host.addEventListener("pointerup", onUp);
    }
    return () => {
      stop();
      ro?.disconnect();
      io?.disconnect();
      document.removeEventListener("visibilitychange", vis);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("pointerdown", onDown);
      host.removeEventListener("pointerup", onUp);
    };
  }, [seed, density, scale, interactive]);

  React.useEffect(() => {
    redraw.current();
  }, [colors, maskKey]);

  return (
    <div className="df-bub" aria-hidden="true">
      <canvas ref={ref} />
    </div>
  );
}

/* ------------------------------------------------------------------- phase */

function CycleGauge({ fraction, colors, uid, size = 210 }: { fraction: number; colors: string[]; uid: string; size?: number }) {
  const dots = React.useMemo(() => buildBubbles(31, 100, 100, colors.length, 1.4, 1.1), [colors.length]);
  const id = `${uid}-phase`;
  return (
    <svg className="df-sky-moon" width={size} height={size} viewBox="-70 -70 140 140" aria-hidden="true">
      <defs>
        <clipPath id={id}>
          <path d={phasePath(fraction, 50)} />
        </clipPath>
      </defs>
      <g className="df-orbit-spin">
        <circle r="64" fill="none" stroke="var(--df-line-strong)" strokeWidth="1" strokeDasharray="1 5" strokeLinecap="round" />
        <circle cx="64" r="3.5" fill="var(--chart-2)" />
      </g>
      <circle r="50" fill="var(--df-moon)" />
      <g clipPath={`url(#${id})`}>
        <rect x="-50" y="-50" width="100" height="100" fill={colors[0]} />
        {dots.map((b, i) => (
          <circle key={i} cx={b.x - 50} cy={b.y - 50} r={b.r} fill={colors[b.c % colors.length]} />
        ))}
      </g>
      <circle r="50" fill="none" stroke="var(--df-line-strong)" strokeWidth="1" />
    </svg>
  );
}

function MiniPhase({ fraction }: { fraction: number }) {
  return (
    <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
      <circle r="6" fill="var(--df-moon)" stroke="var(--df-line-strong)" strokeWidth=".8" />
      <path d={phasePath(fraction, 6)} fill="currentColor" />
    </svg>
  );
}

function StatValue({ value, run }: { value: string; run: boolean }) {
  const [t, setT] = React.useState(0);
  React.useEffect(() => {
    if (!run) return;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = clamp((now - t0) / 1400, 0, 1);
      setT(p);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [run]);
  return <>{formatStat(value, t)}</>;
}

function Marquee({ text, reverse, duration = 26, big }: { text: string; reverse?: boolean; duration?: number; big?: boolean }) {
  const REPS = 10;
  const items = Array.from({ length: REPS });
  const run = (key: string) => (
    <div key={key} style={{ display: "flex" }} aria-hidden={key === "b" ? true : undefined}>
      {items.map((_, i) => (
        <span className="df-marq-item" key={i}>
          {text}
          <DafqlyLogo size={big ? 44 : 28} />
        </span>
      ))}
    </div>
  );
  return (
    <div className={`df-marq${reverse ? " df-marq-r" : ""}`} style={{ ["--d" as string]: `${(duration * REPS) / 4}s` } as React.CSSProperties}>
      {run("a")}
      {run("b")}
    </div>
  );
}

function useInView(threshold = 0.14) {
  const ref = React.useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = React.useState(false);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    if (typeof IntersectionObserver !== "function") {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      (es) => {
        if (es.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { threshold },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, threshold]);
  return [ref, inView] as const;
}

/* ----------------------------------------------------------------- landing */

export function DafqlyLanding() {
  const locale = useLocale();
  const ar = locale === "ar";
  const uid = "df" + React.useId().replace(/[^a-zA-Z0-9]/g, "");

  const [pal, setPal] = React.useState<Palette>(PALETTES[0]);
  const [menu, setMenu] = React.useState(false);
  const [active, setActive] = React.useState("");
  const [pops, setPops] = React.useState(0);
  const [openCard, setOpenCard] = React.useState(-1);
  const [dayOffset, setDayOffset] = React.useState(0);
  const [kind, setKind] = React.useState(ar ? "الكل" : "All");
  const [simulated, setSimulated] = React.useState<Record<string, boolean>>({});
  const [tierIdx, setTierIdx] = React.useState(1);
  const [bizName, setBizName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [status, setStatus] = React.useState<"idle" | "error" | "done">("idle");
  const [msg, setMsg] = React.useState("");
  const [printed, setPrinted] = React.useState(0);

  const sections = React.useRef<Record<string, HTMLElement | null>>({});
  const stageRef = React.useRef<HTMLDivElement | null>(null);
  const cardRef = React.useRef<HTMLDivElement | null>(null);

  const [missionRef, missionIn] = useInView(0.15);
  const [projRef, projIn] = useInView(0.1);
  const [nightsRef, nightsIn] = useInView(0.12);
  const [joinRef, joinIn] = useInView(0.12);

  const navLinks: NavLink[] = [
    { label: ar ? "الرؤية" : "Overview", target: "mission" },
    { label: ar ? "الوحدات" : "Modules", target: "projects" },
    { label: ar ? "التوقعات" : "Schedule", target: "nights" },
    { label: ar ? "الباقات" : "Plans", target: "join" },
  ];

  const stats = [
    { value: "3×", label: ar ? "تحصيل أسرع بمتابعة منتظمة" : "Faster follow-up cadence" },
    { value: "24/7", label: ar ? "تذكيرات مجدولة بدون تدخل" : "Scheduled reminders, hands-off" },
    { value: "100%", label: ar ? "إجراءات AI بموافقتك" : "AI actions require approval" },
    { value: "0", label: ar ? "رسائل خارج ساعات الهدوء" : "Messages outside quiet hours" },
  ];

  const modules: ModuleItem[] = [
    {
      code: "#01",
      title: ar ? "تذكيرات واتساب الذكية" : "Smart WhatsApp Reminders",
      summary: ar ? "رسائل ودّية أو حازمة تتجدول تلقائياً خارج ساعات الهدوء." : "Polite-to-firm reminders scheduled outside quiet hours automatically.",
      detail: ar ? "لا تتكرر لنفس الفاتورة ولا تُرسل لعميل أوقف الرسائل. كل رسالة مسجلة ومربوطة بحالة الفاتورة." : "Never sent twice or to opted-out customers. Every reminder is audited and linked to invoice status.",
      status: "ongoing",
      progress: 0.92,
      goal: ar ? "التزام 100% بسياسات ساعات الهدوء" : "100% quiet-hours policy compliance",
      cta: ar ? "ابدأ التذكيرات" : "Start reminders",
    },
    {
      code: "#02",
      title: ar ? "المساعد الذكي للتحصيل" : "AI Collections Copilot",
      summary: ar ? "اسأله بالعربي أو الإنجليزي عن أي عميل أو فاتورة ويقترح الخطوة التالية." : "Ask about any customer or invoice; it reads your real ledger and proposes actions.",
      detail: ar ? "يقرأ بياناتك الحقيقية، يرتب أولويات المتابعة، ويجهز المسودات — ولا ينفذ أي إجراء إلا بموافقتك." : "Reads your real ledger, ranks priority debtors, and drafts actions awaiting your approval.",
      status: "open",
      progress: 0.85,
      goal: ar ? "موافقة بشرية إلزامية قبل التنفيذ" : "Mandatory human-in-the-loop approval",
      cta: ar ? "جرّب المساعد" : "Try the copilot",
    },
    {
      code: "#03",
      title: ar ? "تصوير الدفتر والشيكات" : "Ledger OCR & Cheques",
      summary: ar ? "حوّل صفحة الدفتر الورقي لفواتير رقمية، وتابع الشيكات القريبة والمرتدة." : "Turn ledger photos into invoices and track upcoming or bounced cheques.",
      detail: ar ? "أي قراءة غير مؤكدة تذهب للمراجعة البشرية فوراً، مع تنبيهات استباقية لمواعيد استحقاق الشيكات." : "Uncertain OCR readings route to review, with proactive alerts before cheque due dates.",
      status: "ongoing",
      progress: 0.78,
      goal: ar ? "استخراج فوري + مراجعة ذكية" : "Instant extraction + smart review",
      cta: ar ? "ارفع دفترك" : "Upload your ledger",
    },
    {
      code: "#04",
      title: ar ? "بوابة العميل والتعهدات" : "Customer Portal & Promises",
      summary: ar ? "رابط آمن يرى فيه العميل كشف حسابه ويطلب ميعاد سداد." : "A secure statement link where customers view balances and promise to pay.",
      detail: ar ? "إيصالات التحويل تُعامل كادّعاء حتى تؤكدها، وتعهدات السداد يتم تتبعها تلقائياً حتى التحصيل." : "Transfer screenshots stay claims until confirmed, and promises are tracked until kept.",
      status: "archived",
      progress: 1,
      goal: ar ? "عزل كامل للبيانات لكل منشأة" : "Full tenant isolation & audit trail",
      cta: ar ? "فعّل البوابة" : "Enable portal",
    },
  ];

  const cycleEvents: CycleEvent[] = [
    { offsetDays: 2, time: "10:00", title: ar ? "تذكير دفعة شركة النور للتوريدات" : "Al-Noor Supplies payment reminder", place: "WhatsApp", kind: ar ? "واتساب" : "WhatsApp", target: ar ? "فاتورة INV-1042" : "Invoice INV-1042", seats: 12, going: 9 },
    { offsetDays: 5, time: "13:30", title: ar ? "استحقاق شيك بنك مصر CHK-8841" : "Banque Misr cheque CHK-8841 due", place: ar ? "إدارة الشيكات" : "Cheques", kind: ar ? "شيكات" : "Cheques", target: ar ? "مراجعة وتحصيل" : "Deposit & clear", seats: 8, going: 5 },
    { offsetDays: 9, time: "11:00", title: ar ? "مراجعة تعهد سداد عميل الدلتا" : "Delta Trading promise-to-pay check", place: ar ? "بوابة العميل" : "Portal", kind: ar ? "تعهدات" : "Promises", target: ar ? "تأكيد التحويل" : "Confirm transfer", seats: 15, going: 11 },
    { offsetDays: 14, time: "16:00", title: ar ? "تقرير المتأخرات وتدفق 8 أسابيع" : "8-week cashflow & aging review", place: "AI Copilot", kind: ar ? "واتساب" : "WhatsApp", target: ar ? "أولوية التحصيل" : "Collection priority", seats: 20, going: 14 },
  ];

  const tiers: Tier[] = [
    {
      name: ar ? "البداية" : "Starter",
      price: ar ? "مجاني" : "Free",
      blurb: ar ? "للمشاريع الصغيرة وبداية التنظيم." : "For small teams getting organized.",
      perks: ar ? ["حتى 50 عميل", "كشف حساب للعميل", "متابعة الفواتير والشيكات"] : ["Up to 50 debtors", "Customer statement links", "Invoices & cheques"],
    },
    {
      name: ar ? "النمو" : "Growth",
      price: ar ? "490 ج.م" : "$19",
      period: ar ? "/شهر" : "/mo",
      blurb: ar ? "للشركات النشطة في التحصيل اليومي." : "For active daily collections.",
      perks: ar ? ["تذكيرات واتساب آلية", "المساعد الذكي للتحصيل", "تصوير الدفتر OCR", "ساعات الهدوء المخصصة"] : ["Automated WhatsApp", "AI Copilot & drafts", "Ledger photo OCR", "Custom quiet hours"],
      featured: true,
    },
    {
      name: ar ? "الشركات" : "Enterprise",
      price: ar ? "مخصص" : "Custom",
      blurb: ar ? "للفرق متعددة الفروع والحجم الكبير." : "Multi-branch & high-volume teams.",
      perks: ar ? ["عملاء وفواتير غير محدودة", "عزل بيانات كامل RLS", "تقارير تدفق متقدمة", "دعم وتكامل مخصص"] : ["Unlimited records", "Full RLS isolation", "Advanced forecasting", "Dedicated onboarding"],
    },
  ];

  const kinds = React.useMemo(() => [ar ? "الكل" : "All", ...Array.from(new Set(cycleEvents.map((e) => e.kind)))], [ar]);
  const shownEvents = cycleEvents.filter((e) => kind === (ar ? "الكل" : "All") || e.kind === kind);

  const skyDay = new Date(Date.now() + dayOffset * 86400000);
  const phase = cyclePhase(skyDay);
  const healthLabel = phase.illumination < 0.3 ? (ar ? "بداية الدورة" : "Cycle Start") : phase.illumination < 0.7 ? (ar ? "ذروة التحصيل" : "Peak Flow") : (ar ? "إقفال الشهر" : "Month Close");

  const scrollTo = (target: string) => {
    const el = sections.current[target];
    setMenu(false);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(target);
    return true;
  };

  const wordMask = React.useMemo(
    () => ({
      kind: "text" as const,
      text: ar ? "دفقلي" : "DAFQLY",
      font: "Geist, system-ui, sans-serif",
      fit: 0.86,
      x: 0,
      baseline: 0.8,
    }),
    [ar],
  );
  const bandMask = React.useMemo(() => ({ kind: "logo" as const, cx: 0.65, cy: 0.5, size: 0.78 }), []);
  const footMask = React.useMemo(() => ({ kind: "logo" as const, cx: 0.72, cy: 0.55, size: 1.25 }), []);

  const aimFill = (e: React.PointerEvent) => {
    const el = e.currentTarget as HTMLElement;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--px", `${(((e.clientX - r.left) / r.width) * 100).toFixed(1)}%`);
    el.style.setProperty("--py", `${(((e.clientY - r.top) / r.height) * 100).toFixed(1)}%`);
  };

  const tilt = (e: React.PointerEvent) => {
    const el = cardRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.setProperty("--rx", `${(x * 16).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(-y * 12).toFixed(2)}deg`);
    el.style.setProperty("--sx", `${((1 - (x + 0.5)) * 100).toFixed(1)}%`);
  };

  const untilt = () => {
    const el = cardRef.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--sx", "100%");
  };

  const handlePrintCard = (e: React.FormEvent) => {
    e.preventDefault();
    if (!bizName.trim()) {
      setStatus("error");
      setMsg(ar ? "اكتب اسم منشأتك لطباعة البطاقة." : "Enter your business name first.");
      return;
    }
    if (!isEmail(email)) {
      setStatus("error");
      setMsg(ar ? "أدخل بريداً إلكترونياً صحيحاً." : "Enter a valid email address.");
      return;
    }
    setStatus("done");
    setPrinted((p) => p + 1);
    setMsg(ar ? `بطاقة ${bizName.trim()} جاهزة — يمكنك الآن إنشاء حسابك.` : `Card ready for ${bizName.trim()} — continue to create your account.`);
  };

  const wsNum = workspaceNumber(bizName || "dafqly", email);
  const chosenTier = tiers[tierIdx] ?? tiers[0];

  const swatchRow = (
    <div className="df-swatches" role="radiogroup" aria-label={ar ? "لوحة الألوان" : "Bubble palette"}>
      {PALETTES.map((p) => (
        <button
          key={p.name}
          type="button"
          role="radio"
          aria-checked={p.name === pal.name}
          aria-label={p.name}
          title={p.name}
          className="df-sw"
          style={{ background: `conic-gradient(${[p.colors[1], p.colors[3], p.colors[4], p.colors[1]].join(",")})` }}
          onClick={() => setPal(p)}
        />
      ))}
    </div>
  );

  return (
    <div
      className="df-root"
      dir={ar ? "rtl" : "ltr"}
      style={{
        ["--df-accent" as string]: pal.accent,
        ["--df-frame" as string]: pal.frame,
      } as React.CSSProperties}
    >
      <style>{DF_CSS}</style>
      <div className="df-shell">
        {/* NAV */}
        <header className="df-nav">
          <div className="df-in">
            <a className="df-brand" href="#home" onClick={(e) => { e.preventDefault(); scrollTo("home"); }}>
              <DafqlyLogo size={32} follow />
              <span>{ar ? "دفقلي" : "DAFQLY"}</span>
            </a>
            <span className="df-issue">v3.0</span>
            <nav className="df-links" aria-label="Primary">
              {navLinks.map((l) => (
                <a
                  key={l.target}
                  className="df-link"
                  href={`#${l.target}`}
                  aria-current={active === l.target ? "true" : undefined}
                  onClick={(e) => { e.preventDefault(); scrollTo(l.target); }}
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="df-nav-end">
              {swatchRow}
              <ThemeToggle size="sm" />
              <LocaleToggle currentLocale={locale} className="min-h-[36px] rounded-full px-3 text-xs" />
              <Link data-testid="landing-cta-login" href={`/${locale}/login`} className="hidden text-xs font-bold text-muted-foreground hover:text-foreground sm:inline-block px-2">
                {ar ? "دخول" : "Login"}
              </Link>
              <Link data-testid="landing-cta-signup" href={`/${locale}/signup`} className="df-btn df-btn-solid">
                {ar ? "ابدأ الآن" : "Start free"}
                <Arrow size={12} rtl={ar} />
              </Link>
              <button type="button" className="df-icon df-menu-btn" aria-expanded={menu} aria-label="Menu" onClick={() => setMenu((m) => !m)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  {menu ? <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" /> : <path d="M2.5 5h11M2.5 11h11" />}
                </svg>
              </button>
            </div>
          </div>
          {menu && (
            <nav className="df-mobile" aria-label="Mobile">
              {navLinks.map((l) => (
                <a key={l.target} className="df-link" href={`#${l.target}`} onClick={(e) => { e.preventDefault(); scrollTo(l.target); }}>
                  {l.label}
                </a>
              ))}
              <Link href={`/${locale}/login`} className="df-link">{ar ? "تسجيل الدخول" : "Login"}</Link>
              {swatchRow}
            </nav>
          )}
        </header>

        {/* HERO */}
        <section className="df-hero df-sec" ref={(el) => { sections.current.home = el; }} data-section="home">
          <div className="df-orbits" aria-hidden="true">
            <svg style={{ left: "38%", top: "-28%", width: "86cqi", height: "86cqi" }} viewBox="0 0 100 100" fill="none">
              <g className="df-orbit-spin">
                <circle cx="50" cy="50" r="49" stroke="currentColor" strokeWidth=".18" />
                <circle cx="99" cy="50" r=".9" fill="var(--chart-2)" />
              </g>
            </svg>
            <svg style={{ left: "-20%", top: "30%", width: "58cqi", height: "58cqi" }} viewBox="0 0 100 100" fill="none">
              <g className="df-orbit-spin df-orbit-spin-r">
                <circle cx="50" cy="50" r="49" stroke="currentColor" strokeWidth=".2" />
                <circle cx="50" cy="1" r="1.4" fill="var(--chart-1)" />
              </g>
            </svg>
          </div>

          <h1 className="sr-only">{ar ? "دفقلي — تتبّع. تابع. وحصّل." : "DAFQLY — Track. Follow. Get Paid."}</h1>
          <div className="df-wm">
            <Bubbles seed={102} colors={pal.colors} density={2} scale={0.4} mask={wordMask} onPop={() => setPops((p) => p + 1)} />
            <div className="df-hero-mark">
              <DafqlyLogo size={130} follow />
              <Title text={ar ? "دفقلي.\nتحصيل ذكي" : "DAFQLY.\nCOLLECTIONS"} className="df-hero-title" />
            </div>
          </div>

          <div className="df-in">
            <div className="df-hero-row">
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                <span className="df-issue-big">24/7</span>
                <span className="df-hint df-mono" aria-live="polite">
                  <i className="df-pop-dot" />
                  {ar ? "اضغط على الفقاعات. بتفرقع." : "Click the bubbles. They pop."}
                  {pops > 0 && <b>{pops} {ar ? "فرقعات" : "popped"}</b>}
                </span>
              </div>
              <div className="df-hero-copy">
                <Asterisk size={20} className="self-start" />
                <p>
                  {ar
                    ? "منصة تحصيل مستحقات ذكية للشركات المصرية والعربية: تذكيرات واتساب في وقتها، تصوير الدفتر بالذكاء الاصطناعي، متابعة الشيكات، وبوابة عملاء معزولة وآمنة."
                    : "Smart accounts-receivable platform: perfectly timed WhatsApp reminders, AI ledger OCR, cheque tracking, and a tenant-isolated customer statement portal."}
                </p>
                <div className="df-ctas">
                  <Link data-testid="landing-hero-signup" href={`/${locale}/signup`} className="df-btn df-btn-solid">
                    {ar ? "ابدأ مجاناً" : "Start free"}
                    <Arrow rtl={ar} />
                  </Link>
                  <button type="button" className="df-btn df-btn-line" onClick={() => scrollTo("nights")}>
                    {ar ? "شوف دورة التحصيل" : "Explore schedule"}
                  </button>
                </div>
                <div className="df-credit">
                  {ar ? "دفقلي · بيانات معزولة ومشفّرة وكل إجراء بموافقتك" : "DAFQLY · Tenant-isolated, encrypted & human-approved"}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* MISSION BAND + STATS */}
        <section className="df-sec" ref={(el) => { sections.current.mission = el; }} data-section="mission">
          <div className="df-band">
            <Bubbles seed={103} colors={pal.colors} density={2} scale={0.42} mask={bandMask} onPop={() => setPops((p) => p + 1)} />
            <Title text={ar ? "دفقلي.\nدفتر التحصيل" : "DAFQLY.\nQUIET LEDGER"} className="df-band-title" />
            <Asterisk size={18} />
          </div>
          <div className="df-in">
            <div className="df-kicker">
              <span className="df-label">{ar ? "نظام إدارة المستحقات والتدفق النقدي" : "ACCOUNTS RECEIVABLE & CASHFLOW ENGINE"}</span>
              <Asterisk size={24} />
            </div>
            <div className="df-meta">
              <span className="df-label">{ar ? "تذكيرات واتساب" : "WhatsApp Automation"}</span>
              <span className="df-label">{ar ? "مساعد AI بموافقتك" : "Human-approved AI"}</span>
              <span className="df-label">{ar ? "عزل بيانات RLS" : "Full RLS Isolation"}</span>
            </div>
            <div className="df-mission df-reveal" ref={missionRef} data-in={missionIn}>
              <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
                <h2 className="df-h2">{ar ? "كل اللي محتاجه عشان فلوسك ترجع أسرع." : "Everything you need to get paid faster."}</h2>
                <p className="df-lede">
                  {ar
                    ? "من أول ما تصوّر الدفتر الورقي لحد ما العميل يدفع أو يبعت تعهد سداد — كل خطوة واضحة، مسجلة، ومحكومة بسياسات أمان تمنع الإرسال العشوائي أو الخطأ."
                    : "From photographing a paper ledger to confirming a customer payment or promise-to-pay — every step is tracked, audited, and governed by clear safety policies."}
                </p>
              </div>
              <dl className="df-stats">
                {stats.map((s) => (
                  <div className="df-stat" key={s.label}>
                    <dt dir="ltr">
                      <StatValue value={s.value} run={missionIn} />
                    </dt>
                    <dd className="df-mono" style={{ color: "var(--df-muted)" }}>{s.label}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* CROSSING RIBBONS + EXPANDABLE MODULES */}
        <section className="df-sec df-pad" ref={(el) => { sections.current.projects = el; }} data-section="projects" style={{ paddingTop: 0 }}>
          <div
            className="df-stage"
            ref={stageRef}
            onPointerMove={(e) => {
              const el = stageRef.current;
              if (!el) return;
              const r = el.getBoundingClientRect();
              el.style.setProperty("--mx", (((e.clientX - r.left) / r.width - 0.5) * 2).toFixed(3));
              el.style.setProperty("--my", (((e.clientY - r.top) / r.height - 0.5) * 2).toFixed(3));
            }}
            onPointerLeave={() => {
              stageRef.current?.style.setProperty("--mx", "0");
              stageRef.current?.style.setProperty("--my", "0");
            }}
          >
            <div className="df-stage-type df-title" aria-hidden="true">
              <span>{ar ? "دفقلي" : "DAFQLY"}</span>
              <span>
                <span className="df-echo">{ar ? "تحصيل" : "LEDGER"}</span>
                <sup>v3</sup>
              </span>
            </div>
            <div className="df-rib" style={{ ["--x" as string]: "26%", ["--y" as string]: "62%", ["--w" as string]: "190%", ["--r" as string]: "-32deg", ["--k" as string]: "10" } as React.CSSProperties}>
              <Bubbles seed={104} colors={pal.colors} density={1.8} scale={0.7} interactive={false} />
            </div>
            <div className="df-rib df-rib-ink" style={{ ["--x" as string]: "33%", ["--y" as string]: "56%", ["--w" as string]: "190%", ["--r" as string]: "68deg", ["--k" as string]: "-14" } as React.CSSProperties}>
              <Marquee text={ar ? "تتبّع · تابع · وحصّل" : "TRACK · FOLLOW · GET PAID"} duration={28} big />
            </div>
            <div className="df-rib" style={{ ["--x" as string]: "56%", ["--y" as string]: "62%", ["--w" as string]: "190%", ["--r" as string]: "16deg", ["--k" as string]: "8" } as React.CSSProperties}>
              <Bubbles seed={105} colors={pal.colors} density={1.8} scale={0.7} interactive={false} />
            </div>
            <div className="df-rib df-rib-ink" style={{ ["--x" as string]: "84%", ["--y" as string]: "64%", ["--w" as string]: "190%", ["--r" as string]: "36deg", ["--k" as string]: "-18" } as React.CSSProperties}>
              <Marquee text="DAFQLY · AI COLLECTIONS" reverse duration={22} />
            </div>
            <div className="df-stage-foot">
              <div className="df-stage-sign">
                <b>{ar ? "دفقلي" : "DAFQLY"}</b>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
                <p className="df-stage-body">
                  {ar
                    ? "أربع وحدات متكاملة تعمل معاً: أتمتة واتساب، مساعد ذكي، قراءة الدفاتر والشيكات، وبوابة كشف حساب للعملاء."
                    : "Four integrated modules working in sync: WhatsApp automation, AI copilot, ledger OCR & cheques, and a customer statement portal."}
                </p>
              </div>
            </div>
          </div>

          <div className="df-in df-reveal" ref={projRef} data-in={projIn} style={{ marginTop: "clamp(36px,6cqi,72px)" }}>
            <div className="df-proj-head">
              <h2 className="df-h2">{ar ? "وحدات النظام الأساسية." : "Core platform modules."}</h2>
              <span className="df-label">{ar ? "4 وحدات متكاملة" : "4 active modules"}</span>
            </div>
            <div className="df-proj-grid">
              {modules.map((p, i) => {
                const isOpen = openCard === i;
                return (
                  <article key={p.code} className="df-card" data-open={isOpen}>
                    <div className="df-card-top" onPointerMove={aimFill} onPointerEnter={aimFill}>
                      <div className="df-card-fill" style={{ background: bubbleCss(102 * 31 + i * 7, pal.colors, 28, 50) }} />
                      <span className="df-card-code">{p.code}</span>
                      <DafqlyLogo size={40} />
                    </div>
                    <div className="df-card-body">
                      <span className="df-chip" data-s={p.status}>
                        <i />
                        {p.status === "open" ? (ar ? "ذكاء اصطناعي" : "AI Copilot") : p.status === "ongoing" ? (ar ? "تلقائي" : "Automated") : (ar ? "جاهز" : "Live")}
                      </span>
                      <h3>{p.title}</h3>
                      <p>{p.summary}</p>
                      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                        <div className="df-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p.progress * 100)}>
                          <i style={{ transform: `scaleX(${projIn ? p.progress : 0})` }} />
                        </div>
                        <span className="df-mono" style={{ color: "var(--df-muted)" }} suppressHydrationWarning>{p.goal}</span>
                      </div>
                      <div className="df-more" id={`${uid}-m${i}`}>
                        <div>
                          <div className="df-more-in">
                            <p>{p.detail}</p>
                            <Link href={`/${locale}/signup`} className="df-btn df-btn-ink self-start" tabIndex={isOpen ? 0 : -1}>
                              {p.cta}
                              <Arrow rtl={ar} />
                            </Link>
                          </div>
                        </div>
                      </div>
                      <div className="df-card-foot">
                        <button type="button" className="df-toggle" aria-expanded={isOpen} aria-controls={`${uid}-m${i}`} onClick={() => setOpenCard(isOpen ? -1 : i)}>
                          <PlusIcon />
                          {isOpen ? (ar ? "إغلاق التفاصيل" : "Close dossier") : (ar ? "عرض التفاصيل" : "Open dossier")}
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        {/* INTERACTIVE COLLECTION CYCLE & SCHEDULE */}
        <section className="df-sec df-pad" ref={(el) => { sections.current.nights = el; }} data-section="nights" style={{ paddingTop: 0 }}>
          <div className="df-in df-reveal" ref={nightsRef} data-in={nightsIn}>
            <div className="df-meta">
              <span className="df-label">{ar ? "جدولة المتابعة والتدفق النقدي" : "Collection Cycle & Timeline"}</span>
              <span className="df-label">{ar ? "محاكاة تفاعلية" : "Interactive Preview"}</span>
            </div>
            <div className="df-proj-head" style={{ marginTop: "clamp(22px,3cqi,36px)", marginBottom: 0 }}>
              <h2 className="df-h2">{ar ? "تحكّم في دورة التحصيل يوم بيوم." : "Control your collection cycle."}</h2>
              <Asterisk size={28} />
            </div>
            <div className="df-nights">
              <div className="df-sky">
                <div className="df-sky-row">
                  <span className="df-label">{ar ? "مؤشر الدورة" : "Cycle Phase"}</span>
                  <button type="button" className="df-today" data-on={dayOffset !== 0} onClick={() => setDayOffset(0)} disabled={dayOffset === 0}>
                    {dayOffset === 0 ? (ar ? "اليوم" : "Today") : (ar ? "الرجوع لليوم" : "Back to today")}
                  </button>
                </div>
                <CycleGauge fraction={phase.fraction} colors={pal.colors} uid={uid} />
                <div style={{ textAlign: "center" }}>
                  <h3>{healthLabel}</h3>
                  <span className="df-mono" style={{ color: "var(--df-muted)" }} suppressHydrationWarning>
                    {skyDay.toLocaleDateString(ar ? "ar-EG" : "en-US", { weekday: "short", day: "2-digit", month: "short", year: "numeric" })}
                  </span>
                </div>
                <div className="df-sky-row" style={{ justifyContent: "center", gap: 14 }}>
                  <button type="button" className="df-step" aria-label={ar ? "اليوم السابق" : "Previous day"} onClick={() => setDayOffset((d) => d - 1)}>
                    <Arrow size={14} rtl={!ar} />
                  </button>
                  <input
                    type="range"
                    min={-15}
                    max={30}
                    value={dayOffset}
                    onChange={(e) => setDayOffset(+e.target.value)}
                    aria-label={ar ? "تحريك الأيام" : "Scrub days"}
                    style={{ accentColor: "var(--df-ink)", width: "min(160px,40cqi)" }}
                  />
                  <button type="button" className="df-step" aria-label={ar ? "اليوم التالي" : "Next day"} onClick={() => setDayOffset((d) => d + 1)}>
                    <Arrow size={14} rtl={ar} />
                  </button>
                </div>
                <div className="df-sky-facts">
                  <div>
                    <b>{Math.round(phase.illumination * 100)}%</b>
                    <span className="df-mono" style={{ color: "var(--df-muted)" }} suppressHydrationWarning>{ar ? "نسبة التحصيل" : "Collected"}</span>
                  </div>
                  <div>
                    <b>{Math.round(phase.waxing ? phase.daysToClose : phase.daysToReset)}d</b>
                    <span className="df-mono" style={{ color: "var(--df-muted)" }} suppressHydrationWarning>{ar ? "للإقفال" : "To close"}</span>
                  </div>
                  <div>
                    <b>{dayOffset >= 0 ? `+${dayOffset}d` : `${dayOffset}d`}</b>
                    <span className="df-mono" style={{ color: "var(--df-muted)" }} suppressHydrationWarning>{ar ? "الإزاحة" : "Offset"}</span>
                  </div>
                </div>
              </div>

              <div>
                <div className="df-filters" role="group" aria-label={ar ? "تصفية المهام" : "Filter schedule"}>
                  {kinds.map((k) => (
                    <button key={k} type="button" className="df-filter" aria-pressed={kind === k} onClick={() => setKind(k)}>
                      {k}
                    </button>
                  ))}
                </div>
                <ul className="df-events">
                  {shownEvents.map((ev, row) => {
                    const evDate = new Date(Date.now() + ev.offsetDays * 86400000);
                    const key = `${ev.title}-${row}`;
                    const activeSim = !!simulated[key];
                    const count = ev.going + (activeSim ? 1 : 0);
                    return (
                      <li key={key} className="df-event">
                        <div className="df-date" suppressHydrationWarning>
                          <b>{String(evDate.getDate()).padStart(2, "0")}</b>
                          <span>{evDate.toLocaleDateString("en-US", { month: "short" }).toUpperCase()}</span>
                        </div>
                        <div>
                          <span className="df-label" style={{ fontSize: 10 }}>
                            {ev.kind} · {ev.time}
                          </span>
                          <h3>{ev.title}</h3>
                          <div className="df-event-meta">
                            <span>{ev.place}</span>
                            <span>·</span>
                            <span>{ev.target}</span>
                            <span>·</span>
                            <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                              <MiniPhase fraction={cyclePhase(evDate).fraction} />
                              {Math.round(cyclePhase(evDate).illumination * 100)}%
                            </span>
                          </div>
                        </div>
                        <div className="df-event-act">
                          <button
                            type="button"
                            className="df-btn df-btn-line df-rsvp"
                            aria-pressed={activeSim}
                            onClick={() => setSimulated((s) => ({ ...s, [key]: !s[key] }))}
                          >
                            {activeSim ? (
                              <>
                                <CheckIcon /> {ar ? "مجدول" : "Queued"}
                              </>
                            ) : (
                              ar ? "جدولة" : "Queue"
                            )}
                          </button>
                          <span className="df-going">
                            {count}/{ev.seats} {ar ? "عملاء" : "accounts"}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>
          </div>
        </section>

        {/* JOIN + 3D WORKSPACE CARD */}
        <section className="df-sec df-pad" ref={(el) => { sections.current.join = el; }} data-section="join" style={{ paddingTop: 0 }}>
          <div className="df-in df-reveal" ref={joinRef} data-in={joinIn}>
            <div className="df-meta">
              <span className="df-label">{ar ? "الباقات ومساحة العمل" : "Plans & Workspace"}</span>
              <span className="df-label">{wsNum}</span>
              <span className="df-label">{chosenTier.name}</span>
            </div>
            <div className="df-join">
              <div>
                <h2 className="df-h2" style={{ marginTop: "clamp(18px,3cqi,30px)" }}>
                  {ar ? "اطبع بطاقة منشأتك وابدأ." : "Print your workspace card."}
                </h2>
                <p className="df-lede" style={{ margin: "14px 0 22px" }}>
                  {ar
                    ? "اختر الباقة المناسبة واكتب اسم منشأتك لمعاينة بطاقة مساحة العمل الخاصة بك قبل التسجيل."
                    : "Select a tier and enter your business name to preview your DAFQLY workspace card."}
                </p>
                <div className="df-tiers" role="radiogroup" aria-label={ar ? "الباقات" : "Plans"}>
                  {tiers.map((t, i) => (
                    <button
                      key={t.name}
                      type="button"
                      role="radio"
                      aria-checked={tierIdx === i}
                      className="df-tier"
                      onClick={() => setTierIdx(i)}
                    >
                      {t.featured && <span className="df-badge">{ar ? "الأكثر طلباً" : "Popular"}</span>}
                      <span className="df-tier-name">
                        {t.name}
                        <span className="df-radio" />
                      </span>
                      <span className="df-price">
                        {t.price}
                        {t.period && <small>{t.period}</small>}
                      </span>
                      <span style={{ fontSize: 12.5, color: "var(--df-muted)" }}>{t.blurb}</span>
                      <ul>
                        {t.perks.map((pk) => (
                          <li key={pk}>
                            <CheckIcon />
                            <span>{pk}</span>
                          </li>
                        ))}
                      </ul>
                    </button>
                  ))}
                </div>
                <form className="df-form" onSubmit={handlePrintCard} noValidate>
                  <input
                    className="df-field"
                    value={bizName}
                    maxLength={40}
                    placeholder={ar ? "اسم المنشأة" : "Business name"}
                    aria-invalid={status === "error" && !bizName.trim() ? true : undefined}
                    onChange={(e) => {
                      setBizName(e.target.value);
                      if (status !== "idle") setStatus("idle");
                    }}
                  />
                  <input
                    className="df-field"
                    type="email"
                    dir="ltr"
                    value={email}
                    placeholder="name@company.com"
                    aria-invalid={status === "error" && !!bizName.trim() && !isEmail(email) ? true : undefined}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (status !== "idle") setStatus("idle");
                    }}
                  />
                  <button type="submit" className="df-btn df-btn-solid">
                    {ar ? "معاينة البطاقة" : "Preview card"}
                  </button>
                </form>
                <div className="df-msg" data-s={status} role="status" aria-live="polite">
                  {status !== "idle" && (
                    <span>
                      {msg}{" "}
                      {status === "done" && (
                        <Link href={`/${locale}/signup`} className="underline font-extrabold">
                          {ar ? "إكمال التسجيل ←" : "Complete signup →"}
                        </Link>
                      )}
                    </span>
                  )}
                </div>
              </div>

              <div className="df-card-wrap">
                <div
                  key={printed}
                  ref={cardRef}
                  className={`df-member${printed ? " df-printed" : ""}`}
                  onPointerMove={tilt}
                  onPointerLeave={untilt}
                  aria-label={ar ? "معاينة بطاقة دفقلي" : "DAFQLY workspace card preview"}
                  role="img"
                >
                  <div className="df-member-bg" style={{ background: bubbleCss(hashStr(bizName + chosenTier.name) || 102, pal.colors, 42, 56) }} />
                  <div className="df-member-rib">
                    <Marquee text="DAFQLY · LEDGER" duration={18} />
                  </div>
                  <div className="df-member-in">
                    <div className="df-member-top">
                      <Title text={ar ? "دفقلي.\nتحصيل ذكي" : "DAFQLY.\nCOLLECTIONS"} />
                      <DafqlyLogo size={46} />
                    </div>
                    <div className="df-member-bottom">
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <small>{chosenTier.name}</small>
                        <div className="df-member-name">{bizName.trim() || (ar ? "اسم منشأتك" : "Your Business")}</div>
                      </div>
                      <div className="df-member-no">
                        <small>ID</small>
                        {wsNum}
                      </div>
                    </div>
                  </div>
                  <div className="df-member-shine" />
                </div>
                <span className="df-mono" style={{ color: "var(--df-muted)" }}>
                  {ar ? "مرّر المؤشر على البطاقة" : "Hover over the card · it tilts"}
                </span>
              </div>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer className="df-sec">
          <div className="df-foot-band">
            <Bubbles seed={106} colors={pal.colors} density={2} scale={0.5} mask={footMask} onPop={() => setPops((p) => p + 1)} />
            <Title text={ar ? "دفقلي.\nتتبّع وحصّل" : "DAFQLY.\nGET PAID"} />
          </div>
          <div className="df-in df-foot">
            <p className="df-tagline">{ar ? "تتبّع. تابع. وحصّل." : "TRACK. FOLLOW. GET PAID."}</p>
            <nav className="df-foot-links" aria-label="Footer">
              <Link href={`/${locale}/login`}>{ar ? "تسجيل الدخول" : "Login"}</Link>
              <Link href={`/${locale}/signup`}>{ar ? "إنشاء حساب" : "Sign up"}</Link>
              <a href="#mission" onClick={(e) => { e.preventDefault(); scrollTo("mission"); }}>{ar ? "الرؤية" : "Overview"}</a>
              <a href="#projects" onClick={(e) => { e.preventDefault(); scrollTo("projects"); }}>{ar ? "الوحدات" : "Modules"}</a>
            </nav>
            <div className="df-foot-end">
              <ThemeToggle size="sm" />
              <a href="#home" className="df-toggle" onClick={(e) => { e.preventDefault(); scrollTo("home"); }}>
                {ar ? "العودة للأعلى ↑" : "Back to top ↑"}
              </a>
              <span className="df-mono">© {new Date().getFullYear()} {ar ? "دفقلي" : "DAFQLY"}</span>
            </div>
          </div>
        </footer>
      </div>
    </div>
  );
}
