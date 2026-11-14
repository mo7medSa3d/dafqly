// Regenerate ALL raster brand assets from the (unchanged-geometry) DAFQLY
// mark SVGs with sharp — no new dependency: sharp 0.35.5 already lives in
// the pnpm store (transitive). Run: `node scripts/regenerate-brand-assets.mjs`
// from the repo root. Sources of truth:
//   - packages/brand/icons/app-icon.svg            (navy tile + mark)
//   - packages/brand/icons/app-icon-fullbleed.svg  (maskable variant)
//   - packages/brand/logo/mark-white.svg            (white mark, splash)
//   - packages/brand/logo/wordmark-horizontal-reversed-outlined.svg (OG/email)
// All outputs are Quiet Ledger colours only: navy #14243A, teal #27C7A5
// (inside the mark), white. Geometry of the mark is never edited here.
import { createRequire } from "node:module";
import { existsSync, readdirSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// Resolve sharp from the pnpm store without adding a dependency.
function resolveSharp() {
  const store = join(root, "node_modules", ".pnpm");
  for (const name of readdirSync(store)) {
    if (!name.startsWith("sharp@")) continue;
    const p = join(store, name, "node_modules", "sharp", "package.json");
    if (existsSync(p)) return require(join(store, name, "node_modules", "sharp"));
  }
  throw new Error("sharp not found in node_modules/.pnpm — run `pnpm install` first");
}
const sharp = resolveSharp();

const NAVY = "#14243A";
const brand = join(root, "packages", "brand");
const pngDir = join(brand, "icons", "png");
const webPublic = join(root, "apps", "web", "public");
const webApp = join(root, "apps", "web", "app");
mkdirSync(pngDir, { recursive: true });
mkdirSync(join(webPublic, "icons"), { recursive: true });
mkdirSync(join(webPublic, "splash"), { recursive: true });

const appIcon = readFileSync(join(brand, "icons", "app-icon.svg"));
const appIconFullbleed = readFileSync(join(brand, "icons", "app-icon-fullbleed.svg"));
const markWhite = readFileSync(join(brand, "logo", "mark-white.svg"));
const lockupReversed = readFileSync(join(brand, "logo", "wordmark-horizontal-reversed-outlined.svg"));

async function pngFromSvg(svg, size, out, { background } = {}) {
  let img = sharp(svg, { density: 300 }).resize(size, size);
  if (background) img = img.flatten({ background });
  await img.png().toFile(out);
}

/** ICO container with PNG-compressed images (what browsers expect). */
function writeIco(pngs /* [{size, buf}] */, out) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  const entries = [];
  let offset = 6 + 16 * pngs.length;
  const chunks = [header];
  for (const { size, buf } of pngs) {
    const e = Buffer.alloc(16);
    e.writeUInt8(size === 256 ? 0 : size, 0);
    e.writeUInt8(size === 256 ? 0 : size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(buf.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    chunks.push(buf);
    offset += buf.length;
  }
  writeFileSync(out, Buffer.concat([header, ...entries, ...chunks.slice(1)]));
}

async function main() {
  // --- App icons / favicons (from the navy tile mark) ---
  for (const size of [16, 32, 48, 64]) {
    await pngFromSvg(appIcon, size, join(pngDir, `favicon-${size}.png`));
  }
  await pngFromSvg(appIcon, 180, join(pngDir, "apple-touch-icon-180.png"));
  await pngFromSvg(appIcon, 192, join(pngDir, "icon-192.png"));
  await pngFromSvg(appIcon, 512, join(pngDir, "icon-512.png"));
  await pngFromSvg(appIcon, 1024, join(pngDir, "icon-1024.png"));
  await pngFromSvg(appIconFullbleed, 192, join(pngDir, "icon-maskable-192.png"));
  await pngFromSvg(appIconFullbleed, 512, join(pngDir, "icon-maskable-512.png"));
  await pngFromSvg(appIcon, 640, join(pngDir, "whatsapp-business-profile-640.png"));

  // --- favicon.ico (PNG-embedded 16/32/48) ---
  const icoPngs = [];
  for (const size of [16, 32, 48]) {
    icoPngs.push({ size, buf: await sharp(appIcon, { density: 300 }).resize(size, size).png().toBuffer() });
  }
  writeIco(icoPngs, join(brand, "icons", "favicon.ico"));

  // --- Copies into the web app ---
  for (const name of ["icon-192.png", "icon-512.png", "icon-maskable-192.png", "icon-maskable-512.png"]) {
    copyFileSync(join(pngDir, name), join(webPublic, "icons", name));
  }
  copyFileSync(join(brand, "icons", "favicon.ico"), join(webApp, "favicon.ico"));
  copyFileSync(join(pngDir, "apple-touch-icon-180.png"), join(webApp, "apple-icon.png"));

  // --- OG image 1200x630: navy + reversed outlined lockup, centred ---
  const ogLockup = await sharp(lockupReversed, { density: 300 }).resize(880).png().toBuffer();
  const ogMeta = await sharp(ogLockup).metadata();
  await sharp({ create: { width: 1200, height: 630, channels: 4, background: NAVY } })
    .composite([{ input: ogLockup, left: Math.round((1200 - ogMeta.width) / 2), top: Math.round((630 - ogMeta.height) / 2) }])
    .png().toFile(join(webPublic, "og-image.png"));

  // --- Splash screens: navy + centred white mark (mark width = 32% of the short side) ---
  const splashes = [[750, 1624], [828, 1792], [1080, 2340], [1170, 2532], [1242, 2688], [1290, 2796]];
  for (const [w, h] of splashes) {
    const markW = Math.round(Math.min(w, h) * 0.32);
    const mark = await sharp(markWhite, { density: 300 }).resize(markW).png().toBuffer();
    const meta = await sharp(mark).metadata();
    await sharp({ create: { width: w, height: h, channels: 4, background: NAVY } })
      .composite([{ input: mark, left: Math.round((w - meta.width) / 2), top: Math.round((h - meta.height) / 2) }])
      .png().toFile(join(webPublic, "splash", `splash-${w}x${h}.png`));
  }

  // --- Email header 1200x240: navy + reversed outlined lockup, centred ---
  const emailDir = join(brand, "email");
  mkdirSync(emailDir, { recursive: true });
  const emailLockup = await sharp(lockupReversed, { density: 300 }).resize(480).png().toBuffer();
  const emailMeta = await sharp(emailLockup).metadata();
  await sharp({ create: { width: 1200, height: 240, channels: 4, background: NAVY } })
    .composite([{ input: emailLockup, left: Math.round((1200 - emailMeta.width) / 2), top: Math.round((240 - emailMeta.height) / 2) }])
    .png().toFile(join(emailDir, "email-header.png"));

  console.log("regenerate-brand-assets: OK");
}
await main();
