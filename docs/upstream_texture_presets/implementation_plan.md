# 実装計画: 本家BumpMeshのテクスチャプリセット拡充＆ギャラリー・フィルタ機能取り込み

本家 (CNC Kitchen - upstream/main) の最新アップデート（v1.3.0 〜 v1.3.6）において導入された**「Texture Gallery（テクスチャギャラリー・サイドパネル）」**、**「カテゴリ絞り込みフィルター＆検索機能」**、**「お気に入りピン留め機能」**、**「IndexedDBによるマイテクスチャ管理」**、および**「大量の新規テクスチャプリセット（Japandi、Cobblestone、Hero Patterns、Filter Forge等）」**を、BumpMesh_Color の独自機能（マルチカラー3Dプリント、振り重ね交互積層、3色パターンジェネレータ PRO 等）と一切干渉させることなく美しくマージ・統合します。

---

## 1. ユーザー要求と背景
- **要望**: 本家 BumpMesh で大幅に追加されたテクスチャプリセット、選択パネル、およびフィルタ機能を取り込みたい。
- **ブランチ方針**: 作業用の新ブランチ（`feature/upstream-texture-gallery`）で安全に実装・検証する。
- **注意点**: BumpMesh_Color 独自に追加された和柄・マルチカラーテクスチャ群（青磁、市松、青海波、矢絣、麻の葉、巴、ステンドグラス、雪豹など）や、3色パターンジェネレータとの連携を絶対に消去・破壊せず、ギャラリーの新カテゴリ（例: `multicolor`）として共存・洗練させる。

---

## 2. 取り込み・実装する主要コンポーネント

### 2.1 新規スクリプト
1. **`js/textureGallery.js`**:
   - 常時表示のお気に入り（Favourites）グリッド（デフォルト12個）の構築。
   - スライドイン式の「Texture Gallery」サイドパネル（全カタログ閲覧、カテゴリチップ、キーワード検索、ターンテーブル回転連動、★ピン留め）。
   - キーボード矢印キーでの高速テクスチャプレビュー切り替え。
2. **`js/customTextures.js`**:
   - IndexedDB を用いたユーザー独自アップロード画像の端末内ローカル保存・再利用・削除・ダウンロード機能（"Your textures"）。
3. **`js/sidebarToggle.js`**:
   - サイドバー/ギャラリーパネルの折りたたみトグルボタン（ビューポート最大化用）。

### 2.2 テクスチャアセットのマージ (`textures/` & `textures/thumbs/`)
- 本家で追加された新規テクスチャ画像（PNG/JPG/WebPサムネイル）をすべて安全に取り込む。
- 既存の BumpMesh_Color 独自テクスチャをそのまま維持。

### 2.3 プリセット定義の統合 (`js/presetTextures.js`)
- 本家で追加された約60種類の新プリセット（Japandi、Hero Patterns、CC0、Filter Forge）をすべて定義。
- 各プリセットに `category`（`geometric`, `patterns`, `organic`, `fabric`, `natural`, `grip`）および `credit`（`hero`, `cc0`, `ff`）を設定。
- BumpMesh_Color 独自のマルチカラーテクスチャ群にも `category: 'multicolor'` を付与し、ギャラリー内で「マルチカラー / 和柄」として美しくフィルタリングできるようにする。
- `DEFAULT_FAVOURITES` の選定。

### 2.4 UI・HTML・スタイルの統合 (`index.html` & `style.css`)
- `index.html`:
  - `Displacement Map` セクション内のお気に入りグリッド `#preset-grid`。
  - 「Texture Gallery」起動ボタン（件数バッジ付き）。
  - サイドパネル `#gallery-panel` のマークアップ（ヘッダー、検索バー、カテゴリチップ、ステータス、ボディ、クレジット）。
- `style.css`:
  - ギャラリーサイドパネル、グリッド、検索バー、カテゴリバッジ、★ピン留めボタン、クレジット表示等のレスポンシブスタイルを追加。

### 2.5 `js/main.js` との連携
- `initTextureGallery` の初期化呼び出し。
- テクスチャ選択（`selectPreset`, `selectCustomTexture`）時の BumpMesh_Color 独自カラーパイプライン（RGBサンプリング、カラー量子化、振り重ねモードの自動判定等）とのシームレスな同期。
- 言語切り替え時の `gallery.refreshText()` 呼び出し。

### 2.6 多言語対応 (`js/i18n/*.js`)
- `gallery.*` の全翻訳キー（タイトル、検索、カテゴリ、ターンテーブル、お気に入り、カスタムテクスチャ管理等）を各言語辞書に追加。
- 日本語・英語に加えて新カテゴリ `gallery.catMulticolor` を追加。

---

## 3. 実装ステップ計画

1. **テクスチャアセットの抽出・同期**:
   - `git checkout upstream/main -- textures/` から新規テクスチャ画像およびWebPサムネイルをインポート（既存ファイルを上書きしないよう保護）。
2. **スクリプト追加**:
   - `js/customTextures.js` を upstream から導入。
   - `js/textureGallery.js` を upstream から導入し、BumpMesh_Color 向けに微調整。
   - `js/sidebarToggle.js` を導入。
3. **`js/presetTextures.js` の刷新**:
   - 本家の新プリセット定義とカテゴリ定義を取り込み、BumpMesh_Color 独自プリセット（`category: 'multicolor'`）を統合。
4. **UI（HTML/CSS）統合**:
   - `index.html` にギャラリーサイドパネルとボタン群を追加。
   - `style.css` にギャラリースタイルを追加。
5. **`js/main.js` 統合**:
   - ギャラリー初期化とイベントハンドラの配線。
6. **i18n 辞書の更新**:
   - `js/i18n/ja.js`, `js/i18n/en.js` 等にキーを追加。
7. **動作検証**:
   - ブラウザでのギャラリー開閉、検索、カテゴリ絞り込み、お気に入り登録、ターンテーブル、テクスチャ適用、マルチカラー機能の正常動作を確認。
