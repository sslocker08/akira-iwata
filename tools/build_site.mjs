// content/site.json を唯一のソースとして index.html と assets/js/data.js を生成する。
// 生成ロジックの本体は assets/admin/build-core.mjs（ブラウザの編集画面プレビューと共用）。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, normalize } from "node:path";
import { buildHtml, buildDataJs } from "../assets/admin/build-core.mjs";

const ROOT = process.env.SITE_ROOT || normalize(join(fileURLToPath(import.meta.url), "..", ".."));
const site = JSON.parse(readFileSync(`${ROOT}/content/site.json`, "utf8"));

const html = buildHtml(site);
writeFileSync(`${ROOT}/index.html`, html);
writeFileSync(`${ROOT}/assets/js/data.js`, buildDataJs(site));

const plateCount = html.match(/data-lb=/g).length;
console.log(`index.html 生成: ${plateCount} data-lb / media ${site.media.length} 点`);
