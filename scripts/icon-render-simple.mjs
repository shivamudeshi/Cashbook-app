// One-off icon generator for the Simple companion app (run locally, PNGs
// are committed; CI never runs it). Same approach as
// scripts/icon-render.mjs, recolored Amber Violet and set in Sora.
//
//   node scripts/icon-render-simple.mjs [path-to-chromium]
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";

const exe = process.argv[2] || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const font = readFileSync("simple/public/fonts/sora-latin-800-normal.woff2").toString("base64");

const page_html = (maskable) => `<!doctype html><html><head><style>
  @font-face {
    font-family: Sora; font-weight: 800;
    src: url(data:font/woff2;base64,${font}) format("woff2");
  }
  html, body { margin: 0; }
  .tile {
    width: 512px; height: 512px; position: relative; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    background:
      radial-gradient(90% 70% at 30% 20%, rgba(167,139,250,.4), transparent 60%),
      linear-gradient(140deg, #a78bfa 0%, #6d28d9 55%, #1c0a30 100%);
    border-radius: ${maskable ? 0 : 96}px;
  }
  .glyph {
    font-family: Sora; font-weight: 800; font-size: ${maskable ? 250 : 300}px;
    color: #ffffff; line-height: 1; position: relative; top: -6px;
    text-shadow: 0 10px 40px rgba(251,191,36,.5);
  }
  .tick {
    position: absolute; bottom: ${maskable ? 118 : 92}px; right: ${maskable ? 128 : 104}px;
    width: 74px; height: 10px; border-radius: 5px; background: #fbbf24;
    transform: rotate(-8deg); opacity: .9;
  }
</style></head><body>
  <div class="tile"><span class="glyph">₹</span><div class="tick"></div></div>
</body></html>`;

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
mkdirSync("simple/public/icons", { recursive: true });

for (const maskable of [false, true]) {
  await page.setContent(page_html(maskable));
  await page.evaluate(() => document.fonts.ready);
  const base = maskable ? "icon-maskable" : "icon";
  await page.locator(".tile").screenshot({
    path: `simple/public/icons/${base}-512.png`,
    omitBackground: !maskable,
  });
}

// Downscale 512 -> 192 with a canvas in the same browser (high quality).
for (const base of ["icon", "icon-maskable"]) {
  const b64 = readFileSync(`simple/public/icons/${base}-512.png`).toString("base64");
  await page.setContent(`<canvas id="c" width="192" height="192"></canvas>`);
  const out = await page.evaluate(async (b64) => {
    const img = new Image();
    img.src = "data:image/png;base64," + b64;
    await img.decode();
    const c = document.getElementById("c");
    const ctx = c.getContext("2d");
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, 0, 0, 192, 192);
    return c.toDataURL("image/png").split(",")[1];
  }, b64);
  writeFileSync(`simple/public/icons/${base}-192.png`, Buffer.from(out, "base64"));
}

console.log("icons rendered");
await browser.close();
