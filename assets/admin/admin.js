"use strict";
/* 作品集 編集画面（ブラウザ完結版）。
   サーバー不要 — GitHub リポジトリ（sslocker08/akira-iwata）を正本として直接読み書きする。
   ・読み込み: draft ブランチ（無ければ main）の content/site.json
   ・保存    : draft ブランチへコミット（本番には影響しない下書き）
   ・公開    : draft の内容を main へ反映 → GitHub Actions が自動で build + Firebase デプロイ
   ・画像    : ブラウザ内で Canvas リサイズ（works ≤1800px / thumbs ≤400px）。原本は自動ダウンロードで手元に保存
   認証は URL の #k=<キー> で受け取り localStorage に保存する。キーが無いと一切書き込めない。
   すべてのブロック（行/全幅/全画面/屏風）・単独スロット（表紙/リード/プロフィール写真）・
   ギャラリーを、同一のドラッグ&ドロップ機構で扱う。 */

import { buildHtml, buildDataJs } from "./build-core.mjs";

/* ---------- 設定 ---------- */
const OWNER = "sslocker08", REPO = "akira-iwata";
const SITE_URL = "https://akira-iwata.web.app";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const TOKEN_KEY = "akira-admin-token";
const RAW = (sha, path) => `https://raw.githubusercontent.com/${OWNER}/${REPO}/${sha}/${path}`;

const $ = s => document.querySelector(s);

let token = "";
let site = null;
let headSha = null;   // 表示中コンテンツのコミットSHA（画像URLの基準）
let sel = null;       // 現在選択中の画像id（説明文編集パネル用）
let tray = [];        // 追加直後、未配置の画像id一覧
let drag = null;      // 進行中のドラッグのペイロード

let savedSnapshot = "";              // 最後に保存した site のJSON（dirty判定用）
const pending = new Map();           // path -> {b64, sha?} 未コミットの新画像
const deletions = new Set();         // 次回保存時にリポジトリから消すパス
const committedIds = new Set();      // リポジトリに画像ファイルが存在するid
const blobUrls = new Map();          // path -> objectURL（このセッションで追加した画像の表示用）

const thumb = id => blobUrls.get(`img/thumbs/${id}.jpg`) || RAW(headSha, `img/thumbs/${id}.jpg`);
const work = id => blobUrls.get(`img/works/${id}.jpg`) || RAW(headSha, `img/works/${id}.jpg`);

/* ---------- GitHub API ---------- */
async function gh(path, opts = {}) {
  const r = await fetch(API + path, {
    ...opts,
    headers: {
      "Authorization": "Bearer " + token,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
  if (r.status === 401) throw new Error("編集キーが無効か期限切れです。作者に新しいURLをもらってください");
  if (!r.ok && r.status !== 404) {
    const j = await r.json().catch(() => ({}));
    throw new Error(j.message || "GitHub APIエラー " + r.status);
  }
  return r;
}
async function refSha(branch) {
  const r = await gh(`/git/ref/${encodeURIComponent("heads/" + branch)}`);
  if (r.status === 404) return null;
  return (await r.json()).object.sha;
}
async function commitOf(sha) { return (await gh(`/git/commits/${sha}`)).json(); }
const utf8FromB64 = b64 => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\s/g, "")), c => c.charCodeAt(0)));

async function loadSiteAt(sha) {
  const r = await gh(`/contents/content/site.json?ref=${sha}`);
  if (r.status === 404) throw new Error("content/site.json が見つかりません");
  return JSON.parse(utf8FromB64((await r.json()).content));
}

/* ---------- 起動 ---------- */
function takeToken() {
  const m = location.hash.match(/[#&]k=([^&]+)/);
  if (m) {
    localStorage.setItem(TOKEN_KEY, decodeURIComponent(m[1]));
    history.replaceState(null, "", location.pathname + location.search);
  }
  return localStorage.getItem(TOKEN_KEY) || "";
}

function showKeyScreen(msg) {
  $("#boot").classList.add("error");
  $("#bootMsg").textContent = msg;
  $("#keyForm").hidden = false;
}

(async function boot() {
  token = takeToken();
  $("#keySave").addEventListener("click", () => {
    const v = $("#keyInput").value.trim();
    if (!v) return;
    localStorage.setItem(TOKEN_KEY, v);
    location.reload();
  });
  if (!token) return showKeyScreen("編集キーがありません。作者にもらった編集用URLから開いてください。");

  try {
    // キーの検証（このリポジトリへの書き込み権限があるか）
    const repo = await (await gh("")).json();
    if (!repo.permissions || !repo.permissions.push) {
      return showKeyScreen("このキーには保存の権限がありません。作者に新しいURLをもらってください。");
    }
    const mainSha = await refSha("main");
    let draftSha = await refSha("draft");
    if (draftSha && draftSha !== mainSha) {
      // draft が main より古いだけ（固有のコミットが無い）なら main に追従させる
      const cmp = await (await gh(`/compare/main...draft`)).json();
      if (cmp.status === "behind" || cmp.status === "identical") {
        await gh(`/git/refs/${encodeURIComponent("heads/draft")}`, { method: "PATCH", body: JSON.stringify({ sha: mainSha, force: true }) });
        draftSha = mainSha;
      } else if (cmp.status === "diverged") {
        status("※本番側にも別の更新があります。「本番へ公開」するとこの画面の内容で上書きされます", "err");
      }
    }
    headSha = draftSha || mainSha;
    site = await loadSiteAt(headSha);
  } catch (e) {
    return showKeyScreen("読み込みに失敗しました（" + e.message + "）");
  }

  if (!site.gallery) site.gallery = site.media.map(m => m.id);
  site.media.forEach(m => committedIds.add(m.id));
  savedSnapshot = JSON.stringify(site);
  $("#boot").hidden = true;
  $("#app").hidden = false;
  wireGlobal();
  render();
})();

function status(msg, cls = "") { const s = $("#status"); s.textContent = msg; s.className = "topbar__status " + cls; }
const mediaOf = id => site.media.find(m => m.id === id);
const isDirty = () => pending.size > 0 || deletions.size > 0 || JSON.stringify(site) !== savedSnapshot;

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
  $("#btnPreview").addEventListener("click", openPreview);
  $("#selAlt").addEventListener("input", e => { if (sel) { const m = mediaOf(sel); if (m) m.alt = e.target.value; } });
  $("#selDelete").addEventListener("click", deleteSelected);
  $("#selClose").addEventListener("click", closeSelPanel);
  window.addEventListener("beforeunload", e => { if (isDirty()) { e.preventDefault(); e.returnValue = ""; } });

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

/* ---------- 保存（draftブランチへコミット） ---------- */
async function commitSnapshot(parentSha, message) {
  const entries = [];
  for (const [path, p] of pending) {
    if (!p.sha) {
      const r = await (await gh("/git/blobs", { method: "POST", body: JSON.stringify({ content: p.b64, encoding: "base64" }) })).json();
      p.sha = r.sha;
    }
    entries.push({ path, mode: "100644", type: "blob", sha: p.sha });
  }
  for (const path of deletions) entries.push({ path, mode: "100644", type: "blob", sha: null });
  entries.push({ path: "content/site.json", mode: "100644", type: "blob", content: JSON.stringify(site, null, 2) + "\n" });
  const parent = await commitOf(parentSha);
  const tree = await (await gh("/git/trees", { method: "POST", body: JSON.stringify({ base_tree: parent.tree.sha, tree: entries }) })).json();
  const commit = await (await gh("/git/commits", { method: "POST", body: JSON.stringify({ message, tree: tree.sha, parents: [parentSha] }) })).json();
  return commit.sha;
}

async function ensureDraft() {
  let draft = await refSha("draft");
  if (!draft) {
    const main = await refSha("main");
    await gh("/git/refs", { method: "POST", body: JSON.stringify({ ref: "refs/heads/draft", sha: main }) });
    draft = main;
  }
  return draft;
}

async function save() {
  pruneEmptyBlocks();
  try {
    status("保存中…");
    const draft = await ensureDraft();
    const newSha = await commitSnapshot(draft, "下書きを保存");
    await gh(`/git/refs/${encodeURIComponent("heads/draft")}`, { method: "PATCH", body: JSON.stringify({ sha: newSha }) });
    headSha = newSha;
    for (const m of site.media) committedIds.add(m.id);
    pending.clear(); deletions.clear();
    savedSnapshot = JSON.stringify(site);
    status("保存しました（下書き。本番には未反映）", "ok");
    return true;
  } catch (e) { status("保存に失敗: " + e.message, "err"); return false; }
}

async function publish() {
  if (!confirm("現在の内容を本番サイトへ公開します。よろしいですか？")) return;
  if (!await save()) return;
  try {
    status("公開中…");
    const draft = await refSha("draft");
    const main = await refSha("main");
    const [dc, mc] = await Promise.all([commitOf(draft), commitOf(main)]);
    if (dc.tree.sha === mc.tree.sha) { status("変更はありません（本番はすでに最新です）", "ok"); return; }
    const commit = await (await gh("/git/commits", { method: "POST", body: JSON.stringify({ message: "作品集を更新（本番へ公開）", tree: dc.tree.sha, parents: [main] }) })).json();
    await gh(`/git/refs/${encodeURIComponent("heads/main")}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha }) });
    await gh(`/git/refs/${encodeURIComponent("heads/draft")}`, { method: "PATCH", body: JSON.stringify({ sha: commit.sha, force: true }) });
    headSha = commit.sha;
    status("公開しました。1〜2分ほどで本番サイトに反映されます。", "ok");
  } catch (e) { status("公開に失敗: " + e.message, "err"); }
}

/* ---------- プレビュー（build-core でその場生成） ---------- */
function openPreview() {
  pruneEmptyBlocks();
  try {
    let html = buildHtml(site);
    html = html.replace("<head>", `<head>\n<base href="${SITE_URL}/">`);
    // 実行時参照（ギャラリー/ライトボックス）: data.js をこの場の内容でインライン化し、画像URLの差し替え表を渡す
    const previewSrc = {};
    for (const m of site.media) {
      previewSrc[`img/works/${m.id}.jpg`] = work(m.id);
      previewSrc[`img/thumbs/${m.id}.jpg`] = thumb(m.id);
    }
    html = html.replace('<script defer src="assets/js/data.js"></script>',
      "<script>window.PREVIEW_SRC = " + JSON.stringify(previewSrc) + ";\n" + buildDataJs(site) + "</script>");
    // 静的HTML中の画像も同じ差し替え表で置換
    for (const [path, url] of Object.entries(previewSrc)) html = html.split(`src="${path}"`).join(`src="${url}"`);
    const w = window.open("", "_blank");
    if (!w) return status("プレビューを開けません（ポップアップがブロックされています）", "err");
    w.document.write(html);
    w.document.close();
  } catch (e) { status("プレビュー生成に失敗: " + e.message, "err"); }
}

/* ---------- 画像取り込み（ブラウザ内でリサイズ・sips不要） ---------- */
async function loadImageEl(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  try { await img.decode(); }
  catch { URL.revokeObjectURL(url); throw new Error("この画像形式を読み込めません（JPEGかPNGでお試しください）"); }
  return img;
}
function scaledCanvas(img, maxDim) {
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const scale = Math.min(1, maxDim / Math.max(w0, h0));
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w0 * scale));
  c.height = Math.max(1, Math.round(h0 * scale));
  c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return c;
}
const toJpeg = (canvas, q) => new Promise((res, rej) =>
  canvas.toBlob(b => b ? res(b) : rej(new Error("画像の変換に失敗しました")), "image/jpeg", q));
const b64Of = blob => new Promise((res, rej) => {
  const fr = new FileReader();
  fr.onload = () => res(String(fr.result).split(",")[1]);
  fr.onerror = rej;
  fr.readAsDataURL(blob);
});
function avgColor(canvas) {
  const c = document.createElement("canvas");
  c.width = c.height = 1;
  const ctx = c.getContext("2d");
  ctx.drawImage(canvas, 0, 0, 1, 1);
  const d = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${d[0]} ${d[1]} ${d[2]})`;
}
function nextId(act) {
  const nums = site.media.filter(m => m.id.startsWith(act + "-")).map(m => +m.id.split("-")[1]);
  return `${act}-${String((nums.length ? Math.max(...nums) : 0) + 1).padStart(3, "0")}`;
}
function downloadOriginal(file, id) {
  try {
    const ext = (file.name.match(/\.[A-Za-z0-9]+$/) || [".jpg"])[0];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = `${id}-原本${ext}`;
    a.click();
  } catch { /* 原本保存は補助機能。失敗しても取り込みは続行 */ }
}

async function uploadFile(f, act = "ex") {
  try {
    status("画像を取り込み中…");
    const img = await loadImageEl(f);
    const workC = scaledCanvas(img, 1800);
    const thumbC = scaledCanvas(img, 400);
    const [workBlob, thumbBlob] = await Promise.all([toJpeg(workC, 0.8), toJpeg(thumbC, 0.72)]);
    const id = nextId(act);
    const meta = { id, w: workC.width, h: workC.height, color: avgColor(thumbC), alt: "" };
    site.media.push(meta);
    const ord = { "0th": 0, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5, "ex": 6 };
    site.media.sort((a, b) => (ord[a.id.split("-")[0]] - ord[b.id.split("-")[0]]) || (+a.id.split("-")[1] - +b.id.split("-")[1]));
    if (!site.gallery) site.gallery = [];
    site.gallery.push(id);
    // 削除済みidの再採番で同一パスになった場合、削除予約より新規blobを優先する
    deletions.delete(`img/works/${id}.jpg`);
    deletions.delete(`img/thumbs/${id}.jpg`);
    pending.set(`img/works/${id}.jpg`, { b64: await b64Of(workBlob) });
    pending.set(`img/thumbs/${id}.jpg`, { b64: await b64Of(thumbBlob) });
    blobUrls.set(`img/works/${id}.jpg`, URL.createObjectURL(workBlob));
    blobUrls.set(`img/thumbs/${id}.jpg`, URL.createObjectURL(thumbBlob));
    downloadOriginal(f, id);
    tray.push(id);
    status(`追加しました（${id}）— ドラッグして配置し、最後に「保存」してください`, "ok");
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
function deleteSelected() {
  if (!sel) return;
  if (!confirm(`${sel} を完全に削除します（画像ファイルも消えます）。よろしいですか？`)) return;
  const id = sel;
  site.media = site.media.filter(m => m.id !== id);
  if (site.gallery) site.gallery = site.gallery.filter(x => x !== id);
  if (site.cover && site.cover.id === id) site.cover.id = "";
  for (const s of site.sections) {
    if (s.blocks) {
      for (const b of s.blocks) if (b.items) b.items = b.items.filter(x => x !== id);
      s.blocks = s.blocks.filter(b => !((b.type !== "row") && b.id === id) && !(b.type === "row" && b.items.length === 0));
    }
    if (s.photo === id) s.photo = "";
    if (s.lead === id) s.lead = "";
    if (s.image === id) s.image = "";
  }
  for (const path of [`img/works/${id}.jpg`, `img/thumbs/${id}.jpg`]) {
    if (pending.has(path)) pending.delete(path);
    else if (committedIds.has(id)) deletions.add(path);
    if (blobUrls.has(path)) { URL.revokeObjectURL(blobUrls.get(path)); blobUrls.delete(path); }
  }
  committedIds.delete(id);
  tray = tray.filter(x => x !== id);
  closeSelPanel();
  status("削除しました（「保存」で確定します）", "ok");
  render();
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
// 空の行と、画像未設定の単独ブロック（全幅/全画面/屏風）を保存前に取り除く
function pruneEmptyBlocks() {
  site.sections.forEach(s => {
    if (s.blocks) s.blocks = s.blocks.filter(b => b.type === "row" ? b.items.length : b.id);
  });
}
