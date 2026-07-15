#!/bin/bash
# 岩田暉良 作品集 — 編集画面 かんたん起動
# ダブルクリックで実行: Node.js が無ければ自動インストールし、編集画面とプレビューを開きます。
set -e
cd "$(dirname "$0")"

echo "岩田暉良 作品集 — 編集画面を起動します"
echo ""

# ---------- 1. Node.js の確認・インストール（初回のみ） ----------
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js が見つかりません。インストールします（初回だけ・数分かかります）"
  echo "途中でMacのパスワード入力を求められます（インストール許可のためです）"
  echo ""

  IDX=$(curl -fsSL https://nodejs.org/dist/index.json)
  # 最新のLTS（長期サポート版）を1行のJSONオブジェクトから抽出する。
  # node/pythonが使えない前提のため、grep/sedのみで処理する。
  LTS_LINE=$(echo "$IDX" | grep -m1 '"lts":"[A-Za-z]')
  VERSION=$(echo "$LTS_LINE" | grep -o '"version":"v[0-9.]*"' | sed -E 's/.*"(v[0-9.]+)".*/\1/')

  if [ -z "$VERSION" ]; then
    echo "エラー: Node.jsのバージョン情報が取得できませんでした。"
    echo "https://nodejs.org を開くので、緑色の「LTS」ボタンからインストールしてください。"
    open "https://nodejs.org"
    read -p "インストールが終わったら、このウィンドウで Enter を押してください..." _
  else
    PKG_URL="https://nodejs.org/dist/${VERSION}/node-${VERSION}.pkg"
    TMP_PKG="/tmp/node-installer-${VERSION}.pkg"
    echo "Node.js ${VERSION} をダウンロード中..."
    curl -fsSL "$PKG_URL" -o "$TMP_PKG"
    echo "インストール中..."
    osascript -e "do shell script \"installer -pkg \\\"$TMP_PKG\\\" -target /\" with administrator privileges with prompt \"作品集の編集ツールに必要なNode.jsをインストールします。\""
    rm -f "$TMP_PKG"
    hash -r
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo ""
    echo "Node.js のインストールを確認できませんでした。お手数ですが、"
    echo "手動で https://nodejs.org からインストールしてから、このファイルをもう一度開いてください。"
    read -p "Enter キーで閉じます..." _
    exit 1
  fi
  echo "Node.js のインストールが完了しました（$(node -v)）"
  echo ""
fi

# ---------- 2. 編集ヘルパーの起動（すでに起動済みなら再利用） ----------
if curl -s -o /dev/null -w "" "http://localhost:4321/api/site" 2>/dev/null; then
  echo "編集ツールはすでに起動しています"
else
  echo "編集ツールを起動しています..."
  node tools/serve-admin.mjs &
  SERVER_PID=$!
  for i in $(seq 1 20); do
    sleep 0.3
    if curl -s -o /dev/null "http://localhost:4321/api/site" 2>/dev/null; then break; fi
  done
fi

# ---------- 3. ブラウザで編集画面とプレビューを開く ----------
open "http://localhost:4321/admin.html"
sleep 0.5
open "http://localhost:4321/index.html"

echo ""
echo "編集画面とプレビューをブラウザで開きました。"
echo "▸ このウィンドウを閉じると、編集ツールが終了します（閉じるまで開いたままにしてください）"
echo ""

if [ -n "${SERVER_PID:-}" ]; then
  wait "$SERVER_PID"
else
  echo "（別の起動中プロセスを使っているため、このウィンドウは閉じても構いません）"
  read -p "Enter キーでこのウィンドウを閉じます..." _
fi
