"use strict";
/* 作品集 ローカル編集画面。tools/serve-admin.mjs（localhost:4321）と通信する。 */

const $ = s => document.querySelector(s);
const api = (path, opts) => fetch(path, opts).then(async r => {
  const t = await r.text();
  let j = {}; try { j = t ? JSON.parse(t) : {}; } catch {}
  if (!r.ok) throw new Error(j.error || r.status);
  return j;
});
const ACT_OF = { "1st": "act1", "2nd": "act2", "3rd": "act3", "4th": "act4" };
const thumb = id => `img/thumbs/${id}.jpg`;

let site = null;
let sel = null;        // { id, loc }  loc.kind: row|bleed|bleed-cover|byobu|cover|profile|kure

/* ---------- 起動 ---------- */
(async function boot() {
  try {
    site = await api("/api/site");
  } catch (e) {
    document.getElementById("boot").classList.add("error");
    $("#bootMsg").textContent = "ヘルパに接続できません（" + e.message + "）";
    return;
  }
  $("#boot").hidden = true;
  $("#app").hidden = false;
  wireGlobal();
  render();
})();

function status(msg, cls = "") { const s = $("#status"); s.textContent = msg; s.className = "topbar__status " + cls; }
const mediaOf = id => site.media.find(m => m.id === id);

/* ---------- 全体UI ---------- */
function wireGlobal() {
  $("#btnSave").addEventListener("click", save);
  $("#btnPublish").addEventListener("click", publish);
  $("#selAlt").addEventListener("input", e => { if (sel) { const m = mediaOf(sel.id); if (m) m.alt = e.target.value; } });
  $("#selUnplace").addEventListener("click", unplaceSelected);
  $("#selDelete").addEventListener("click", deleteSelected);

  const file = $("#file"), drop = $("#drop");
  drop.addEventListener("click", () => file.click());
  file.addEventListener("change", () => file.files[0] && upload(file.files[0]));
  ["dragover", "dragenter"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("hot"); }));
  ["dragleave", "drop"].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove("hot")));
  drop.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) upload(f); });
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

async function upload(f) {
  const act = $("#upAct").value;
  try {
    status("画像を最適化してアップロード中…");
    const buf = await f.arrayBuffer();
    const r = await api(`/api/upload?act=${act}`, { method: "POST", body: buf });
    site = await api("/api/site");                       // 追加後の最新を取得
    const secId = ACT_OF[act];
    if (secId) {
      const s = site.sections.find(x => x.id === secId);
      s.blocks.push({ type: "row", items: [r.media.id] });  // 末尾に新しい行として配置
      await api("/api/save", { method: "POST", body: JSON.stringify(site) });
    }
    status(`追加しました（${r.media.id}）`, "ok");
    $("#file").value = "";
    render();
  } catch (e) { status("追加に失敗: " + e.message, "err"); }
}

/* ---------- 選択パネル ---------- */
function selectItem(id, loc) {
  sel = { id, loc };
  const m = mediaOf(id) || { alt: "" };
  $("#selPanel").hidden = false;
  $("#selImg").src = thumb(id);
  $("#selId").textContent = id + "（" + loc.kind + "）";
  $("#selAlt").value = m.alt || "";
  const structural = loc.kind !== "row";
  $("#selUnplace").hidden = structural;
  $("#selDelete").hidden = structural;
  renderReplace(structural, loc);
  document.querySelectorAll(".chip.sel").forEach(c => c.classList.remove("sel"));
  event && event.currentTarget && event.currentTarget.classList.add("sel");
}
function renderReplace(structural, loc) {
  let box = $("#replaceBox");
  if (box) box.remove();
  if (!structural) return;
  box = document.createElement("label");
  box.id = "replaceBox"; box.className = "fld";
  box.innerHTML = `<span>この枠の画像を差し替え</span>`;
  const selEl = document.createElement("select");
  selEl.innerHTML = site.media.map(m => `<option value="${m.id}"${m.id === sel.id ? " selected" : ""}>${m.id}${m.alt ? " — " + m.alt.slice(0, 16) : ""}</option>`).join("");
  selEl.addEventListener("change", () => { setAtLoc(loc, selEl.value); render(); });
  box.appendChild(selEl);
  $("#selPanel .sel__body").appendChild(box);
}
function setAtLoc(loc, id) {
  const s = site.sections[loc.si];
  if (loc.kind === "cover") site.cover.id = id;
  else if (loc.kind === "profile") s.photo = id;
  else if (loc.kind === "kure") s.image = id;
  else s.blocks[loc.bi].id = id;   // bleed / bleed-cover / byobu
}
function unplaceSelected() {
  if (!sel || sel.loc.kind !== "row") return;
  const items = site.sections[sel.loc.si].blocks[sel.loc.bi].items;
  items.splice(sel.loc.ii, 1);
  sel = null; $("#selPanel").hidden = true; render();
}
async function deleteSelected() {
  if (!sel) return;
  if (!confirm(`${sel.id} を完全に削除します（画像ファイルも消えます）。よろしいですか？`)) return;
  try {
    status("削除中…");
    await api("/api/delete-image", { method: "POST", body: JSON.stringify({ id: sel.id }) });
    site = await api("/api/site");
    sel = null; $("#selPanel").hidden = true;
    status("削除しました", "ok"); render();
  } catch (e) { status("削除に失敗: " + e.message, "err"); }
}

/* ---------- ドラッグ移動（行内の画像） ---------- */
let drag = null;
function onChipDragStart(e, loc) { drag = loc; e.currentTarget.classList.add("dragging"); e.dataTransfer.effectAllowed = "move"; }
function onChipDragEnd(e) { e.currentTarget.classList.remove("dragging"); document.querySelectorAll(".drop-hot").forEach(x => x.classList.remove("drop-hot")); drag = null; }
function moveTo(dstSi, dstBi, dstIdx) {
  if (!drag) return;
  const from = site.sections[drag.si].blocks[drag.bi].items;
  const [id] = from.splice(drag.ii, 1);
  const to = site.sections[dstSi].blocks[dstBi].items;
  let idx = dstIdx;
  if (drag.si === dstSi && drag.bi === dstBi && drag.ii < dstIdx) idx--;
  to.splice(Math.max(0, Math.min(idx, to.length)), 0, id);
}

/* ---------- レンダリング ---------- */
function render() {
  const ed = $("#editor");
  ed.innerHTML = "";
  site.sections.forEach((s, si) => ed.appendChild(renderSection(s, si)));
  // cover 編集
  ed.prepend(renderCover());
}

function renderCover() {
  const el = div("sec");
  el.innerHTML = `<div class="sec__head"><span class="sec__badge">表紙</span></div>`;
  const body = div("sec__body");
  const line = div("prof-line");
  line.innerHTML = `<input id="cvName" value="${esc(site.cover.name)}" placeholder="氏名">
                    <input id="cvRoman" value="${esc(site.cover.roman)}" placeholder="ローマ字">`;
  line.querySelector("#cvName").addEventListener("input", e => site.cover.name = e.target.value);
  line.querySelector("#cvRoman").addEventListener("input", e => site.cover.roman = e.target.value);
  const chip = makeChip(site.cover.id, "cover", { si: -1, kind: "cover" });
  body.append(chip, line);
  el.appendChild(body);
  return el;
}

function renderSection(s, si) {
  const el = div("sec" + (s.theme === "night" ? " sec--night" : ""));
  const head = div("sec__head");
  const num = si + 1;
  head.innerHTML = `<span class="sec__badge">${num}. ${esc(s.title || s.id)}</span>`;
  if (s.type !== "kure") {
    const t = input(s.title || "", "sec__title"); t.addEventListener("input", e => s.title = e.target.value); head.appendChild(labeled("見出し", t));
  }
  if (s.blocks) {
    const sub = input(s.sub || "", "sec__sub"); sub.placeholder = "サブラベル（任意）";
    sub.addEventListener("input", e => s.sub = e.target.value); head.appendChild(labeled("サブ", sub));
  }
  el.appendChild(head);

  const body = div("sec__body");
  if (s.type === "kure") { body.appendChild(makeChip(s.image, "幕間の写真", { si, kind: "kure" })); }
  else if (s.type === "profile") { body.appendChild(renderProfile(s, si)); }
  else if (s.type === "gallery") { body.innerHTML = `<p class="hint">全画像（現在 ${site.media.length} 点）を自動で一覧表示します。個別の追加・削除は各セクションと画像追加パネルから。</p>`; }
  else { renderBlocks(s, si, body); }
  el.appendChild(body);
  return el;
}

function renderBlocks(s, si, body) {
  s.blocks.forEach((b, bi) => {
    if (b.type === "row") body.appendChild(renderRow(s, si, b, bi));
    else body.appendChild(renderSingle(s, si, b, bi));
  });
  const add = document.createElement("button");
  add.className = "rowadd"; add.textContent = "＋ 行を追加";
  add.addEventListener("click", () => { s.blocks.push({ type: "row", items: [] }); render(); });
  body.appendChild(add);
}

function renderRow(s, si, b, bi) {
  const box = div("row");
  const tag = div("row__tag"); tag.textContent = "行"; box.appendChild(tag);
  b.items.forEach((id, ii) => box.appendChild(makeChip(id, null, { si, bi, ii, kind: "row" })));
  box.addEventListener("dragover", e => { e.preventDefault(); box.classList.add("drop-hot"); });
  box.addEventListener("dragleave", () => box.classList.remove("drop-hot"));
  box.addEventListener("drop", e => {
    e.preventDefault(); box.classList.remove("drop-hot");
    const after = [...box.querySelectorAll(".chip")].findIndex(c => e.clientX < c.getBoundingClientRect().left + c.offsetWidth / 2);
    moveTo(si, bi, after < 0 ? b.items.length : after);
    render();
  });
  return box;
}

function renderSingle(s, si, b, bi) {
  const wrap = div("single");
  const kindName = b.type === "byobu" ? "屏風（横スクロール）" : b.type === "bleed-cover" ? "全画面写真" : "全幅画像";
  wrap.appendChild(makeChip(b.id, null, { si, bi, kind: b.type }, b.type === "byobu"));
  const label = div("single__label"); label.textContent = kindName; wrap.appendChild(label);
  const ctl = div("single__ctl");
  ctl.append(
    btn("↑", () => { if (bi > 0) { swap(s.blocks, bi, bi - 1); render(); } }),
    btn("↓", () => { if (bi < s.blocks.length - 1) { swap(s.blocks, bi, bi + 1); render(); } }),
  );
  if (b.type !== "byobu") ctl.appendChild(btn(b.type === "bleed-cover" ? "全画面→全幅" : "全幅→全画面", () => { b.type = b.type === "bleed-cover" ? "bleed" : "bleed-cover"; render(); }, "btn--sm"));
  ctl.appendChild(btn("削除", () => { s.blocks.splice(bi, 1); render(); }, "btn--sm btn--danger"));
  wrap.appendChild(ctl);
  return wrap;
}

function renderProfile(s, si) {
  const box = div("");
  box.appendChild(makeChip(s.photo, "プロフィール写真", { si, kind: "profile" }));
  const p = s.profile;
  const f = div("prof-fields");
  const name = input(p.name, ""); name.addEventListener("input", e => p.name = e.target.value);
  const roman = input(p.roman, ""); roman.addEventListener("input", e => p.roman = e.target.value);
  f.append(labeled("氏名", name), labeled("ローマ字", roman));
  p.groups.forEach(g => {
    const gh = input(g.heading, ""); gh.addEventListener("input", e => g.heading = e.target.value);
    f.appendChild(labeled("見出し", gh));
    g.items.forEach(it => {
      const line = div("prof-line");
      if ("label" in it) { const lb = input(it.label || "", ""); lb.addEventListener("input", e => it.label = e.target.value); line.appendChild(lb); }
      const tx = input(it.text, ""); tx.addEventListener("input", e => it.text = e.target.value); line.appendChild(tx);
      f.appendChild(line);
    });
  });
  box.appendChild(f);
  return box;
}

/* ---------- 部品 ---------- */
function makeChip(id, title, loc, wide) {
  const c = div("chip" + (wide ? " chip--wide" : ""));
  if (!id) { c.textContent = "（空）"; return c; }
  const im = document.createElement("img"); im.src = thumb(id); im.alt = ""; im.loading = "lazy";
  c.appendChild(im);
  if (title) { const k = div("chip__kind"); k.textContent = title; c.appendChild(k); }
  c.addEventListener("click", () => selectItem(id, loc));
  if (loc.kind === "row") {
    c.draggable = true;
    c.addEventListener("dragstart", e => onChipDragStart(e, loc));
    c.addEventListener("dragend", onChipDragEnd);
  }
  return c;
}
function div(cls) { const d = document.createElement("div"); if (cls) d.className = cls; return d; }
function input(v, cls) { const i = document.createElement("input"); i.value = v; if (cls) i.className = cls; return i; }
function labeled(text, node) { const w = div("field-inline"); const s = document.createElement("small"); s.textContent = text; s.style.cssText = "color:var(--soft);font-size:11px;margin-right:.3rem"; w.append(s, node); w.style.display = "inline-flex"; w.style.alignItems = "center"; w.style.gap = ".2rem"; return w; }
function btn(txt, fn, cls = "btn--sm") { const b = document.createElement("button"); b.className = "btn " + cls; b.textContent = txt; b.addEventListener("click", fn); return b; }
function swap(a, i, j) { [a[i], a[j]] = [a[j], a[i]]; }
function pruneEmptyRows() { site.sections.forEach(s => { if (s.blocks) s.blocks = s.blocks.filter(b => b.type !== "row" || b.items.length); }); }
function esc(s) { return String(s ?? "").replace(/"/g, "&quot;"); }
