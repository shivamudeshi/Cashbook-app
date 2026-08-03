// Bundle simple/src/ -> dist-simple/ and copy its own PWA shell from
// simple/public/. Fully independent of scripts/build.mjs and dist/ — the
// simple app never touches the main app's build output.
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

mkdirSync("dist-simple", { recursive: true });

await build({
  entryPoints: ["simple/src/main.jsx"],
  bundle: true,
  minify: true,
  outfile: "dist-simple/app.js",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  logLevel: "info",
});

cpSync("simple/public", "dist-simple", { recursive: true });

// pdf.js parses statements in a worker; the file must ship next to app.js.
cpSync(
  "node_modules/pdfjs-dist/build/pdf.worker.min.mjs",
  "dist-simple/pdf.worker.min.mjs"
);
// Tesseract OCR assets, self-hosted so recognition is free and offline after
// first use (the service worker runtime-caches ocr/). Copied from
// node_modules at build time — none of this is committed. Same asset set
// as the main app's build.mjs, duplicated into this app's own dist-simple/
// root — nothing shared between the two builds.
mkdirSync("dist-simple/ocr", { recursive: true });
for (const f of [
  ["node_modules/tesseract.js/dist/worker.min.js", "dist-simple/ocr/worker.min.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js", "dist-simple/ocr/tesseract-core-simd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm", "dist-simple/ocr/tesseract-core-simd-lstm.wasm"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js", "dist-simple/ocr/tesseract-core-relaxedsimd-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm", "dist-simple/ocr/tesseract-core-relaxedsimd-lstm.wasm"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", "dist-simple/ocr/tesseract-core-lstm.wasm.js"],
  ["node_modules/tesseract.js-core/tesseract-core-lstm.wasm", "dist-simple/ocr/tesseract-core-lstm.wasm"],
  ["node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz", "dist-simple/ocr/eng.traineddata.gz"],
]) {
  cpSync(f[0], f[1]);
}
console.log("dist-simple/ ready");
