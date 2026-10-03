# タスクリスト: ハーフトーン編み重ね変位 & 幾何曲率シェーディング (Halftone Weave & Curvature Shading)

> 本ドキュメントは、YouTube動画「Halftone 3D Printing: Smooth Gradients With Just 2 Colors!」の技術を BumpMesh_Color に取り入れるための実装タスクリストです。v1.5.1 として実装・検証が完了しました。

- [x] 1. 技術調査・アーキテクチャ設計 <!-- id: 0 -->
  - [x] 動画技術（G-code幾何変調、正弦波編み重ね、2色ハーフトーン、凹凸シェーディング）の原理分析 <!-- id: 1 -->
  - [x] BumpMesh_Color既存機能（Interleaved Slicing, Cotangent Laplacian, WebGL Shader）との親和性・差分分析 <!-- id: 2 -->
  - [x] 機能分割案（幾何曲率シェーディング + 正弦波編み重ね変調 + リアルタイムプレビュー + 3MF出力）の策定 <!-- id: 3 -->
  - [x] 検討計画書ドキュメント群（task.md, implementation_plan.md, walkthrough.md）の作成 <!-- id: 4 -->

- [x] 2. 幾何曲率・キャビティシェーディングエンジンの設計・実装（機能1: UV不要の凹凸陰影） <!-- id: 5 -->
  - [x] 既存 `meshIndex.js` の QuantizedPointMap 基盤を活用した高速一意頂点クラスタリング <!-- id: 6 -->
  - [x] 各頂点の平均曲率（Mean Curvature）および法線内積（凸/凹判定）算出アルゴリズムの実装 (`meshCurvature.js`) <!-- id: 7 -->
  - [x] 重み付き近傍重心差ベクトル $L_u = c_u - p_u$ と法線 $n_u$ の射影によるキャビティ・リッジ推定 <!-- id: 8 -->
  - [x] コントラスト・バイアス・平滑化拡散（ファセットノイズ低減）・反転パラメータの制御実装 <!-- id: 9 -->
  - [x] 98パーセンタイルロバスト正規化による頂点スカラー場から輝度マップ（0.0〜1.0）への変換 <!-- id: 10 -->

- [x] 3. 正弦波編み重ね・ハーフトーン変位エンジンの設計・実装（機能2: Weave Displacement） <!-- id: 11 -->
  - [x] `layerBlending.js` への新プロファイル（`ProfileMode = 2: Sinusoidal Weave`）の追加 <!-- id: 12 -->
  - [x] 水平方向の周回角度/座標に基づく正弦波変形関数（波長ピッチ、波の振幅、円弧座標 arc = r * theta）の実装 <!-- id: 13 -->
  - [x] 層（Layer）ごとの 180° 位相シフト（`layerPhase = (layerIdx % 2) * PI`）による互い違い編み込み <!-- id: 14 -->
  - [x] 輝度値に応じたツールの突出量・波の振幅変調（ハーフトーン露出比率制御: `dcOffset + waveAmp * W * ratio`） <!-- id: 15 -->
  - [x] `displacement.js` における曲率ソース分岐とWeave変位適用の統合 <!-- id: 16 -->

- [x] 4. リアルタイムWebGLシェーダープレビューの設計・実装（機能3: Preview Shader） <!-- id: 17 -->
  - [x] `previewMaterial.js` における正弦波変位と層交代カラーの頂点・フラグメントシェーダー拡張（`interleavedWeavePitch`, `interleavedWeaveAmp` uniform） <!-- id: 18 -->
  - [x] 幾何曲率シェーディング時の頂点カラー（toolA / toolB の層交代カラー）描画 <!-- id: 19 -->
  - [x] WebGL GPUプレビューによるリアルタイムパラメータ調整フィードバック <!-- id: 20 -->

- [x] 5. UI・コントローラーおよびエクスポート連携（機能4: UI & Export） <!-- id: 21 -->
  - [x] 陰影ソース切り替え（外部テクスチャ / モデル凹凸曲率）のUI追加 (`index.html`) <!-- id: 22 -->
  - [x] ハーフトーン編み重ね（波長ピッチ、最大振幅）および曲率調整スライダーのUI追加 <!-- id: 23 -->
  - [x] `layerSlicing.js`（水密マルチツールメッシュ分割）へのWeave変位オプション受け渡しと3MF出力連携 <!-- id: 24 -->
  - [x] i18n 多言語対応（日本語・英語）およびバージョン `v1.5.1` 表記更新 <!-- id: 25 -->
