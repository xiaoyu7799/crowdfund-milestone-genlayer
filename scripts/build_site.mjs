/* Bundle site/src/app.js (+ i18n) into docs/app.bundle.js for GitHub Pages. */
import * as esbuild from "esbuild";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
await esbuild.build({
  entryPoints: [path.join(root, "site", "src", "app.js")],
  bundle: true,
  minify: true,
  format: "esm",
  platform: "browser",
  target: ["chrome90", "firefox90", "safari15"],
  outfile: path.join(root, "docs", "app.bundle.js"),
  logLevel: "info",
});
console.log("Built docs/app.bundle.js");
