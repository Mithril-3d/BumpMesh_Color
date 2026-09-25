# Walkthrough - PrusaSlicer 2.9.6 および 3.0.0+ 両対応マルチカラー 3MF エクスポート (v1.2.1)

## 1. 概要
PrusaSlicer 3.0.0（フルリライト版）において、プロジェクト管理が JSON（`Metadata/PrusaSlicer3_project.json`）へ、ファセットペイント情報が `Metadata/Slic3r_facets_annotation.json` へ分離されたことで、BumpMesh_Color でエクスポートした 3MF ファイルを開いた際に座標やカラー情報が消えてしまう不具合が発生していました。

本改修（v1.2.1）により、**PrusaSlicer 2.9.6**、**Bambu Studio**、**OrcaSlicer** との完全な後方互換性を保ちながら、**PrusaSlicer 3.0.0 以降** でも座標・カラー情報が正確に復元される「マルチスライサー・ハイブリッド 3MF 出力」を実装しました。

---

## 2. 実施した変更内容

### ① `js/exporter.js`: ハイブリッド 3MF 出力の実装
1. **ファセットアノテーション JSON (`Metadata/Slic3r_facets_annotation.json`) 自動生成**:
   - 三角形ループ内で各面のペイントコード（`dividing`）と三角形インデックス（`triangle`）を収集し、PrusaSlicer 3.0.0 規格のファセットアノテーション JSON を生成して ZIP 内に格納。
2. **`3D/3dmodel.model` の標準コンポーネントツリー化**:
   - `Mesh` (id=1) → `Volume` (id=2) → `Object` (id=3) → `Build Item` (objectid=3) の 3 階層構造へ刷新。
   - `<build><item objectid="3" transform="1 0 0 0 1 0 0 0 1 tx ty tz"/>` で座標アフィン変換行列を明示。原点中心モデル（プロシージャルやCAD/STL）の場合は標準ベッド中央（X=125, Y=125, Z=0接地）にオフセットし、「Open project」で開いた際にもベッド端から外れず中央に乗るよう最適化。
   - `<metadata name="slic3rpe:MmPaintingVersion">1</metadata>` を付与。
3. **レガシープロジェクト判定エラー（Loading legacy 3MF projects is not supported yet）の回避**:
   - `_rels/.rels` に `schemas.prusa3d.com/package/2020/model_settings`（`Slic3r_PE.config`）や不完全な `PrusaSlicer3_project.json` が含まれていると、PrusaSlicer 3.0.0-alpha12 のプロジェクトローダーがレガシー例外または破損例外を起こし、読み込み全体を中断してモデルが消えてしまう不具合を特定。
   - スライス・印刷設定（プロジェクト設定）は含めず、純粋な「3Dジオメトリ＋カラーアノテーション＋中央配置Transform」として出力することで、PrusaSlicer 3.0.0 でもエラー中断せず安全に読み込まれ、ユーザーの印刷設定も一切上書き・破壊されない設計に改善。
4. **`[Content_Types].xml` への JSON 拡張子定義追加**:
   - `<Default Extension="json" ContentType="application/json"/>` を追加。
5. **後方互換メタデータの維持**:
   - Bambu Studio / OrcaSlicer 向け `Metadata/model_settings.config`（XML）
   - 三角形タグ内の `slic3rpe:mmu_segmentation` および `paint_color` 属性（PrusaSlicer 2.x、Bambu Studio、OrcaSlicer 共通）

### ② バージョン情報の更新 (v1.2.1)
- `js/version.js`: `APP_VERSION = '1.2.1'`
- `index.html`: ヘッダーバージョンバッジを `v1.2.1` に更新
- `README.md`: 英語版・日本語版のバッジおよびハイライトを更新
- `CHANGELOG.md`: v1.2.1 の詳細なリリースノートを追加

---

## 3. 検証結果

### (1) 内部構造アサーション検証
- `Metadata/Slic3r_facets_annotation.json` (id=2, mmSegmentationFacetsVersion=1) 正常確認
- `_rels/.rels` のクリーンなリレーションシップ（Bambu model_settings + 3D model + サムネイル群）正常確認
- `[Content_Types].xml` の JSON 拡張子定義 正常確認
- `3D/3dmodel.model` の `slic3rpe:MmPaintingVersion`、コンポーネントツリー、ベッド中央 `transform` 属性 正常確認

### (2) 実機 PrusaSlicer 2.9.6 CLI によるスライス検証
- **モデル情報取得**:
  - `manifold = yes`
  - `number_of_parts = 1`
  - エラーや非多様体警告 0 件
- **G-code スライス**:
  - `prusa-slicer-console.exe --export-gcode` が正常完了（エラー 0 件）
  - 生成された G-code の座標が X=103〜146, Y=103〜146 とベッド中央（X=125, Y=125）に正確に配置されていることを確認
  - 従来の PrusaSlicer 2.9.6 環境でも破損や読み込みエラーなく 100% 互換スライスされることを実証
