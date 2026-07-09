// Bundle src/ -> dist/ and copy the PWA shell from public/.
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist", { recursive: true });

await build({
  entryPoints: ["src/main.jsx"],
  bundle: true,
  minify: true,
  outfile: "dist/app.js",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

cpSync("public", "dist", { recursive: true });
// pdf.js parses statements in a worker; the file must ship next to app.js.
cpSync(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "dist/pdf.worker.min.mjs"
);
// Tesseract OCR assets, self-hosted so recognition is free and offline after
// first use (the service worker runtime-caches ocr/). Copied from
// node_modules at build time — none of this is committed.
mkdirSync("dist/ocr", { recursive: true });
// All lstm core variants: the browser picks one (simd / relaxedsimd / plain)
// at runtime and only downloads that one.
for (const f of [
  ["node_modules/tesseract.js/dist/worker.min.js", "dist/ocr/worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "dist/ocr/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm", "dist/ocr/tesseract-core-simd-lstm.wasm"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "dist/ocr/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm", "dist/ocr/tesseract-core-relaxedsimd-lstm.wasm"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "dist/ocr/tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm", "dist/ocr/tesseract-core-lstm.wasm"],
  ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "dist/ocr/eng.traineddata.gz"],
]) {
  cpSync(f[0], f[1]);
}
console.log("dist/ ready");
