# タスクリスト: PrusaSlicer 2.9.6 および 3.0.0+ 両対応マルチカラー 3MF エクスポート (v1.2.1)

- [x] 1. 互換フォーマット設計と構造検証 <!-- id: 1 -->
  - [x] 1.1 `3.0.0alpha12.3mf` と `PrusaSlicer-2.9.6` の CLI 動作確認（2.9.6 で 3.0.0 形式がどう読まれるか検証） <!-- id: 2 -->
  - [x] 1.2 ハイブリッド 3MF 構造（`Slic3r_facets_annotation.json` + `PrusaSlicer3_project.json` + `slic3rpe:mmu_segmentation`）の定義 <!-- id: 3 -->
- [x] 2. `js/exporter.js` の改修 <!-- id: 4 -->
  - [x] 2.1 `exportMultiColor3MF` における `Metadata/Slic3r_facets_annotation.json` 自動生成の実装 <!-- id: 5 -->
  - [x] 2.2 `3D/3dmodel.model` への `<metadata name="slic3rpe:MmPaintingVersion">1</metadata>` 追加 <!-- id: 6 -->
  - [x] 2.3 `Metadata/PrusaSlicer3_project.json` の最小互換定義および `_rels/.rels` へのリレーション登録 <!-- id: 7 -->
  - [x] 2.4 `[Content_Types].xml` への JSON 拡張子定義追加 <!-- id: 8 -->
  - [x] 2.5 `<build><item ...>` への座標保持 `transform` 属性の実装 <!-- id: 9 -->
- [x] 3. バージョン更新およびドキュメント更新 <!-- id: 10 -->
  - [x] 3.1 `js/version.js`, `index.html`, `README.md`, `CHANGELOG.md` を v1.2.1 へ更新 <!-- id: 11 -->
- [x] 4. 動作検証とテスト <!-- id: 12 -->
  - [x] 4.1 生成された 3MF ファイルを PrusaSlicer 2.9.6 CLI でインポート・スライス検証 <!-- id: 13 -->
  - [x] 4.2 3.0.0 向け JSON 構文・ファセット配列・プロジェクト設定の完全性検証 <!-- id: 14 -->
  - [x] 4.3 `walkthrough.md` の作成 <!-- id: 15 -->
