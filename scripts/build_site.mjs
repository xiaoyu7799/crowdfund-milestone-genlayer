/* Bundle site/src/app.js (+ i18n) into docs/app.bundle.js for GitHub Pages.
 *
 * Cache-busting: the script tag in docs/index.html is stamped with
 * ?v=<sha256 of the bundle, first 12 hex> on every build. The bundle URL
 * must change whenever its bytes change — otherwise a browser (or edge
 * cache) keeps executing a stale bundle and the page silently shows old
 * behaviour (this bit us: commit 5254991's FINALIZED label + full contract
 * address never rendered because browsers kept the 1a5000e bundle).
 *
 * Footer guard: the visible contract address is static HTML in
 * docs/index.html (JS never overwrites the text, only the href), so the
 * build fails loudly if the static text ever drifts from config.js.
 */
import * as esbuild from "esbuild";
import { createHash } from "node:crypto";
import fs from "node:fs";
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

const bundlePath = path.join(root, "docs", "app.bundle.js");
const hash = createHash("sha256").update(fs.readFileSync(bundlePath)).digest("hex").slice(0, 12);

const htmlPath = path.join(root, "docs", "index.html");
let html = fs.readFileSync(htmlPath, "utf8");
if (!/src="app\.bundle\.js(\?v=[0-9a-f]+)?"/.test(html)) {
  throw new Error("docs/index.html does not load app.bundle.js — refusing to stamp");
}
html = html.replace(/src="app\.bundle\.js(\?v=[0-9a-f]+)?"/, `src="app.bundle.js?v=${hash}"`);
fs.writeFileSync(htmlPath, html);

// Footer guard: static link text must equal the configured contract address.
const config = fs.readFileSync(path.join(root, "docs", "config.js"), "utf8");
const addr = config.match(/contractAddress:\s*"([^"]+)"/)?.[1];
if (!addr) throw new Error("could not read contractAddress from docs/config.js");
const footer = html.match(/<a id="contract-link"[^>]*>([^<]*)<\/a>/);
if (!footer || footer[1] !== addr) {
  throw new Error(
    `footer contract-link text (${footer?.[1] ?? "missing"}) does not match docs/config.js contractAddress (${addr}) — fix docs/index.html`,
  );
}
console.log(`Built docs/app.bundle.js (v=${hash}); footer address matches config`);
