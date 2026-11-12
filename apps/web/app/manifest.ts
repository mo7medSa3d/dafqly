import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MetadataRoute } from "next";

import tokens from "@tahseel/brand/tokens.json";

/**
 * The PWA manifest is the brand kit's file, served per BRAND §9 (lang=ar,
 * dir=rtl, theme_color from the kit). Icon files were copied from the kit
 * into public/icons/, so the manifest's paths resolve unchanged.
 */
export default function manifest(): MetadataRoute.Manifest {
  const cwd = process.cwd();
  const candidates = [
    resolve(cwd, "packages/brand/public/manifest.webmanifest"),
    resolve(cwd, "../packages/brand/public/manifest.webmanifest"),
    resolve(cwd, "../../packages/brand/public/manifest.webmanifest"),
  ];
  if (typeof __dirname !== "undefined") {
    candidates.push(resolve(__dirname, "../../../packages/brand/public/manifest.webmanifest"));
  }
  for (const p of candidates) {
    try {
      if (existsSync(p)) {
        const raw = readFileSync(p, "utf8");
        return JSON.parse(raw) as MetadataRoute.Manifest;
      }
    } catch {
      // try next
    }
  }
  return {
    name: "DAFQLY",
    short_name: "DAFQLY",
    description: "دفّقلي — منصة إدارة المستحقات والتدفقات النقدية الذكية",
    lang: "ar",
    dir: "rtl",
    start_url: "/?source=pwa",
    display: "standalone",
    background_color: tokens.color.slate["50"],
    theme_color: tokens.color.navy["700"],
  };
}
