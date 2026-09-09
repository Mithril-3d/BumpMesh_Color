# Walkthrough: 【 Phase 2 】交互積層（インターリーブ）マルチツール振り重ね積層

## 概要
ユーザーからの指示に基づき、HueForge式の混色・透過（TD/Beer-Lambert）ロジックおよび混色プリセットを全廃し、**「カラー量子化で作った色パレットをそのまま用い、各レイヤーを一定厚みで交互に積層し、目的色と一致する層を凸・不一致の層を凹にする」インターリーブ積層（交互積層）マルチツール方式**へ完全移行しました。

---

## 主な変更内容

### 1. コアロジック (`js/layerBlending.js`)
- 混色プリセット（Cyan, Magenta, Yellow, White 等のTD値スタック）を完全削除。
- 以下のインターリーブ積層コア関数を実装：
  - `getLayerIndex(z, minZ, thickness)`: Z高さからレイヤーインデックス（0-based）を算出。
  - `getInterleavedToolAtLayer(layerIndex, toolIds)`: レイヤーインデックスに応じたアクティブツールIDを算出（$T_{active} = \text{toolIds}[m \pmod K]$）。
  - `computeInterleavedDisplacement(...)`: 目的ツールとアクティブツールの一致判定に基づき、凸変位（$+A_{convex}$）または凹変位（$-A_{concave}$）を算出。
  - `generateInterleavedTable(...)`: スライス層情報（層番号、高さmm、ツールID、色）のテーブル生成。

### 2. メッシュ分割とツール割り当て (`js/meshPartition.js`)
- `assignToolsToTriangles()` において、インターリーブモード（`colorSubMode === 1`）時は各三角形の重心Z座標から層インデックスを割り出し、その層のアクティブツールIDを三角形に割り当て。
- スライサー上で各層ごとにツールが綺麗に交互に切り替わるファセットペイント（`slic3rpe:mmu_segmentation` / `paint_color`）を実現。

### 3. メッシュ変位パイプライン (`js/displacement.js`)
- `applyDisplacement()` に `colorSubMode === 1` の処理を追加：
  - 頂点のUV座標から画像テクスチャの目的ツールID $T_{target}$ をサンプリング。
  - 頂点Z高さからレイヤーのアクティブツール $T_{active}$ を特定。
  - $T_{active} == T_{target}$ ならば凸量 $+A_{convex}$、不一致ならば凹量 $-A_{concave}$ で頂点を法線方向に変位。
  - これにより、物理メッシュ上で白領域は白層が凸・赤層が凹、赤領域は赤層が凸・白層が凹となる立体形状を正確に成形。

### 4. リアルタイム 3D プレビュー (`js/previewMaterial.js`)
- シェーダーユニフォームに `interleavedThickness`, `interleavedConvex`, `interleavedConcave`, `interleavedToolCount`, `interleavedPalette` を追加。
- `computeHeightAtPoint()`: 画面上のプレビューでも同様に層ごとの凸凹変位およびバンプ陰影をレンダリング。
- `computeColorAtPoint()`: 層ごとにアクティブツールの色（白・赤・白・赤…）を描画し、実際の積層フィラメントの重なり合いとコントラストを視覚化。

### 5. GUI の刷新 (`index.html`, `style.css`, `js/main.js`)
- 混色プリセット選択・TDスライダー等を全廃。
- 直感的な設定UIを追加：
  - **積層厚み (mm)**: スライサーのレイヤー高さ（デフォルト: 0.20 mm）
  - **凸突出量 (mm)**: 目的色と一致する層の押し出し量（デフォルト: +0.30 mm）
  - **凹引込量 (mm)**: 目的色と異なる層の引っ込み量（デフォルト: 0.00 mm）
  - **ツール一覧**: カラー量子化タブで作成したツールIDと色チップをそのまま同期表示。
  - **スライス情報表示**: 総レイヤー数、層ごとの交互パターン案内を表示。

---

## 検証結果

### 1. 単体テスト (`test-interleaved.mjs`)
- `getLayerIndex`: 0.00mm, 0.19mm, 0.20mm, 0.40mm の境界テストすべて合格。
- `getInterleavedToolAtLayer`: Tool 1, Tool 2 の交互切り替えテスト合格。
- `computeInterleavedDisplacement`: 白領域・赤領域それぞれの凸凹反転テスト合格。
- `assignToolsToTriangles`: Z高さに応じた三角形へのツール割り当てテスト合格。

### 2. エンドツーエンド検証・PrusaSlicer CLI (`test-e2e-interleaved.mjs`)
- 2色画像（白背景・赤丸）とボックスモデルを用いて、サブディビジョン → インターリーブ変位 → デシメーション → 3MFパッケージングを実行。
- **三角形割り当て**: Tool 1 (白) 21,616 triangles / Tool 2 (赤) 19,344 triangles。
- **形状変位**: 元サイズ 20mm に対して凸変位により 20.60mm に正確に変形。
- **マニホールド性**: `manifold = yes`、オープンエッジ 0。
- **PrusaSlicer CLI によるスライス**:
  ```
  10 => Processing triangulated mesh
  20 => Generating perimeters
  30 => Preparing infill
  45 => Making infill
  90 => Exporting G-code to ./interleaved_test.gcode
  Slicing result exported to ./interleaved_test.gcode
  ```
  エラー・警告なく正常にG-code出力が完了。
