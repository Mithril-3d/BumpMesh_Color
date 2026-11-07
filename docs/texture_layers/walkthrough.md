# テクスチャレイヤー機能 (フェーズ 1 & 2) 実装ウォークスルー

## 概要
本家 BumpMesh (stlTexturizer) のテクスチャレイヤー機能（最大4レイヤー、Over/Addブレンド、各レイヤーごとのテクスチャ・設定・マスク管理）を、BumpMesh_Color 独自機能（カラーモード、交互積層、Native Mesh UV）と共存させる形で移植・実装しました。

## 実装内容

### 1. レイヤーUIと状態管理 (フェーズ 1)
- [index.html](file:///Users/phaizmithriln/Desktop/BumpMesh_color/index.html):
  - `#layer-strip` (`#layer-list` と `#layer-add-btn`) をサイドバーの Displacement Map セクション内に追加。
- [style.css](file:///Users/phaizmithriln/Desktop/BumpMesh_color/style.css):
  - `.layer-strip`, `.layer-row`, `.layer-thumb`, `.layer-name`, `.layer-btn`, `.layer-add-btn` のスタイルを追加。
- [js/i18n/ja.js](file:///Users/phaizmithriln/Desktop/BumpMesh_color/js/i18n/ja.js) / [en.js](file:///Users/phaizmithriln/Desktop/BumpMesh_color/js/i18n/en.js):
  - レイヤー追加、削除、表示/非表示、上書き/加算ブレンドの各文言キーを追加。
- [js/paintTree.js](file:///Users/phaizmithriln/Desktop/BumpMesh_color/js/paintTree.js):
  - 複数レイヤーごとのマスク状態を管理する適応型ツリーをインポート。
- [js/main.js](file:///Users/phaizmithriln/Desktop/BumpMesh_color/js/main.js):
  - `layers` 配列、`activeLayer`、`_renderLayerStrip`、`_addLayer`、`_removeLayer`、`_setLayerVisible`、`_setLayerBlendAdd` を追加。

### 2. プレビュー合成 & 凹凸エクスポート (フェーズ 2)
- [js/previewMaterial.js](file:///Users/phaizmithriln/Desktop/BumpMesh_color/js/previewMaterial.js):
  - 最大4つのテクスチャサンプラー (`map0`〜`map3`) および各レイヤーのパラメータ（`layerMode`, `layerScale`, `layerAmp`, `layerRot` 等）をシェーダー uniform として管理。
  - `compositeHeight` による頂点ごとのレイヤー合成（Over / Add）。
  - `colorSubMode > 0` の場合は従来のカラーシェーディングと変位を最優先で維持。
  - `MODE_MESH_UV = 7` および `MODE_SURFACE_NORMAL = 8` の衝突回避。
- [js/displacement.js](file:///Users/phaizmithriln/Desktop/BumpMesh_color/js/displacement.js):
  - `applyDisplacementLayers` を統合し、エクスポートパイプラインで複数レイヤーの凹凸を合成計算。
  - 単一レイヤーおよびカラーモード時は既存のディスプレイスメント処理を実行する安全設計。
- [js/exportPipeline.js](file:///Users/phaizmithriln/Desktop/BumpMesh_color/js/exportPipeline.js):
  - `input.layers` が存在する場合に `applyDisplacementLayers` へディスパッチ。

## 動作確認・テスト結果
1. **PaintTree 単体テスト (`test-paint-tree.mjs`)**:
   - `29/29 passed`（水密性、マルチレイヤー、消去、ソフトブラシすべて合格）。
2. **マルチレイヤー合成テスト (`test-displacement-layers.mjs`)**:
   - レイヤー0 (amp 1.0) + レイヤー1 (amp 0.5, blendAdd) の合成で頂点高さが `1.5` となり、加算合成が正確に計算されることを確認。
3. **初期表示・シェーダー検証**:
   - `js/previewMaterial.js` におけるシェーダー関数（`dominantCubicAxis` 等）の重複定義および未宣言 uniform 参照エラーを修正。
   - ブラウザ初期ロード時、Cube プリセットモデルおよびテクスチャプレビュー、レイヤーストリップ（`1 · Blue Porcelain`）が正常に描画されることを確認。
4. **レイヤー追加後の面ペイント（バケット・ブラシ）検証**:
   - `js/main.js` において、`mousedown` 時のバケット塗りつぶし処理およびブラシツール（`_paintSingleHit`）で `paintTree.paintFaces` / `paintTree.paintStroke` を呼び出すよう連携を修正。
   - `setSelectionMode` においてレイヤー切り替え時のペイント消去防止フラグ `{ clear = false }` を適用。
   - `refreshExclusionOverlay` で `paintTree` のペイント結果をジオメトリおよび `layerMask` 属性（vec4）に即時反映。
   - 新規レイヤー追加後、キューブの面をクリックすることで、対象の面のみに別テクスチャ（市松模様やVoronoiなど）がリアルタイムに上書き（Cover）反映されることを実機ブラウザ環境で確認。
5. **カラー機能（カラー量子化 / 3Dプレビュー色表示）の復元**:
   - `previewMaterial.js` のシェーダーにおいて、`useColorTexture == 1` の場合に表面色（`baseColor`）として `computeColorAtPoint(...)` を使用し、カラーテクスチャの色をライティングに乗せるよう修正。
   - `updateMaterial` で `u.useColorTexture.value` の uniform 更新処理を追加。
   - `main.js` の `getFullPreviewSettings()` で `colorTexture: getPreviewColorTexture()` を `fullSettings` に引き渡すよう修正。
   - カラー機能 ON 時に、Blue Porcelain の青白フルカラーやカラー量子化・交互積層色が 3D プレビュー上に鮮明に表示されることを確認。

---

## 既知の異常・保留メモ（次回対応項目）

### 現象: マルチレイヤー時のカラーONプレビューの不整合
- **カラーOFF（単色）時**:
  - レイヤー1（Blue Porcelain）とレイヤー2（Ichimatsu）が、クリックした面ごとに正しく分離され、凹凸（バンプ）が正常に描画される（期待通りの動作）。
- **カラーON（3Dプレビューで色を表示）時**:
  - 凹凸（バンプ）は正常に面ごとに分かれているが、**色（カラーテクスチャ）がレイヤーごとのマスク（`layerMask`）を反映せず、モデル全体にアクティブレイヤー（Ichimatsuの市松模様色）が一律で適用されてしまう**。
  - さらに、天面（天面フラット化で除外された面）も白く塗りつぶされる。

### 原因
- `previewMaterial.js` において、凹凸変位（バンプ／ディスプレイスメント）は `vLayerMask`（各レイヤーごとのマスク・ウェイト）を用いてレイヤー順（0〜3）に合成（Over / Add）されている。
- 一方、カラー（色）のサンプリング処理（`computeRawColorAtPoint` / `sampleMapColor`）は、**単一の `colorMap`（現在選択中のテクスチャ）とレイヤー0のUVパラメータのみを参照**している。
- 各レイヤーごとのカラーテクスチャ（`colorMap0`〜`colorMap3`）の保持や、`vLayerMask` の重みに応じた色のレイヤー合成処理がシェーダーおよびマテリアル側に未実装なため、アクティブレイヤーの色が全体にそのまま表示されてしまう。

### 次回修正方針
1. 各レイヤーのカラーテクスチャもシェーダー uniform に渡せるようにするか、あるいはレイヤーごとのマスク（`vLayerMask`）に応じて「レイヤー1の色の上にレイヤー2の色をマスク合成（Over）」するシェーダーロジックを実装する。
2. 天面フラット化や非テクスチャ部（`untexturedColor`）のカラー適用条件を、マルチレイヤーマスクと整合させる。


