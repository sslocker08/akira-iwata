"use strict";
/* 作品集 ローカル編集画面。tools/serve-admin.mjs（localhost:4321）と通信する。
   すべてのブロック（行/全幅/全画面/屏風）・単独スロット（表紙/リード/プロフィール写真）・
   ギャラリーを、同一のドラッグ&ドロップ機構で扱う。 */

const $ = s => document.querySelector(s);
const api = (path, opts) => fetch(path, opts).then(async r => {
  const t = await r.text();
  let j = {}; try { j = t ? JSON.parse(t) : {}; } catch {}
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
});
const thumb = id => `img/thumbs/${id}.jpg`;
const work = id => `img/works/${id}.jpg`;

let site = null;
let sel = null;      // 現在選択中の画像id（説明文編集パネル用）
let selLoc = null;
let tray = [];        // アップロード直後、未配置の画像id一覧
let drag = null;      // 進行中のドラッグのペイロード

/* ---------- 起動 ---------- */
(async function boot() {
  try { site = await api("/api/site"); }
  catch (e) {
    document.getElementById("boot").classList.add("error");
    $("#bootMsg").textContent = "ヘルパに接続できません（" + e.message + "）";
    return;
  }
  if (!site.gallery) site.gallery = site.media.map(m => m.id);
  $("#boot").hidden = true;
  $("#app").hidden = false;
  wireGlobal();
  render();
})();

function status(msg, cls = "") { const s = $("#status"); s.textContent = msg; s.className = "topbar__status " + cls; }
const mediaOf = id => site.media.find(m => m.id === id);

/* ---------- データアクセス（block / field 共通ロケータ） ---------- */
// loc: {field:'cover'} | {si, field:'lead'|'photo'} | {si, bi, ii?}
function getAt(loc) {
  if (loc.field === "cover") return site.cover.id;
  const s = site.sections[loc.si];
  if (loc.field === "lead") return s.lead;
  if (loc.field === "photo") return s.photo;
  const b = s.blocks[loc.bi];
  return loc.ii == null ? b.id : b.items[loc.ii];
}
function setAt(loc, id) {
  if (loc.field === "cover") { site.cover.id = id; return; }
  const s = site.sections[loc.si];
  if (loc.field === "lead") { s.lead = id; return; }
  if (loc.field === "photo") { s.photo = id; return; }
  const b = s.blocks[loc.bi];
  if (loc.ii == null) b.id = id; else b.items[loc.ii] = id;
}
function isRowSlot(loc) { return loc.bi != null && loc.ii != null; }

/* ---------- 全体UI ---------- */
function wireGlobal() {
  $("#btnSave").addEventListener("click", save);
  $("#btnPublish").addEventListener("click", publish);
  $("#selAlt").addEventListener("input", e => { if (sel) { const m = mediaOf(sel); if (m) m.alt = e.target.value; } });
  $("#selDelete").addEventListener("click", deleteSelected);
  $("#selClose").addEventListener("click", closeSelPanel);

  const fi = $("#fileInput");
  document.addEventListener("dragover", e => { if ([...e.dataTransfer.types].includes("Files")) e.preventDefault(); });
  document.addEventListener("drop", e => {
    if ([...e.dataTransfer.types].includes("Files") && e.dataTransfer.files.length) {
      e.preventDefault();
      [...e.dataTransfer.files].forEach(f => f.type.startsWith("image/") && uploadFile(f));
    }
  });
  fi.addEventListener("change", () => { [...fi.files].forEach(uploadFile); fi.value = ""; });
}

async function save() {
  pruneEmptyRows();
  try { status("保存中…"); await api("/api/save", { method: "POST", body: JSON.stringify(site) }); status("保存しました", "ok"); }
  catch (e) { status("保存に失敗: " + e.message, "err"); }
}
async function publish() {
  if (!confirm("現在の内容を本番サイトへ公開します。よろしいですか？")) return;
  pruneEmptyRows();
  try {
    status("公開中… (保存→本番反映)");
    await api("/api/save", { method: "POST", body: JSON.stringify(site) });
    const r = await api("/api/publish", { method: "POST", body: JSON.stringify({ message: "作品集を更新" }) });
    status("公開しました。数分で本番に反映されます。", "ok");
    console.log(r.log);
  } catch (e) { status("公開に失敗: " + e.message, "err"); }
}

async function uploadFile(f, act = "ex") {
  try {
    status("画像を最適化してアップロード中…");
    const buf = await f.arrayBuffer();
    const r = await api(`/api/upload?act=${act}`, { method: "POST", body: buf });
    site = await api("/api/site");
    if (!site.gallery) site.gallery = site.media.map(m => m.id);
    tray.push(r.media.id);
    status(`追加しました（${r.media.id}）— ドラッグして配置してください`, "ok");
    render();
  } catch (e) { status("追加に失敗: " + e.message, "err"); }
}

/* ---------- 選択パネル ---------- */
function selectItem(id) {
  sel = id;
  const m = mediaOf(id) || { alt: "" };
  $("#selPanel").hidden = false;
  $("#selImg").src = thumb(id);
  $("#selId").textContent = id;
  $("#selAlt").value = m.alt || "";
}
function closeSelPanel() { sel = null; $("#selPanel").hidden = true; }
async function deleteSelected() {
  if (!sel) return;
  if (!confirm(`${sel} を完全に削除します（画像ファイルも消えます）。よろしいですか？`)) return;
  try {
    status("削除中…");
    await api("/api/delete-image", { method: "POST", body: JSON.stringify({ id: sel }) });
    site = await api("/api/site");
    if (!site.gallery) site.gallery = site.media.map(m => m.id);
    tray = tray.filter(x => x !== sel);
    closeSelPanel();
    status("削除しました", "ok"); render();
  } catch (e) { status("削除に失敗: " + e.message, "err"); }
}

/* =========================================================
   ドラッグ&ドロップ（統一機構）
   drag = { kind:'loc', loc } | { kind:'tray', id } | { kind:'gallery', idx }
========================================================= */
function dragStartFrom(e, payload) {
  drag = payload;
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", "drag");
  e.currentTarget.classList.add("dragging");
}
function dragEndClear(e) {
  e.currentTarget.classList.remove("dragging");
  document.querySelectorAll(".drag-hot,.gap-hot,.dragging-block").forEach(x => x.classList.remove("drag-hot", "gap-hot", "dragging-block"));
  drag = null;
}
function idOfDrag() {
  if (!drag) return null;
  if (drag.kind === "loc") return getAt(drag.loc);
  if (drag.kind === "tray") return drag.id;
  if (drag.kind === "gallery") return site.gallery[drag.idx];
  return null;
}
// 出発地点から画像を取り除く（moveのみ。swapは呼び出し側で戻す）
function removeDragSource() {
  if (drag.kind === "tray") { tray = tray.filter(x => x !== drag.id); return; }
  if (drag.kind === "gallery") { site.gallery.splice(drag.idx, 1); return; }
  if (drag.kind === "loc" && isRowSlot(drag.loc)) {
    const b = site.sections[drag.loc.si].blocks[drag.loc.bi];
    b.items.splice(drag.loc.ii, 1);
  }
  // loc かつ単独スロット(bleed/bleed-cover/byobu/cover/lead/photo) の場合は setAt で上書きされるので何もしない
}
// dragの出発点に「戻す」画像（swap時の押し出し先が無い場合は tray へ）
function returnToSource(oldId) {
  if (!oldId) return;
  if (drag.kind === "tray" || drag.kind === "gallery") { tray.push(oldId); return; }
  if (drag.kind === "loc") {
    if (isRowSlot(drag.loc)) { tray.push(oldId); return; } // 行アイテムの元位置は既に詰まっているのでトレイへ
    setAt(drag.loc, oldId); // 単独スロットは元の場所へ戻す（=スワップ）
  }
}

// 単独スロット（全幅/全画面/屏風/表紙/リード/写真）への「差し替え」ドロップ
function dropOnSingle(dstLoc) {
  if (!drag) return;
  const newId = idOfDrag();
  if (!newId) return;
  const oldId = getAt(dstLoc);
  removeDragSource();
  setAt(dstLoc, newId);
  returnToSource(oldId);
  render();
}
// 行内の特定チップへの「差し替え」ドロップ（行アイテム同士 or 単独スロットの画像を持ってきた場合）
function dropOnRowSlot(dstLoc) {
  if (!drag) return;
  const newId = idOfDrag();
  if (!newId) return;
  if (drag.kind === "loc" && isRowSlot(drag.loc) && drag.loc.si === dstLoc.si && drag.loc.bi === dstLoc.bi) {
    // 同じ行内の並べ替え
    const b = site.sections[dstLoc.si].blocks[dstLoc.bi];
    const [moved] = b.items.splice(drag.loc.ii, 1);
    let idx = dstLoc.ii;
    if (drag.loc.ii < dstLoc.ii) idx--;
    b.items.splice(idx, 0, moved);
    render(); return;
  }
  const oldId = getAt(dstLoc);
  removeDragSource();
  setAt(dstLoc, newId);
  returnToSource(oldId);
  render();
}
// 行の隙間・末尾への「挿入」ドロップ（差し替えではなく増える）
function dropIntoRowGap(si, bi, insertIndex) {
  if (!drag) return;
  const newId = idOfDrag();
  if (!newId) return;
  if (drag.kind === "loc" && isRowSlot(drag.loc)) {
    const from = site.sections[drag.loc.si].blocks[drag.loc.bi].items;
    const [moved] = from.splice(drag.loc.ii, 1);
    const to = site.sections[si].blocks[bi].items;
    let idx = insertIndex;
    if (drag.loc.si === si && drag.loc.bi === bi && drag.loc.ii < insertIndex) idx--;
    to.splice(idx, 0, moved);
  } else {
    removeDragSource();
    site.sections[si].blocks[bi].items.splice(insertIndex, 0, newId);
  }
  render();
}
// ギャラリーへの挿入（既存グリッド内ドラッグは並べ替え、他所からは追加。画像は消えない＝コピー的扱い）
function dropIntoGallery(insertIndex) {
  if (!drag) return;
  const newId = idOfDrag();
  if (!newId) return;
  if (drag.kind === "gallery") {
    const [moved] = site.gallery.splice(drag.idx, 1);
    let idx = insertIndex;
    if (drag.idx < insertIndex) idx--;
    site.gallery.splice(idx, 0, moved);
  } else if (!site.gallery.includes(newId)) {
    site.gallery.splice(insertIndex, 0, newId);
  }
  render();
}

/* ---------- ブロック（行）ドラッグ並べ替え ---------- */
let blockDrag = null; // {si, bi}
function blockDragStart(e, si, bi) {
  blockDrag = { si, bi };
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", "block");
  e.stopPropagation();
  requestAnimationFrame(() => e.target.closest(".ed-block").classList.add("dragging-block"));
}
function blockDragEnd() {
  document.querySelectorAll(".dragging-block,.gap-hot").forEach(x => x.classList.remove("dragging-block", "gap-hot"));
  blockDrag = null;
}
function moveBlock(si, destIndex) {
  if (!blockDrag || blockDrag.si !== si) return;
  const blocks = site.sections[si].blocks;
  const [moved] = blocks.splice(blockDrag.bi, 1);
  let idx = destIndex;
  if (blockDrag.bi < destIndex) idx--;
  blocks.splice(Math.max(0, Math.min(idx, blocks.length)), 0, moved);
  render();
}

/* ---------- レンダリング ---------- */
function render() {
  renderTray();
  const canvas = $("#canvas");
  canvas.innerHTML = "";
  canvas.appendChild(renderCover());
  site.sections.forEach((s, si) => canvas.appendChild(renderSection(s, si)));
}

function renderTray() {
  const box = $("#tray"), items = $("#trayItems");
  box.hidden = tray.length === 0;
  items.innerHTML = "";
  tray.forEach(id => {
    const chip = makeImgChip(id, { kind: "tray", id });
    chip.classList.add("chip");
    items.appendChild(chip);
  });
}

function renderCover() {
  const sec = div("ed-sec");
  const head = div("ed-sec__head");
  head.innerHTML = `<span class="ed-sec__badge">表紙</span>`;
  const nameI = input(site.cover.name, ""); nameI.placeholder = "氏名"; nameI.style.width = "8rem";
  nameI.addEventListener("input", e => site.cover.name = e.target.value);
  const romanI = input(site.cover.roman, ""); romanI.placeholder = "ローマ字"; romanI.style.width = "10rem";
  romanI.addEventListener("input", e => site.cover.roman = e.target.value);
  head.append(nameI, romanI);
  sec.appendChild(head);

  const stage = div("ed-stage"); stage.dataset.theme = "paper";
  const scale = div("ed-imgscale");
  const spine = div("spine");
  const grid = div("row");
  const loc = { field: "cover" };
  grid.appendChild(makeBlockImage(site.cover.id, loc, "plate"));
  spine.appendChild(grid);
  scale.appendChild(spine);
  stage.appendChild(scale);
  sec.appendChild(stage);
  return sec;
}

function renderSection(s, si) {
  const sec = div("ed-sec");
  const head = div("ed-sec__head"); head.dataset.theme = s.theme;
  head.innerHTML = `<span class="ed-sec__badge">${si + 1}</span>`;
  if (s.type !== "gallery") {
    const t = input(s.title || "", "ed-sec__title"); t.placeholder = "見出し";
    t.addEventListener("input", e => s.title = e.target.value); head.appendChild(t);
  }
  if (s.blocks) {
    const sub = input(s.sub || "", "ed-sec__sub"); sub.placeholder = "サブラベル（任意）";
    sub.addEventListener("input", e => s.sub = e.target.value); head.appendChild(sub);
  }
  const note = document.createElement("span"); note.className = "ed-sec__note";
  note.textContent = s.type === "gallery" ? "全画像一覧（並べ替え・追加削除可）" : s.type === "profile" ? "プロフィール" : "";
  head.appendChild(note);
  sec.appendChild(head);

  const stage = div("ed-stage"); stage.dataset.theme = s.theme || "paper";

  if (s.type === "profile") stage.appendChild(renderProfileStage(s, si));
  else if (s.type === "gallery") stage.appendChild(renderGalleryStage());
  else stage.appendChild(renderBlocksStage(s, si));

  sec.appendChild(stage);
  return sec;
}

function renderBlocksStage(s, si) {
  const holder = div("");
  const spine = div("spine");
  s.blocks.forEach((b, bi) => {
    spine.appendChild(blockGap(si, bi));
    spine.appendChild(renderBlock(s, si, b, bi));
  });
  spine.appendChild(blockGap(si, s.blocks.length));
  holder.appendChild(spine);
  const add = document.createElement("button");
  add.className = "ed-add-row"; add.textContent = "＋ 行を追加";
  add.addEventListener("click", () => { s.blocks.push({ type: "row", items: [] }); render(); });
  holder.appendChild(add);
  return holder;
}

function blockGap(si, index) {
  const g = div("ed-block__drop");
  g.style.position = "relative"; g.style.height = "10px";
  g.addEventListener("dragover", e => {
    if (!blockDrag || blockDrag.si !== si) return;
    e.preventDefault(); g.classList.add("gap-hot");
  });
  g.addEventListener("dragleave", () => g.classList.remove("gap-hot"));
  g.addEventListener("drop", e => { e.preventDefault(); g.classList.remove("gap-hot"); moveBlock(si, index); });
  return g;
}

function renderBlock(s, si, b, bi) {
  const wrap = div("ed-block");
  const bar = div("ed-block__bar");
  const handle = document.createElement("span");
  handle.className = "ed-handle"; handle.textContent = "⠿ 移動"; handle.draggable = true;
  handle.addEventListener("dragstart", e => blockDragStart(e, si, bi));
  handle.addEventListener("dragend", blockDragEnd);
  const typeSel = document.createElement("select");
  typeSel.className = "ed-type";
  typeSel.innerHTML = `<option value="row">行（複数）</option><option value="bleed">全幅</option><option value="bleed-cover">全画面</option><option value="byobu">屏風</option>`;
  typeSel.value = b.type;
  typeSel.addEventListener("change", () => changeBlockType(s, bi, typeSel.value));
  const del = document.createElement("button");
  del.className = "ed-del"; del.textContent = "削除"; del.type = "button";
  del.addEventListener("click", () => { s.blocks.splice(bi, 1); render(); });
  bar.append(handle, typeSel, del);
  wrap.appendChild(bar);

  const content = div("ed-imgscale");
  if (b.type === "row") content.appendChild(renderRow(si, bi, b));
  else if (b.type === "byobu") content.appendChild(renderByobuLike(si, bi, b));
  else content.appendChild(renderSingleFull(si, bi, b, b.type === "bleed-cover"));
  wrap.appendChild(content);
  return wrap;
}

function changeBlockType(s, bi, newType) {
  const b = s.blocks[bi];
  if (newType === "row") {
    s.blocks[bi] = { type: "row", items: b.id ? [b.id] : [] };
  } else {
    if (b.items) {
      const first = b.items[0];
      tray.push(...b.items.slice(1).filter(Boolean));
      s.blocks[bi] = { type: newType, id: first || "" };
    } else {
      b.type = newType;
    }
  }
  render();
}

function renderRow(si, bi, b) {
  const row = div("row");
  b.items.forEach((id, ii) => row.appendChild(makeBlockImage(id, { si, bi, ii }, "plate")));
  const tail = div("ed-row-tail"); tail.textContent = "＋";
  tail.addEventListener("dragover", e => { e.preventDefault(); tail.classList.add("drag-hot"); });
  tail.addEventListener("dragleave", () => tail.classList.remove("drag-hot"));
  tail.addEventListener("drop", e => { e.preventDefault(); tail.classList.remove("drag-hot"); dropIntoRowGap(si, bi, b.items.length); });
  row.appendChild(tail);
  return row;
}

function renderSingleFull(si, bi, b, cover) {
  const fig = div(`bleed bleed-photo${cover ? " bleed-photo--cover" : ""}`);
  fig.appendChild(makeBlockImage(b.id, { si, bi }, "plain"));
  return fig;
}

function renderByobuLike(si, bi, b) {
  const wrap = div("byobu-wrap");
  const byobu = div("byobu");
  const inner = div("byobu__inner");
  inner.appendChild(makeBlockImage(b.id, { si, bi }, "plain"));
  byobu.appendChild(inner);
  wrap.appendChild(byobu);
  return wrap;
}

// 単独スロット/行アイテム共通の画像描画（loc に応じ figure or bare img）
function makeBlockImage(id, loc, kind) {
  const isRow = isRowSlot(loc);
  const el = kind === "plate" ? document.createElement("figure") : (kind === "plain" ? document.createElement("div") : document.createElement("figure"));
  el.className = kind === "plate" ? "plate ed-img-wrap" : "ed-img-wrap";
  if (kind === "plate" && id) { const m = mediaOf(id); if (m) el.style.setProperty("--ar", (m.w / m.h).toFixed(3)); }
  el.appendChild(makeImgEl(id));
  wireDnD(el, loc, isRow, kind === "plate");
  return el;
}
function makeImgEl(id) {
  const img = document.createElement("img");
  if (id) { img.src = work(id); img.alt = ""; img.loading = "lazy"; }
  else { img.alt = "(未設定)"; }
  return img;
}
function wireDnD(el, loc, isRow, allowGapDrop) {
  const id = getAt(loc);
  el.draggable = !!id;
  el.addEventListener("dragstart", e => { if (!id) return e.preventDefault(); dragStartFrom(e, { kind: "loc", loc }); });
  el.addEventListener("dragend", dragEndClear);
  el.addEventListener("dragover", e => {
    e.preventDefault();
    const before = allowGapDrop && isOverLeftHalf(e, el);
    el.classList.toggle("drag-hot", true);
    el.dataset.gapBefore = before ? "1" : "0";
  });
  el.addEventListener("dragleave", () => el.classList.remove("drag-hot"));
  el.addEventListener("drop", e => {
    e.preventDefault(); el.classList.remove("drag-hot");
    if (!drag) return;
    if (isRow) {
      if (allowGapDrop && el.dataset.gapBefore === "1" && !(drag.kind === "loc" && drag.loc.si === loc.si && drag.loc.bi === loc.bi && drag.loc.ii === loc.ii)) {
        // 左半分へのドロップ = そのチップの手前へ挿入（差し替えではなく増える）
        if (drag.kind === "loc" && isRowSlot(drag.loc)) dropIntoRowGap(loc.si, loc.bi, loc.ii);
        else dropOnRowSlot(loc); // 単独由来は差し替え扱い
      } else {
        dropOnRowSlot(loc);
      }
    } else {
      dropOnSingle(loc);
    }
  });
  el.addEventListener("click", () => { if (id) selectItem(id); });
  const editBtn = document.createElement("button");
  editBtn.type = "button"; editBtn.className = "ed-edit"; editBtn.textContent = "説明文";
  editBtn.addEventListener("click", ev => { ev.stopPropagation(); if (id) selectItem(id); });
  if (id) el.appendChild(editBtn);
}
function isOverLeftHalf(e, el) {
  const r = el.getBoundingClientRect();
  return (e.clientX - r.left) < r.width / 2;
}

/* ---------- プロフィール ---------- */
function renderProfileStage(s, si) {
  const outer = div("");
  const scale = div("ed-imgscale");

  if (s.lead) {
    const fig = div("bleed bleed-photo bleed-photo--cover");
    fig.appendChild(makeBlockImage(s.lead, { si, field: "lead" }, "plain"));
    scale.appendChild(fig);
  } else {
    const spine0 = div("spine");
    const dz = div("ed-row-tail"); dz.textContent = "＋ リード画像";
    dz.style.inlineSize = "100%"; dz.style.minBlockSize = "80px";
    dz.addEventListener("dragover", e => { e.preventDefault(); dz.classList.add("drag-hot"); });
    dz.addEventListener("dragleave", () => dz.classList.remove("drag-hot"));
    dz.addEventListener("drop", e => { e.preventDefault(); dz.classList.remove("drag-hot"); dropOnSingle({ si, field: "lead" }); });
    spine0.appendChild(dz);
    scale.appendChild(spine0);
  }

  const spine = div("spine");
  const grid = div("row");
  grid.appendChild(makeBlockImage(s.photo, { si, field: "photo" }, "plate"));
  spine.appendChild(grid);
  scale.appendChild(spine);
  outer.appendChild(scale);

  const p = s.profile;
  const pf = div("ed-profile");
  const line1 = div("row2");
  const nameI = input(p.name, ""); nameI.addEventListener("input", e => p.name = e.target.value);
  const romanI = input(p.roman, ""); romanI.addEventListener("input", e => p.roman = e.target.value);
  line1.append(labeledInput("氏名", nameI), labeledInput("ローマ字", romanI));
  pf.appendChild(line1);

  p.groups.forEach((g, gi) => {
    const hi = input(g.heading, ""); hi.addEventListener("input", e => g.heading = e.target.value);
    pf.appendChild(labeledInput("見出し", hi));
    g.items.forEach((it, ii) => {
      const line = div("edu-line");
      if ("label" in it) {
        const lb = input(it.label || "", ""); lb.placeholder = "年";
        lb.addEventListener("input", e => it.label = e.target.value); line.appendChild(lb);
      }
      const tx = input(it.text, ""); tx.addEventListener("input", e => it.text = e.target.value);
      line.appendChild(tx);
      const del = document.createElement("button"); del.className = "item-del"; del.textContent = "×"; del.type = "button";
      del.addEventListener("click", () => { g.items.splice(ii, 1); render(); });
      line.appendChild(del);
      pf.appendChild(line);
    });
    const add = document.createElement("button"); add.className = "item-add"; add.type = "button"; add.textContent = "＋ 項目を追加";
    add.addEventListener("click", () => { g.items.push({ text: "" }); render(); });
    pf.appendChild(add);
  });

  outer.appendChild(pf);
  return outer;
}

/* ---------- ギャラリー ---------- */
function renderGalleryStage() {
  const wrap = div("ed-gallery");
  const ctrl = div("ed-gallery__ctrl");
  ctrl.innerHTML = `<label>サムネイルの大きさ <input type="range" id="gallerySize" min="56" max="220" value="96"></label>`;
  const count = document.createElement("span"); count.className = "ed-gallery__count";
  count.textContent = `${site.gallery.length} 点`;
  ctrl.appendChild(count);
  wrap.appendChild(ctrl);

  const grid = div("ed-gallery__grid");
  grid.style.setProperty("--gallery-cell", "96px");
  ctrl.querySelector("#gallerySize").addEventListener("input", e => {
    grid.style.setProperty("--gallery-cell", e.target.value + "px");
  });

  site.gallery.forEach((id, idx) => {
    const cell = div("ed-gallery__cell");
    cell.draggable = true;
    const img = document.createElement("img"); img.src = thumb(id); img.alt = ""; img.loading = "lazy";
    cell.appendChild(img);
    const x = document.createElement("button"); x.className = "ed-gallery__x"; x.type = "button"; x.textContent = "✕";
    x.addEventListener("click", ev => { ev.stopPropagation(); sel = id; deleteSelected(); });
    cell.appendChild(x);
    cell.addEventListener("click", () => selectItem(id));
    cell.addEventListener("dragstart", e => dragStartFrom(e, { kind: "gallery", idx }));
    cell.addEventListener("dragend", dragEndClear);
    cell.addEventListener("dragover", e => { e.preventDefault(); cell.classList.add("drag-hot"); });
    cell.addEventListener("dragleave", () => cell.classList.remove("drag-hot"));
    cell.addEventListener("drop", e => {
      e.preventDefault(); cell.classList.remove("drag-hot");
      const before = isOverLeftHalf(e, cell);
      dropIntoGallery(before ? idx : idx + 1);
    });
    grid.appendChild(cell);
  });

  const addCell = div("ed-gallery__add"); addCell.textContent = "＋";
  addCell.addEventListener("click", () => $("#fileInput").click());
  addCell.addEventListener("dragover", e => { e.preventDefault(); addCell.classList.add("drag-hot"); });
  addCell.addEventListener("dragleave", () => addCell.classList.remove("drag-hot"));
  addCell.addEventListener("drop", e => { e.preventDefault(); addCell.classList.remove("drag-hot"); dropIntoGallery(site.gallery.length); });
  grid.appendChild(addCell);

  wrap.appendChild(grid);
  return wrap;
}

/* ---------- 部品 ---------- */
function makeImgChip(id) {
  const c = div("chip ed-img-wrap");
  c.style.cssText = "width:84px;height:84px;position:relative;";
  const img = document.createElement("img");
  img.src = thumb(id); img.alt = ""; img.style.cssText = "width:100%;height:100%;object-fit:cover;cursor:grab;";
  c.appendChild(img);
  c.draggable = true;
  c.addEventListener("dragstart", e => dragStartFrom(e, { kind: "tray", id }));
  c.addEventListener("dragend", dragEndClear);
  c.addEventListener("click", () => selectItem(id));
  return c;
}
function div(cls) { const d = document.createElement("div"); if (cls) d.className = cls; return d; }
function input(v, cls) { const i = document.createElement("input"); i.value = v; if (cls) i.className = cls; return i; }
function labeledInput(labelText, node) {
  const w = div(""); w.style.cssText = "display:flex;flex-direction:column;gap:.2rem;";
  const s = document.createElement("small"); s.textContent = labelText; s.style.cssText = "color:var(--sumi-soft);font-size:11px";
  w.append(s, node);
  return w;
}
function pruneEmptyRows() {
  site.sections.forEach(s => { if (s.blocks) s.blocks = s.blocks.filter(b => b.type !== "row" || b.items.length); });
}
