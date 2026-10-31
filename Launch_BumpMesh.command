#!/bin/bash

# 移動: スクリプトの場所、またはデスクトップのBumpMesh_colorへ
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
if [ -f "$SCRIPT_DIR/index.html" ]; then
  cd "$SCRIPT_DIR" || exit 1
elif [ -f "$HOME/Desktop/BumpMesh_color/index.html" ]; then
  cd "$HOME/Desktop/BumpMesh_color" || exit 1
else
  echo "❌ エラー: BumpMesh_color の index.html が見つかりませんでした。"
  read -n 1 -s -r -p "何かキーを押して終了してください..."
  exit 1
fi

echo "=================================================="
echo "   🚀 BumpMesh_Color 起動ランチャー (macOS)"
echo "=================================================="
echo ""

# 1. 既にポート5500（VS Code / Antigravity Live Server）で起動しているかチェック
if curl -s -m 1 -o /dev/null -w "%{http_code}" http://localhost:5500/index.html 2>/dev/null | grep -q "200"; then
  echo "✅ 稼働中の Live Server (ポート 5500) を検出しました。"
  echo "🌐 ブラウザで開きます: http://localhost:5500/"
  open "http://localhost:5500/index.html"
  echo ""
  echo "起動完了しました。このウィンドウは閉じて構いません。"
  exit 0
fi

# 2. 空きポートを探してPythonローカルサーバーを起動
PORT=8080
if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  PORT=8000
fi
if lsof -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  PORT=8888
fi

echo "📦 ローカルWebサーバーを起動します (ポート: $PORT)..."
echo "🌐 ブラウザを自動で開きます: http://localhost:$PORT/"
echo ""
echo "※ 終了するときはこのウィンドウで [Ctrl + C] を押すか、"
echo "   このウィンドウをそのまま閉じてください。"
echo "=================================================="

# 1秒後にブラウザを自動オープン
(sleep 1 && open "http://localhost:$PORT/index.html") &

# Python 3 組み込みHTTPサーバーを起動
python3 -m http.server $PORT

