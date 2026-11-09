/* i18n parity check: every key in `en` must exist in `zh` and vice versa,
 * and every data-i18n key used in docs/index.html must exist in the dict.
 * Fails loudly on any gap. */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { I18N } from "../site/src/i18n.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const en = Object.keys(I18N.en);
const zh = Object.keys(I18N.zh);
const missingZh = en.filter((k) => !zh.includes(k));
const missingEn = zh.filter((k) => !en.includes(k));
const html = readFileSync(path.join(root, "docs", "index.html"), "utf-8");
const used = [...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]);
const unknown = [...new Set(used)].filter((k) => !en.includes(k));

console.log(`en keys: ${en.length}, zh keys: ${zh.length}, data-i18n used: ${new Set(used).size}`);
if (missingZh.length) console.log("Missing in zh:", missingZh);
if (missingEn.length) console.log("Missing in en:", missingEn);
if (unknown.length) console.log("Used in HTML but not in dict:", unknown);
if (missingZh.length || missingEn.length || unknown.length) {
  console.error("i18n check FAILED");
  process.exit(1);
}
console.log("i18n check OK: zero missing keys");
