#!/usr/bin/env node
// ローカル管理ヘルパ（依存ゼロ・macOS想定）。
//   node tools/serve-admin.mjs   で起動 → http://localhost:4321/admin.html
// できること: プレビュー配信 / site.json 保存 / 画像アップロード(sipsで最適化) /
//             画像削除 / 再生成(build_site) / 本番公開(git push)
// GitHub トークン等は一切保持しない。公開は端末に設定済みの git 資格情報を使う。
import { createServer } from "node:http";
import { readFile, writeFile, mkdir, rm, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { execFile } from "node:child_process";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = normalize(join(fileURLToPath(import.meta.url), "..", ".."));
const PORT = 4321;
const run = (cmd, args, opts = {}) => new Promise((res, rej) =>
  execFile(cmd, args, { cwd: ROOT, maxBuffer: 1 << 24, ...opts }, (e, so, se) =>
    e ? rej(new Error(se || e.message)) : res(so.toString())));

const MIME = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".webp": "image/webp" };

const json = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(obj)); };
const readBody = req => new Promise((res, rej) => { const c = []; req.on("data", d => c.push(d)); req.on("end", () => res(Buffer.concat(c))); req.on("error", rej); });

const siteJsonPath = join(ROOT, "content", "site.json");
const loadSite = async () => JSON.parse(await readFile(siteJsonPath, "utf8"));

// 画像最適化: 原本を image/<act>/ に置き、img/works(≤1800,q80) と img/thumbs(400,q72) を生成
async function ingestImage(act, buf, origName) {
  const nums = (await loadSite()).media.filter(m => m.id.startsWith(act + "-"))
    .map(m => +m.id.split("-")[1]);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  const id = `${act}-${String(next).padStart(3, "0")}`;
  const srcDir = join(ROOT, "image", act);
  await mkdir(srcDir, { recursive: true });
  await mkdir(join(ROOT, "img", "works"), { recursive: true });
  await mkdir(join(ROOT, "img", "thumbs"), { recursive: true });
  const srcPath = join(srcDir, `${id}.jpg`);
  await writeFile(srcPath, buf);
  // 長辺>1800なら縮小、それ以外はそのままworksへ
  const dim = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", srcPath]);
  const maxdim = Math.max(...[...dim.matchAll(/pixel\w+:\s*(\d+)/g)].map(m => +m[1]));
  const workPath = join(ROOT, "img", "works", `${id}.jpg`);
  if (maxdim > 1800) await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "80", "-Z", "1800", srcPath, "--out", workPath]);
  else await run("cp", [srcPath, workPath]);
  await run("sips", ["-s", "format", "jpeg", "-s", "formatOptions", "72", "-Z", "400", srcPath, "--out", join(ROOT, "img", "thumbs", `${id}.jpg`)]);
  const wh = await run("sips", ["-g", "pixelWidth", "-g", "pixelHeight", workPath]);
  const w = +wh.match(/pixelWidth:\s*(\d+)/)[1], h = +wh.match(/pixelHeight:\s*(\d+)/)[1];
  return { id, w, h, color: "rgb(200 200 200)", alt: "" };
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const p = url.pathname;

    // ---- API ----
    if (p === "/api/site" && req.method === "GET") return json(res, 200, await loadSite());

    if (p === "/api/save" && req.method === "POST") {
      const site = JSON.parse(await readBody(req));
      await writeFile(siteJsonPath, JSON.stringify(site, null, 2) + "\n");
      await run(process.execPath, [join(ROOT, "tools", "build_site.mjs")]);
      return json(res, 200, { ok: true });
    }

    if (p === "/api/upload" && req.method === "POST") {
      const act = url.searchParams.get("act");
      if (!/^(0th|1st|2nd|3rd|4th|5th|ex)$/.test(act || "")) return json(res, 400, { error: "bad act" });
      const meta = await ingestImage(act, await readBody(req));
      const site = await loadSite();
      site.media.push(meta);
      // media は act 順→番号順で整列
      const ord = { "0th": 0, "1st": 1, "2nd": 2, "3rd": 3, "4th": 4, "5th": 5, "ex": 6 };
      site.media.sort((a, b) => (ord[a.id.split("-")[0]] - ord[b.id.split("-")[0]]) || (+a.id.split("-")[1] - +b.id.split("-")[1]));
      await writeFile(siteJsonPath, JSON.stringify(site, null, 2) + "\n");
      await run(process.execPath, [join(ROOT, "tools", "build_site.mjs")]);
      return json(res, 200, { ok: true, media: meta });
    }

    if (p === "/api/delete-image" && req.method === "POST") {
      const { id } = JSON.parse(await readBody(req));
      const site = await loadSite();
      site.media = site.media.filter(m => m.id !== id);
      for (const s of site.sections) {
        if (s.blocks) { for (const b of s.blocks) if (b.items) b.items = b.items.filter(x => x !== id);
          s.blocks = s.blocks.filter(b => !((b.type !== "row") && b.id === id) && !(b.type === "row" && b.items.length === 0)); }
        if (s.photo === id) s.photo = "";
        if (s.image === id) s.image = "";
      }
      const act = id.split("-")[0];
      for (const dir of [`image/${act}/${id}.jpg`, `img/works/${id}.jpg`, `img/thumbs/${id}.jpg`]) {
        const fp = join(ROOT, dir); if (existsSync(fp)) await rm(fp);
      }
      await writeFile(siteJsonPath, JSON.stringify(site, null, 2) + "\n");
      await run(process.execPath, [join(ROOT, "tools", "build_site.mjs")]);
      return json(res, 200, { ok: true });
    }

    if (p === "/api/publish" && req.method === "POST") {
      const { message } = JSON.parse(await readBody(req).catch(() => "{}") || "{}");
      const msg = (message && String(message).slice(0, 200)) || "サイト更新";
      let log = "";
      try {
        log += await run("git", ["add", "-A"]);
        log += await run("git", ["commit", "-m", msg]);
      } catch (e) { if (!/nothing to commit/.test(e.message)) throw e; log += "変更なし\n"; }
      log += await run("git", ["push", "origin", "main"]);
      return json(res, 200, { ok: true, log });
    }

    // ---- 静的配信（プレビュー） ----
    let rel = decodeURIComponent(p === "/" ? "/admin.html" : p).replace(/^\/+/, "");
    const file = normalize(join(ROOT, rel));
    if (!file.startsWith(ROOT)) return json(res, 403, { error: "forbidden" });
    if (!existsSync(file)) { res.writeHead(404); return res.end("not found"); }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(body);
  } catch (e) {
    json(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, () => {
  console.log(`\n  岩田暉良 作品集 — 管理ヘルパ起動`);
  console.log(`  編集画面 : http://localhost:${PORT}/admin.html`);
  console.log(`  プレビュー: http://localhost:${PORT}/index.html`);
  console.log(`  終了      : Ctrl+C\n`);
});
