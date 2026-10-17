# タスク: ハーフトーン編み（Halftone Weave）機能の実装

## 概要
既存のプロファイル（フラット段差、45°ルーバー、正弦波、三角波、矩形ブロック）はそのまま保持した上で、新たに「Profile 5: ハーフトーン編み (Halftone Weave)」を追加する。
meditat38 氏の Full Color Halftone 方式を参考に、内壁アンカー固定構造（内壁 `r_in` は外形ベースに固定して上下層の密着を100%保証）、見せたい色のみが一定間隔でループ状に飛び出し、隠したい色は奥（`disp = 0`）に引っ込める制御、および2色時のフラットリブ化・多色時のアンカー溶着と混色補正を実装する。

## タスク一覧
- [x] 1. 準備 & ブランチ作成
  - [x] 最新コードの pull & ブランチ `feature/halftone-weave` 作成
  - [x] プロジェクトドキュメント整備 (`docs/halftone_weave/`)
- [x] 2. ハーフトーン編みコアロジックの実装
  - [x] `js/layerBlending.js`: Profile 5 (Halftone Weave) の変位計算と混色補正
  - [x] `js/weaveTubeGenerator.js`: Profile 5 の輪ゴムチューブ生成（内壁アンカー固定 ＋ 外壁ループ突起）
  - [x] `js/previewMaterial.js`: GLSL シェーダー内プレビューの Profile 5 対応
- [x] 3. UI・設定項目の追加
  - [x] `index.html`: プロファイル選択肢に「ハーフトーン (Halftone Weave)」を追加
  - [x] `js/main.js`: Profile 5 選択時の設定連携・プレビュー更新・エクスポート対応
  - [x] `js/i18n/ja.js`, `js/i18n/en.js`: 日英ラベルの追加
- [x] 4. 動作検証 & Vercelプレビューデプロイ
  - [x] 2色モードおよび多色モードでのチューブ生成・頂点計算確認
  - [x] Git commit & push (`feature/halftone-weave`)
  - [x] Vercel プレビューデプロイ（※本番 `--prod` は行わない）
  - [x] `walkthrough.md` の作成

