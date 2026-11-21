# タスクリスト: テクスチャレイヤー機能 & スタンプ機能の導入 (v2.0.0)

- [x] フェーズ 0: 準備と計画策定 <!-- id: 0 -->
  - [x] 新規ブランチ `feature/texture-layers` 作成 <!-- id: 1 -->
  - [x] `docs/texture_layers/task.md` の作成 <!-- id: 2 -->
  - [x] `docs/texture_layers/implementation_plan.md` の作成 <!-- id: 3 -->
- [x] フェーズ 1: PaintTree および レイヤー基盤モジュールの導入 <!-- id: 4 -->
  - [x] `js/paintTree.js` の導入と基本テスト <!-- id: 5 -->
  - [x] レイヤーデータ構造（`layers[]` 配列、レイヤー切り替え、アクティブレイヤー管理）の実装 <!-- id: 6 -->
  - [x] レイヤーストリップUI（追加、削除、非表示、ブレンドモード切替）のHTML/CSS/イベント追加 <!-- id: 7 -->
- [x] フェーズ 2: 複数レイヤーのプレビュー合成と凹凸エクスポート <!-- id: 8 -->
  - [x] `js/previewMaterial.js` のマルチレイヤー対応（最大4サンプラー、頂点ごとのOver/Add合成） <!-- id: 9 -->
  - [x] `js/displacement.js` / `js/exportPipeline.js` の複数レイヤー凹凸変位計算の統合 <!-- id: 10 -->
  - [x] BumpMesh_Color 独自機能（カラーモード、交互積層、Native Mesh UV）との共存ガード実装 <!-- id: 11 -->
- [x] フェーズ 3: スタンプ機能（Stamp Mode）の移植 <!-- id: 12 -->
  - [x] `js/mapping.js` へのスタンプフレーム・UVサンプリング計算の追加 <!-- id: 13 -->
  - [x] 3Dビューポートでのスタンプ配置（クリック）、ドラッグ移動、ホイールサイズ変更イベント <!-- id: 14 -->
  - [x] Surface Normal投影 (`MODE_SURFACE_NORMAL = 8`) および裏面遮蔽（Occlusion）処理の統合 <!-- id: 15 -->
- [x] フェーズ 4: 総合テスト・多言語ローカライズ・v2.0.0 リリース準備 <!-- id: 16 -->
  - [x] 単一レイヤー（既存プロジェクト・全機能）の動作リグレッション検証 <!-- id: 17 -->
  - [x] 複数レイヤー合成（Over/Add）およびスタンプ機能のエンドツーエンド動作検証 <!-- id: 18 -->
  - [x] 課題対応: マルチレイヤー時のカラーON表示のレイヤーマスク連動（色だけ全面に上書きされる問題の修正） <!-- id: 21 -->
  - [x] `docs/texture_layers/walkthrough.md` の作成・更新 <!-- id: 19 -->
  - [x] CHANGELOG.md / version.js 更新 (v2.0.0) <!-- id: 20 -->



