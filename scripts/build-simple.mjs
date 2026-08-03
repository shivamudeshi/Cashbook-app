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
console.log("dist-simple/ ready");
