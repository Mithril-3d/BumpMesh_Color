# 【 Phase 1 】カラー・マルチツール対応およびマルチボリューム 3MF 出力 実装計画

BumpMesh（stlTexturizer）を拡張し、カラー画像テクスチャの入力、減色クラスタリング（k-means++）、代表色パレットとExtruder IDのマッピング、オリジナル高解像度輝度による凹凸（Height Map）生成、ツール別メッシュ分割、および PrusaSlicer / OrcaSlicer / Bambu Studio 完全互換のマルチボリューム 3MF エクスポートを実現します。

---

## 1. 背景と課題
- 現行の BumpMesh はテクスチャ画像をグレースケール（Rチャンネル値のみ）として扱い、単一の STL / 3MF として出力しています。
- マルチカラー 3D プリンティング（Bambu AMS, Prusa MMU, ツールチェンジャー等）において、色境界に応じたメッシュ分割と、各パーツへの Extruder（フィラメント番号）の自動割り当てが必要とされています。
- 色数を減らした際にも表面の微細なディテール（凹凸）を失わないよう、減色とディスプレイスメントの処理を独立させます。

---

## 2. 提案するアーキテクチャと処理フロー

```
[ 入力カラー画像 (PNG/JPG) ]
     │
     ├──────────────────────────────────────────────┐
     ▼ (高解像度輝度計算)                               ▼ (k-means++ 減色)
  Luminance Map Y                               Quantized Map & Palette
  (0.2126R + 0.7152G + 0.0722B)                 (2〜8色代表色, ピクセル比率)
     │                                              │
     ▼                                              ▼
  [ 既存の細分化・ディスプレイスメント処理 ]          [ UIでの Extruder ID 割り当て ]
  ・高い凹凸ディテールを保持したメッシュ生成           ・Tool 1〜N の指定・プレビュー
     │                                              │
     └──────────────────────┬───────────────────────┘
                            ▼
               [ メッシュ分割 (Mesh Partition) ]
               ・各三角形のUVからツールIDを判定
               ・ツールごとのサブメッシュ（ボリューム）へ分離
                            ▼
          [ マルチボリューム 3MF パッケージング ]
          ・<object> 内のマルチボリューム / <components>
          ・<m:colorgroup> でのカラー定義
          ・Bambu / Orca 用 model_settings.config 同梱
          ・Prusa 用 Slic3r_PE.config 同梱
```

---

## 3. 変更・追加ファイル一覧

### 3.1 新規追加コンポーネント
1. `assets/textures/geometric_sample_4color.png`
   - テストおよびデフォルト用の4色幾何学グラフィック画像。
2. `js/colorQuantization.js`
   - 高速 k-means++ クラスタリング、代表色抽出、ピクセル比率計算。
   - ITU-R Rec.709 準拠の高解像度輝度サンプリング関数。
   - UV座標から最近傍パレット色および Extruder ID を判定する関数。
3. `js/meshPartition.js`
   - ディスプレイスメント済みメッシュ（BufferGeometry）を各ツールIDごとに分離するモジュール。
   - 頂点重複の再インデックスおよび部分メッシュの構築。

### 3.2 既存ファイルの変更
1. `index.html`
   - サイドバーに「カラー & マルチツール (Color & Multi-Tool)」セクションを追加。
   - 色数スライダー（2〜8色）、カラーパレットリスト、Extruder IDドロップダウン、プレビュー切替。
2. `style.css`
   - カラーチップ、パレットカード、Extruderセレクターのスタイリング。
3. `js/presetTextures.js`
   - デフォルトサンプル画像をプリセット一覧に登録。
4. `js/previewMaterial.js`
   - 3Dビューワーでマルチツール色を反映してプレビューできるマテリアル/シェーダー対応。
5. `js/displacement.js`
   - 高解像度カラー画像から正確な輝度（Luminance）を取り出して変位を計算するよう更新。
6. `js/exporter.js`
   - マルチパーツ 3MF 出力関数 `exportMultiColor3MF()` を実装。
   - PrusaSlicer, OrcaSlicer, Bambu Studio 互換の XML および設定ファイル（`Metadata/model_settings.config` 等）を ZIP 内に注入。
7. `js/main.js`
   - カラーUIイベントのリスナー、画像ロード時の減色処理キック、プレビュー更新、エクスポート処理の配線。

---

## 4. スライサー互換性仕様（3MF構造）

生成される 3MF は以下の内部ファイル構造を持ちます：
- `[Content_Types].xml`: 3MF Core および Material 仕様
- `_rels/.rels`: パッケージリレーション
- `3D/3dmodel.model`:
  - `<resources>`:
    - `<m:colorgroup id="1">`: 各ツールの HEX カラーリスト
    - `<object id="2" type="model">` 〜 `<object id="1+K" type="model">`: 各ツールの独立したサブメッシュ
    - `<object id="1" type="model">`: 各サブメッシュを束ねるアセンブリ `<components>`
  - `<build>`: `<item objectid="1"/>`
- `Metadata/model_settings.config` (Bambu Studio / OrcaSlicer):
  - オブジェクトおよび各パーツの Extruder ID (`extruder="1"`, `extruder="2"`...) を記述。
- `Metadata/Slic3r_PE.config` (PrusaSlicer):
  - PrusaSlicer のマルチマテリアル互換メタデータ。

---

## 5. 検証手順

1. **減色とUIの動作検証**:
   - サンプル画像およびアップロード画像において、2〜8色で正しくパレットが抽出されるか。
   - スライダーの変更やツール番号の再割り当てが即座にプレビューに反映されるか。
2. **凹凸ディテールの検証**:
   - 2色などの少ない色数に減色した場合でも、微細なグラデーション凹凸が失われず元の解像度で変位しているか。
3. **3MFエクスポートとスライサー検証**:
   - 出力された 3MF ファイルを解析し、ZIP内部構造、XML、設定ファイルが正しいか確認。
   - 各ツールごとに独立したボリュームとして正しく分離されているか検証。
