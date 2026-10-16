# 実装計画: ハーフトーン編み（Halftone Weave）機能

## 1. 目的とスコープ
既存のプロファイル（Profile 0: フラット段差, Profile 1: 45°ルーバー, Profile 2: 正弦波, Profile 3: 三角波, Profile 4: 矩形ブロック）には一切影響を与えずそのまま保持し、新たに **Profile 5: ハーフトーン編み（Halftone Weave）** を追加する。

### 主な仕様
1. **形状生成エンジンの拡張 (`js/weaveTubeGenerator.js`)**:
   - Profile 5 では、従来の「肉厚0.4mmの輪ゴム全体が内外一緒に動く」のではなく、**「内壁 `r_in = r_base - wallThickness` はベース輪郭に直線・滑らかに固定（アンカー化）」** し、**「外壁 `r_out` だけが一定間隔でループ状に突出」** する形状を生成する。
   - これにより、突起量を 1.0mm〜2.5mm に大きく設定しても内側の壁が全層100%密着し、空中に浮くことなくスライサーが「内壁（直線）＋外壁（突起ループ）」の強固なパスを生成できる。
   - 隠したい色の層（`exposure = 0`）は、外壁も `r_base` のまま平滑に通過し、突起しない。
2. **2色と多色の適応波形制御 (`js/layerBlending.js`, `js/previewMaterial.js`)**:
   - **2色モード時**: ハイライト・白ベタ領域（`exposure` が高い部分）で波の山が持ち上げられて天井で平らに頭打ち（クリッピング）され、山同士が横に繋がって平らな連続リブ（デューティ比100%）を形成する。
   - **3色以上モード時**: どんなハイライトでも必ず一定間隔で奥の壁（`0mm`）に戻る谷を形成し、下の4層（奥に引っ込んでいる他色）にアンカー溶着して空中落下を防ぐ。
   - **混色補正 (Brightness Compensation)**: 2色が混ざる中間調で突出高さが半減して痩せ細るのを防ぐ補正係数を導入。
3. **UI・プレビュー・エクスポート連携**:
   - `index.html` のプロファイル選択肢に「5: ハーフトーン (Halftone Weave)」を追加。
   - GLSL シェーダー（`js/previewMaterial.js`）およびCPU変位（`js/layerBlending.js`）を Profile 5 に対応させ、リアルタイムプレビューを完全同期。
   - 3MFエクスポート（`js/main.js` の `isWeaveMode` 分岐）で Profile 5 も `generateWeaveRubberBandTube` を経由してマルチカラー3MFを出力。

## 2. 変更対象ファイル
- `index.html`: プロファイル選択セレクトボックスに Profile 5 を追加
- `js/layerBlending.js`: Profile 5 の変位・波形・混色補正ロジックの追加
- `js/weaveTubeGenerator.js`: Profile 5 の内壁アンカー固定＆外壁ループ突起メッシュ生成ロジックの追加
- `js/previewMaterial.js`: GLSL 頂点・フラグメントシェーダーの Profile 5 対応
- `js/main.js`: `isWeaveMode` 判定に Profile 5 を含め、エクスポート・プレビューのパラメータ連携
- `js/i18n.js`: 日英翻訳辞書の追加

## 3. 検証計画
- 2色および多色設定での3Dリアルタイムプレビュー確認
- 3MFエクスポートを実行し、生成されたメッシュの頂点・法線・ツールIDが水密かつ正しく生成されていることを確認
- Git commit & push、および Vercel プレビュー環境へのデプロイ（本番 `--prod` は行わない）
