# 3MFマルチカラーサムネイルのカラー化 Walkthrough

3MFマルチカラーエクスポート時に、BumpMesh_Colorで設定された各ツールの配色（パレットカラー）を反映したカラー3Dサムネイル画像を生成・埋め込む改良を実施しました。

## 変更内容の概要

### 1. `viewer.js`: `generateColorThumbnail` の追加
- **頂点カラーの自動設定**:
  - 各三角形のツールID（`triTools`）と `palette`（各ツールのRGB）を照合し、頂点カラー属性（`color`）を付与。
- **独立したオフスクリーンレンダリング**:
  - メインの3Dビュー画面やユーザーのカメラ操作に影響を与えないよう、一時的な `THREE.Scene` とカメラを構築。
  - 立体感と色の再現性が最も美しくなるライティング（環境光＋指向性ライト2基）および斜め見下ろしカメラを設定。
  - 一時的なリソース（マテリアル、ジオメトリ、シーン）はキャプチャ後に即時破棄（dispose）し、メモリリークを完全防止。
- **フェイルセーフ**:
  - 万が一パレットやツール情報が不完全な場合は、従来の `getViewerThumbnail` に自動フォールバック。

### 2. `exporter.js`: スライサー標準・Windows標準・各種ビューワー完全互換への最適化（v1.0.41）
- **F3D / Assimp との互換性修正**:
  - 一部環境（F3D等）で `m:colorgroup` および `pid` 属性がパーサーエラーを引き起こし、メッシュ全体が真っ黒にレンダリングされる現象を解消するため、これらの属性を安全に除去。
  - スライサー（PrusaSlicer, Bambu Studio, OrcaSlicer）のマルチカラー認識タグ（`slic3rpe:mmu_segmentation` / `paint_color`）は完全維持。
- **全サムネイル規格の「全乗せ」格納**:
  - BambuLab規格: `/Metadata/plate_1.png`, `/Auxiliaries/.thumbnails/thumbnail_3mf.png`
  - PrusaSlicer規格: `/Metadata/thumbnail.png`, `<metadata name="Thumbnail">`
  - 3MF Core / OpenXML規格: `/Thumbnails/thumbnail.png`, `_rels/.rels`
  - 高速ストリーミング読み込みのため、ZIPアーカイブの先頭にサムネイル画像を配置。

### 3. `main.js`: 3MFエクスポート処理の連携
- マルチカラー3MFエクスポート（レイヤーブレンドモード / 通常量子化モード）において：
  - `generateColorThumbnail(finalGeometry, triTools, exportPalette, 256)` を呼び出し、生成されたカラーサムネイルを3MFパッケージに格納。

### 4. バージョン更新とキャッシュバスター
- `version.js`: `APP_VERSION` を `1.0.41` に更新。
- `main.js`: `exporter.js?v=20260918_141` に更新。

---

## 検証と診断結果

### 1. 「真っ黒な正方形」および「単色グレー」現象の根本原因
- **F3D シェル拡張によるサムネイル横取り**:
  - ユーザー環境において、`.3mf` のシェル拡張が `F3DShellExtension.dll` に割り当てられており、ZIP内の画像（`thumbnail.png`）を読まずに3Dメッシュを自前レンダリングしていた。
  - F3D内蔵の Assimp 5.4.0 が `m:colorgroup` を解釈できず、マテリアル未定義エラーで全体が黒塗りになっていた。
- **v1.0.41 での修正**:
  - `m:colorgroup` / `pid` を除去したことで、F3D環境でも真っ黒にならず正常な3D立体として描画されるよう修正。

### 2. Windows標準サムネイルハンドラーへの切り替えとカラー表示の実証
- `.3mf` のサムネイルハンドラーを Windows 標準（`ms3dthumbnailprovider.dll`）に切り替え。
- ディスククリーンアップで古いサムネイルキャッシュをクリアした結果：
  - **エクスプローラー上で、オフホワイト背景に青磁色の美しいカラーテクスチャが施された立体キューブ（`cube_... (4).3mf`）や円柱が、完全にカラー画像として表示されることをユーザー環境で実証・確認完了**。
