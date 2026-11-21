# テクスチャレイヤー機能 & スタンプ機能 (v2.0.0) 実装ウォークスルー

## 概要
本家 BumpMesh (stlTexturizer) のテクスチャレイヤー機能（v1.4.0：最大4レイヤー、Over/Addブレンド、各レイヤーごとのテクスチャ・設定・マスク管理）およびスタンプ配置機能（v1.5.0〜v1.5.1：クリック配置・ドラッグ移動・ホイール拡大縮小・Surface Normal投影・裏面遮蔽）を、BumpMesh_Color 独自機能（カラー量子化、マルチカラー3MF、交互積層、Native Mesh UV）と完全共存させる形で移植・実装しました。

## 実装内容

### 1. レイヤーUIと状態管理 (フェーズ 1)
- [index.html](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/index.html):
  - `#layer-strip` (`#layer-list` と `#layer-add-btn`) をサイドバーの Displacement Map セクション内に追加。
  - スタンプモード用の `#stamp-mode-row`, `#stamp-place-row`, `#stamp-hint` および `<option value="8" hidden disabled data-i18n-opt="projection.surfaceNormal">` を追加。
- [style.css](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/style.css):
  - `.layer-strip`, `.layer-row`, `.layer-thumb`, `.layer-name`, `.layer-btn`, `.layer-add-btn`, `.stamp-hint.armed` のスタイルを追加。
- [js/i18n/ja.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/i18n/ja.js) / [js/i18n/en.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/i18n/en.js):
  - レイヤー追加、削除、表示/非表示、上書き/加算ブレンド、スタンプ配置操作、Surface Normal 投影の各文言キーを追加。
- [js/paintTree.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/paintTree.js):
  - 複数レイヤーごとのマスク状態を管理する適応型サブディビジョンツリーを統合。
- [js/main.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/main.js):
  - `layers` 配列、`activeLayer`、`_renderLayerStrip`、`_addLayer`、`_removeLayer`、`_setLayerVisible`、`_setLayerBlendAdd` を実装。
  - `.bumpmesh` プロジェクト保存/読込（`paint.json`, `texture-${i}.png`）および Undo/Redo スタックのマルチレイヤー・ペイントツリー完全対応。

### 2. プレビュー合成 & マルチレイヤーカラー合成 & 凹凸エクスポート (フェーズ 2)
- [js/previewMaterial.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/previewMaterial.js):
  - 最大4つのハイトマップサンプラー (`map0`〜`map3`) に加え、カラーテクスチャサンプラー (`colorMap0`〜`colorMap3`) および各レイヤーのパラメータをシェーダー uniform として管理。
  - `compositeHeight` による頂点・フラグメントごとのレイヤー凹凸合成（Over / Add）。
  - `compositeRawColor` により、カラーモード ON 時にも各レイヤーのマスク（`vLayerMask`）・境界フェード（`vLayerFalloff`）・角度マスク（`vAngleMask`）・スタンプ範囲（`stampCover`）を反映してレイヤー順に色を合成。
  - `MODE_MESH_UV = 7`（モデルの既存UV）と `MODE_SURFACE_NORMAL = 8`（表面法線スタンプ投影）を分離し衝突を回避。
- [js/displacement.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/displacement.js) / [js/exportPipeline.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/exportPipeline.js):
  - `applyDisplacementLayers` を統合し、エクスポートおよびベイクパイプラインで複数レイヤー＋スタンプの凹凸を合成計算。
  - `softExclude` およびレイヤーごとの `exclude` / `hardFaces` の親三角形からのバリセントリック補間（`interpolateFromParents`）を統合。
- [js/meshPartition.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/meshPartition.js):
  - `assignToolsToTriangles` を拡張し、マルチレイヤーおよびスタンプモード使用時のマルチカラー3MFエクスポートでも各レイヤーのUV・マスク・スタンプ範囲に応じてツールIDを正確に割り当て。

### 3. スタンプ機能（Stamp Mode）の統合 (フェーズ 3)
- [js/mapping.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/mapping.js) / [js/main.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/main.js):
  - `STAMP_MODES` (`0, 1, 2, 3, 8`)、`_setStampMode`、`updateStampUIVisibility`、`toggleStampPlace`、`_stampFrameFor`、`_stampDepthFor`、`_placeStampAt`、`_startStampDrag`、`_moveStampTo`、`_scaleStampBy` を実装。
  - デプスマップ（`buildStampDepth` / `stampDepth0`〜`stampDepth3`）による裏面・背後面の遮蔽（Occlusion）判定。

## 動作確認・テスト結果
1. **PaintTree 単体テスト (`node test-paint-tree.mjs`)**:
   - `29/29 passed`（水密性、マルチレイヤー、消去、ソフトブラシ、シリアライズ往復すべて合格）。
2. **構文・モジュール整合性チェック (`node --check`)**:
   - `js/main.js`, `js/exportPipeline.js`, `js/displacement.js`, `js/previewMaterial.js`, `js/meshPartition.js`, `js/mapping.js`, `js/paintTree.js` すべてエラーなしで通過。
3. **マルチレイヤー時のカラーON表示**:
   - `previewMaterial.js` の `compositeRawColor` 実装および `fragmentShader` のマスクティント条件修正により、カラーON時にも各レイヤーのマスク領域・スタンプ範囲ごとに正確にカラーテクスチャが分離・合成されるよう解決済み。



