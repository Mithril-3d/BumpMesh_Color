# タスクリスト: ネイティブメッシュUVモードにおけるサイズスライダー無効化バグの修正

- [x] 現象と原因の特定 <!-- id: 0 -->
  - [x] ネイティブメッシュUV（MODE_MESH_UV = 7）時にシェーダー `sampleMeshUVMap` / `sampleMeshUVMapColor` で `scaleUV` が欠落していることの確認 <!-- id: 1 -->
  - [x] CPU側 `computeUV` で `scaleU, scaleV` が `1, 1` にハードコードされていることの確認 <!-- id: 2 -->
- [x] 実装計画の作成 <!-- id: 3 -->
  - [x] `docs/fix_mesh_uv_scale_slider/implementation_plan.md` の作成 <!-- id: 4 -->
- [x] 修正の実施 <!-- id: 5 -->
  - [x] `js/previewMaterial.js` のシェーダー関数 `sampleMeshUVMap` / `sampleMeshUVMapColor` に `scaleUV` と `textureAspect` を適用 <!-- id: 6 -->
  - [x] `js/mapping.js` の `computeUV` で `MODE_MESH_UV` 時に `scaleU, scaleV` を適用 <!-- id: 7 -->
  - [x] `js/mapping.js` の `getScaleReferenceLengths` に `MODE_MESH_UV` の明示的ハンドリングを追加 <!-- id: 8 -->
  - [x] `js/main.js` でUV付きモデルロード時の初期スケールを 1:1（`_scaleAnchorMm()`）に設定 <!-- id: 9 -->
- [x] 動作確認・テスト <!-- id: 10 -->
  - [x] スクリプトによる自動検証（スライダー変更時のシェーダーuniform及びUV計算結果の確認） <!-- id: 11 -->
  - [x] エクスポート・スライス時のUV座標の検証 <!-- id: 12 -->
- [x] ドキュメント作成・コミット・プッシュ・デプロイ <!-- id: 13 -->
  - [x] `docs/fix_mesh_uv_scale_slider/walkthrough.md` の作成 <!-- id: 14 -->
  - [x] git commit & push (origin main / vercel) <!-- id: 15 -->
