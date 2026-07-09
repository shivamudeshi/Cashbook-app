// One-off icon generator (run locally, PNGs are committed; CI never runs it).
// Renders an emerald ledger tile with the app's display face and screenshots
// it at the required sizes: icon-{192,512}.png (purpose "any", rounded look
// baked in) and icon-maskable-{192,512}.png (full-bleed, glyph in safe zone).
//
//   node scripts/icon-render.mjs [path-to-chromium]
import { chromium } from "playwright-core";
import { readFileSync, mkdirSync } from "node:fs";

const exe = process.argv[2] || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const font = readFileSync("public/fonts/space-grotesk-latin-700-normal.woff2").toString("base64");

const page_html = (maskable) => `<!doctype html><html><head><style>
  @font-face {
    font-family: SG; font-weight: 700;
    src: url(data:font/woff2;base64,${font}) format("woff2");
  }
  html, body { margin: 0; }
  .tile {
    width: 512px; height: 512px; position: relative; overflow: hidden;
    display: flex; align-items: center; justify-content: center;
    background:
      radial-gradient(90% 70% at 30% 20%, rgba(52,211,153,.32), transparent 60%),
      linear-gradient(140deg, #14432f 0%, #0d2b1e 55%, #081911 100%);
    border-radius: ${maskable ? 0 : 96}px;
  }
  .lines {
    position: absolute; left: 0; right: 0; top: 0; bottom: 0;
    background: repeating-linear-gradient(
      to bottom, transparent 0 82px, rgba(167,243,208,.10) 82px 84px);
  }
  .glyph {
    font-family: SG; font-weight: 700; font-size: ${maskable ? 250 : 300}px;
    color: #34d399; line-height: 1; position: relative; top: -6px;
    text-shadow: 0 10px 40px rgba(52,211,153,.35);
  }
  .tick {
    position: absolute; bottom: ${maskable ? 118 : 92}px; right: ${maskable ? 128 : 104}px;
    width: 74px; height: 10px; border-radius: 5px; background: #a7f3d0;
    transform: rotate(-8deg); opacity: .9;
  }
</style></head><body>
  <div class="tile"><div class="lines"></div><span class="glyph">₹</span><div class="tick"></div></div>
</body></html>`;

const browser = await chromium.launch({ executablePath: exe });
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
mkdirSync("public/icons", { recursive: true });

for (const maskable of [false, true]) {
  await page.setContent(page_html(maskable));
  await page.evaluate(() => document.fonts.ready);
  const base = maskable ? "icon-maskable" : "icon";
  await page.locator(".tile").screenshot({
    path: `public/icons/${base}-512.png`,
    omitBackground: !maskable,
  });
}

// Downscale 512 → 192 with a canvas in the same browser (high quality).
for (const base of ["icon", "icon-maskable"]) {
  const b64 = readFileSync(`public/icons/${base}-512.png`).toString("base64");
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
  const { writeFileSync } = await import("node:fs");
  writeFileSync(`public/icons/${base}-192.png`, Buffer.from(out, "base64"));
}

console.log("icons rendered");
await browser.close();
