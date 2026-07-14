// content/site.json を唯一のソースとして index.html と assets/js/data.js を生成する。
// 見た目は現行を忠実に再現。--ar と width/height は media の実寸から算出。
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, normalize } from "node:path";

const ROOT = process.env.SITE_ROOT || normalize(join(fileURLToPath(import.meta.url), "..", ".."));
const site = JSON.parse(readFileSync(`${ROOT}/content/site.json`, "utf8"));
const M = Object.fromEntries(site.media.map(m => [m.id, m]));

const esc = s => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const ar = id => (M[id].w / M[id].h).toFixed(3);

function imgTag(id, { eager = false, cls = "" } = {}) {
  const m = M[id];
  const load = eager
    ? `fetchpriority="high" decoding="async"`
    : `loading="lazy" decoding="async"`;
  return `<img src="img/works/${id}.jpg" alt="${esc(m.alt)}" width="${m.w}" height="${m.h}" ${load}>`;
}

function plate(id) {
  return `      <figure class="plate" style="--ar:${ar(id)}" data-reveal>
        <button type="button" data-lb="${id}">
          ${imgTag(id)}
        </button>
      </figure>`;
}

function bleed(id, cover) {
  const cls = cover ? "plate bleed bleed-photo bleed-photo--cover" : "plate bleed bleed-photo";
  return `  <figure class="${cls}" data-reveal>
    <button type="button" data-lb="${id}">
      ${imgTag(id)}
    </button>
  </figure>`;
}

function byobu(id) {
  return `    <div class="byobu-wrap" data-reveal>
      <div class="byobu" tabindex="0" role="region" aria-label="横にスクロールできます">
        <div class="byobu__inner">
          ${imgTag(id)}
          <div class="byobu__folds" aria-hidden="true"></div>
        </div>
      </div>
      <p class="byobu-hint" aria-hidden="true">→</p>
    </div>`;
}

function head(sec) {
  const sub = sec.sub ? `\n      <p class="maku-sub" data-reveal>${esc(sec.sub)}</p>` : "";
  return `    <div class="act__head">
      <h2 class="maku-title" data-maku data-px="-0.04">${esc(sec.title)}</h2>${sub}
    </div>`;
}

function actSection(sec) {
  let out = `<section class="act" id="${sec.id}" data-theme="${sec.theme}" data-actzone="${sec.theme}">\n`;
  let inSpine = false;
  const openSpine = () => { if (!inSpine) { out += `  <div class="spine">\n`; inSpine = true; } };
  const closeSpine = () => { if (inSpine) { out += `  </div>\n`; inSpine = false; } };
  openSpine();
  out += head(sec) + "\n";
  for (const b of sec.blocks) {
    if (b.type === "row") { openSpine(); out += `    <div class="row">\n${b.items.map(plate).join("\n")}\n    </div>\n`; }
    else if (b.type === "byobu") { openSpine(); out += byobu(b.id) + "\n"; }
    else if (b.type === "bleed") { closeSpine(); out += bleed(b.id, false) + "\n"; }
    else if (b.type === "bleed-cover") { closeSpine(); out += bleed(b.id, true) + "\n"; }
  }
  closeSpine();
  out += `</section>`;
  return out;
}

function kureSection(sec) {
  return `<section class="kure" id="${sec.id}" aria-label="幕間">
  <div class="kure__zone kure__zone--paper" data-actzone="paper" aria-hidden="true"></div>
  <div class="kure__zone kure__zone--night" data-actzone="night" aria-hidden="true"></div>
  <div class="kure__stage">
    ${imgTag(sec.image)}
    <div class="kure__veil" aria-hidden="true"></div>
  </div>
</section>`;
}

function profileSection(sec) {
  const p = sec.profile;
  const groups = p.groups.map(g =>
    `        <h3>${esc(g.heading)}</h3>\n        <ul>\n` +
    g.items.map(it =>
      `          <li>${it.label ? `<b>${esc(it.label)}</b>` : ""}<span>${esc(it.text)}</span></li>`
    ).join("\n") + `\n        </ul>`
  ).join("\n");
  return `<section class="act shirusu" id="${sec.id}" data-theme="${sec.theme}" data-actzone="${sec.theme}">
  <div class="spine">
${head(sec)}
    <div class="shirusu__grid">
      <figure class="plate shirusu__photo" data-reveal>
        <button type="button" data-lb="${sec.photo}">
          ${imgTag(sec.photo)}
        </button>
      </figure>
      <div data-reveal>
        <h3>${esc(p.name)} <small>${esc(p.roman)}</small></h3>
${groups}
        <!-- CONTACT: 掲載情報が確定したらここに -->
      </div>
    </div>
  </div>
</section>`;
}

function gallerySection(sec) {
  return `<section class="act kura" id="${sec.id}" data-theme="${sec.theme}" data-actzone="${sec.theme}">
  <div class="spine">
${head(sec)}
    <noscript><p>一覧の表示にはJavaScriptを使用します。画像は img/works/ フォルダから直接ご覧いただけます。</p></noscript>
    <div class="kura__grid" id="kura-grid"></div>
  </div>
</section>`;
}

function renderSection(sec) {
  if (sec.type === "kure") return kureSection(sec);
  if (sec.type === "profile") return profileSection(sec);
  if (sec.type === "gallery") return gallerySection(sec);
  return actSection(sec);
}

const nav = site.sections
  .filter(s => s.type !== "kure")
  .map((s, i) => `  <a href="#${s.id}" aria-label="${esc(s.title)}">${i + 1}</a>`)
  .join("\n");

const cover = site.cover;
const cm = M[cover.id];

const main = site.sections.map(renderSection).join("\n\n");

const html = `<!DOCTYPE html>
<html lang="ja" data-act="paper">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>岩田暉良 作品集</title>
<meta name="description" content="デザイナー岩田暉良の作品集。">
<link rel="icon" href='data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="8" fill="%23b3392b"/></svg>'>
<link rel="stylesheet" href="assets/css/style.css">
</head>
<body>
<!-- このファイルは tools/build_site.mjs による自動生成物。直接編集せず content/site.json を編集して再生成すること。 -->

<div class="bg" aria-hidden="true">
  <div class="bg__paper"></div>
  <div class="bg__night"></div>
</div>

<nav class="nav" aria-label="索引">
${nav}
</nav>

<!-- ═══ 表紙 ═══ -->
<header class="act" data-theme="paper" data-actzone="paper">
  <div class="spine hyoshi">
    <figure class="plate hyoshi__art" data-reveal>
      <button type="button" data-lb="${cover.id}" data-px="0.12">
        <img src="img/works/${cover.id}.jpg" alt="${esc(cm.alt)}" width="${cm.w}" height="${cm.h}" fetchpriority="high" decoding="async">
      </button>
    </figure>
    <div class="hyoshi__title-block" data-px="-0.06">
      <p class="hyoshi__sub">${esc(cover.roman)}</p>
      <h1 class="hyoshi__title">${esc(cover.name)}</h1>
    </div>
  </div>
</header>

<main>

${main}

</main>

<!-- ═══ 奥付 ═══ -->
<footer class="okuzuke" data-theme="paper" data-actzone="paper">
  <div class="spine">
    <p>${esc(site.footer)}</p>
  </div>
</footer>

<!-- ライトボックス -->
<dialog class="lb" aria-label="作品ビューア">
  <div class="lb__stage">
    <img class="lb__img" alt="">
    <button type="button" class="lb__close" aria-label="閉じる">✕</button>
    <button type="button" class="lb__prev" aria-label="前へ">←</button>
    <button type="button" class="lb__next" aria-label="次へ">→</button>
  </div>
</dialog>

<script defer src="assets/js/data.js"></script>
<script defer src="assets/js/main.js"></script>
</body>
</html>
`;

writeFileSync(`${ROOT}/index.html`, html);

// data.js（実行時の媒体グローバル: gallery と lightbox が参照）
const dataLines = site.media.map(m =>
  "  " + JSON.stringify({ id: m.id, act: m.id.split("-")[0], n: +m.id.split("-")[1], w: m.w, h: m.h, color: m.color }, null, 0)
).join(",\n");
writeFileSync(`${ROOT}/assets/js/data.js`,
  "// 収蔵目録データ（tools/build_site.mjs が content/site.json から生成）\nconst WORKS = [\n" + dataLines + ",\n];\n");

const plateCount = html.match(/data-lb=/g).length;
console.log(`index.html 生成: ${plateCount} data-lb / media ${site.media.length} 点`);
