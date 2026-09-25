# 実装計画: PrusaSlicer 2.9.6 および 3.0.0+ 両対応マルチカラー 3MF エクスポート (v1.2.1)

## 1. 概要
PrusaSlicer 3.0.0（フルリライト版）において、プロジェクト管理が JSON（`Metadata/PrusaSlicer3_project.json`）へ、ファセットペイント情報が `Metadata/Slic3r_facets_annotation.json` へ分離されたことにより、BumpMesh_Color の出力した 3MF を開いた際に座標やカラー情報が消えてしまう問題が発生した。
本改修では、既存の **PrusaSlicer 2.9.6**、**Bambu Studio**、**OrcaSlicer** との 100% 互換性を完全に維持しながら、**PrusaSlicer 3.0.0 以降** でも座標・カラー情報が正確に復元される「ハイブリッド 3MF フォーマット」を実装する。

## 2. 変更仕様

### 2.1 3MF パッケージ内ファイル構成
1. **`[Content_Types].xml`**:
   - `Extension="json"` (ContentType: `application/json`) を追加。
2. **`_rels/.rels`**:
   - `Type="http://schemas.prusa3d.cz/package/2024/relationships/metadata/projectfile"` で `Target="/Metadata/PrusaSlicer3_project.json"` を追加。
   - 既存のサムネイル、Bambu用 `model_settings.config`、Prusa 2.x用 `Slic3r_PE.config` はそのまま維持。
3. **`3D/3dmodel.model`**:
   - `<metadata name="slic3rpe:MmPaintingVersion">1</metadata>` を追加。
   - メッシュ構造を 3MF 標準のコンポーネントツリーに統一:
     - `object id="1"`: `<mesh>` (vertices + triangles, `slic3rpe:mmu_segmentation` と `paint_color` 属性付き)
     - `object id="2"`: ModelVolume (component objectid="1")
     - `object id="3"`: ModelObject (component objectid="2")
   - `<build>`:
     - `<item objectid="3" transform="1 0 0 0 1 0 0 0 1 0 0 0" />`
4. **`Metadata/Slic3r_facets_annotation.json`**:
   - 全三角形のファセットペイント情報を `[{"id": 2, "mmSegmentationFacetsVersion": 1, "mmSegmentationFacets": [{"triangle": i, "dividing": code}, ...]}]` として生成・格納。
5. **`Metadata/PrusaSlicer3_project.json`**:
   - PrusaSlicer 3.0.0 が「プロジェクト」として認識し座標・オブジェクト設定を保持するための最小限の JSON を格納。
6. **`Metadata/Slic3r_PE.config` & `Metadata/model_settings.config`**:
   - オブジェクトID (id=3) およびボリュームID (id=2) に合わせて更新。

### 2.2 バージョン更新 (v1.2.1)
- `js/version.js`
- `index.html`
- `README.md`
- `CHANGELOG.md`

## 3. 検証計画
1. `node` または Python スクリプトによる生成 3MF の内部構造検査（XML構文、JSON構文、ZIPエントリー順序、リレーション）。
2. インストール済み **PrusaSlicer 2.9.6 CLI** による直接スライス検証 (`--info`, `--export-gcode`)。
3. `3.0.0alpha12.3mf` との構造一致度比較検証。
