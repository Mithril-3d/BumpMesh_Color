# タスクリスト: 交互積層マルチツール振り重ねにおける無段階カラーグラデーション機能の実装

- [x] 1. 設計とドキュメント作成 <!-- id: 0 -->
  - [x] グラデーション補間アルゴリズムの設計（2色ベクトル射影方式、平易な表記）
  - [x] `task.md` および `implementation_plan.md` の作成
- [x] 2. コアロジックの実装 (`js/layerBlending.js`) <!-- id: 1 -->
  - [x] `computeColorBlendWeight(rgb, colorA, colorB)` 関数の実装
  - [x] `computeLouverDisplacement` に `shadingMode` (0: シャープ/二値, 1: グラデーション/連続階調) と `blendWeight` の対応を追加
- [x] 3. UIの追加 (`index.html`, `js/main.js`) <!-- id: 2 -->
  - [x] 「交互積層」パネル内に「階調表現: シャープ (二値 / 0-1) / グラデーション (連続階調)」セレクトボックスを追加
  - [x] `main.js` にイベントリスナーと状態管理を追加
- [x] 4. 変位パイプラインと3Dプレビューの統合 (`js/displacement.js`, `js/previewMaterial.js`) <!-- id: 3 -->
  - [x] `sampleRGBBilinear` による滑らかなカラーサンプリングと `blendWeight` 計算の統合
  - [x] 3Dプレビューシェーダーでグラデーション変位（ルーバー庇スロープ自動スケーリング）を反映
- [x] 5. 検証テスト <!-- id: 4 -->
  - [x] 256階調連続性・単調性テストスクリプトによる厳密な数値検証パス
  - [x] 45°オーバーハング角度の安全性検証パス
- [x] 6. ドキュメントまとめ (`walkthrough.md`) とコミット <!-- id: 5 -->
