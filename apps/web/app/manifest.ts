import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { MetadataRoute } from "next";

/**
 * The PWA manifest is the brand kit's file, served per BRAND §9 (lang=ar,
 * dir=rtl, theme_color from the kit). Icon files were copied from the kit
 * into public/icons/, so the manifest's paths resolve unchanged.
 */
export default function manifest(): MetadataRoute.Manifest {
  const raw = readFileSync(resolve(process.cwd(), "../../packages/brand/public/manifest.webmanifest"), "utf8");
  return JSON.parse(raw) as MetadataRoute.Manifest;
}
