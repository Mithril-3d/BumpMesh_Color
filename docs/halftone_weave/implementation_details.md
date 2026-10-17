# ハーフトーン編み（Halftone Weave）詳細実装仕様書・引継ぎ資料

本資料は、`meditat38/nozzleboss` の Full Color Halftone（フルカラー・ハーフトーン編み重ね）の知見を取り入れて `BumpMesh_Color` に新規追加した **「Profile 5: ハーフトーン編み（内壁固定・写真・多色向け）」** の実装詳細、コード構造、数式モデル、動作検証結果、および Agy IDE（Antigravity IDE）での今後の作業継続に向けた引継ぎ事項をまとめたものです。

---

## 1. 概要と基本アーキテクチャ

### 1.1 開発背景と目的
- **背景**: `meditat38/nozzleboss` では、一定ピッチの周方向波形（`Density: 1600`）と突出ストローク（`Displacement Strength: 2.5mm`）を用いて、多色フィラメントの露出度合いを物理的なループ突起として飛び出させることで、美しいフルカラー織物表現（Halftone）を実現していた。
- **課題**: 従来の `BumpMesh_Color` のブロック編み（Profile 4）は、壁全体が内外に平行シフトする「肉厚一定の輪ゴム構造（$r_{in} = r_{out} - \text{wall}$）」であったため、突出ストロークを 0.8mm 以上に大きくすると、上下の層と接触できずに空打ち・重力による垂れ落ちが発生していた。
- **解決策**: 既存の Profile 0〜4（フラット、45°ルーバー、正弦波、三角波、ブロック）の互換性を完全に保ったまま、新たに **「Profile 5: ハーフトーン編み」** を新設。
  1. **内壁アンカー固定（$r_{in}$ 固定）**: 内壁半径をベース円筒面上に常時固定し、全層の垂直密着度を 100% 確保。
  2. **外壁ループ突起**: 見せたい色のみが外側へループ状に飛び出し、隠したい色はベース面（変位 0mm）に完全退避。
  3. **2色ハイライト結合**: 高明度領域で波形の山が繋がり、作例写真のような連続フラットリブを形成。
  4. **多色谷アンカー＆混色補正**: 3色以上では他色が引っ込んでいる層の上でも確実に下層へアンカー溶着し、混色部での痩せを防ぐ輝度補正（Brightness Compensation）を適用。

---

## 2. 数式モデルとアルゴリズム

### 2.1 変位計算式（Displacement）
各レイヤー $lay$、周方向角度 $\theta$、色インデックス $c$ における変位量 $disp$：

$$disp(\theta, lay, c) = -concave + stroke \times exposure \times B(\theta, lay, c)$$

- $stroke$: 設定された最大突出ストローク（mm）
- $concave$: 引っ込み量（mm、通常は 0）
- $exposure$: 画像からサンプリングされた当該色の露出度（$0.0 \sim 1.0$）
- $B$: 周方向の波形関数（$-1.0 \sim 1.0$ または $0.0 \sim 1.0$）

### 2.2 2色モード（High-Exposure Ribbon Blending）
2色印刷（白黒写真など）では、高露出部（$exposure > 0.65$）において波の山が横方向に広がり、隣接周期と繋がってフラットな帯（リブ）を形成します：

```javascript
// js/layerBlending.js (Profile 5 2色モード抜粋)
const rawWave = Math.sin(theta * waveFreq + layerPhase);
const dutyRatio = 0.5 + (exposure - 0.5) * 0.4;
const pulseWave = (Math.sin(theta * waveFreq + layerPhase) > (1.0 - 2.0 * dutyRatio)) ? 1.0 : -1.0;
const wave = rawWave * 0.4 + pulseWave * 0.6;

if (exposure > 0.65) {
    const clipThreshold = 1.0 - (exposure - 0.65) * 2.0;
    if (wave > clipThreshold) {
        // 山同士が繋がって平坦なリブになる
        return -concaveVal + stroke * exposure;
    }
}
```

### 2.3 多色モード（3〜4色：Anchored Multi-Color Loop）
3色以上では、各色が異なる層として順番に積層されます。他色の層が引っ込んでいる間、白や有彩色が空中に浮かないよう、**各波形の谷が必ずベース円筒面（変位 0mm）に戻るアンカー構造** としています：

```javascript
// 各色に位相オフセットを与え、同じ色が次の周期で半周期ずれる千鳥配置
const phi_c = (toolIndex * (Math.PI / 2.0)) + (colorCycleIndex * Math.PI);
const wave01 = 0.5 + 0.5 * Math.sin(theta * waveFreq + phi_c);

// Secondary Color Brightness Compensation (混色ブースト補正)
const comp = 1.0 + (1.0 - exposure) * 0.35;
const effExposure = Math.min(1.0, exposure * comp);

// 谷（wave01 = 0）のときは disp = 0mm でベース円筒に強固に溶着
return -concaveVal + stroke * effExposure * wave01;
```

### 2.4 内壁固定メッシュ生成（Anchored Rubber Band Tube）
従来の Profile 4 と異なり、内壁半径 $r_{in}$ を外壁変位に追従させず、ベース円筒上にアンカーします：

```javascript
// js/weaveTubeGenerator.js (Profile 5 抜粋)
const r_out = Math.fround(r_base + disp);
// 内壁は常にベース円筒面（または外壁の最小側）から wall 厚分内側に固定
const r_in = Math.fround(Math.min(r_base, r_out) - wall);
```
- **幾何学的メリット**:
  - 全層の内壁同士が常に同一円筒面上（$r \approx r_{base} - wall$）に存在するため、外壁が 2.5mm 突出しても中空にならず、内壁が垂直な柱となってモデルの自立強度を 100% 担保します。
  - スライサー（Arachne）を通した際、突出部が薄いリボンではなく三角形・台形のフィン状ソリッドとして認識され、太い樹脂ループが射出されます。

---

## 3. 変更・追加されたファイル一覧

| ファイルパス | 変更区分 | 主な変更内容 |
| :--- | :---: | :--- |
| `index.html` | 修正 | `#interleaved-profile-mode` に `<option value="5" data-i18n-opt="color.profileHalftone">🎭 ハーフトーン編み（内壁固定・写真・多色向け）</option>` を追加 |
| `js/i18n/ja.js` | 修正 | `color.profileHalftone: '🎭 ハーフトーン編み（内壁固定・写真・多色向け）'` を追加 |
| `js/i18n/en.js` | 修正 | `color.profileHalftone: '🎭 Halftone Weave (Anchored Inner Wall / Multi-Color)'` を追加 |
| `js/layerBlending.js` | 修正 | `computeLouverDisplacement` に `profileMode === 5` の分岐を追加。2色ハイライトクリッピング、多色アンカー波形、混色ブーストを実装 |
| `js/weaveTubeGenerator.js` | 修正 | `generateWeaveRubberBandTube` に `profileMode === 5` のメッシュ生成ロジックを追加。内壁アンカー固定、キーポイント12分割補間を適用 |
| `js/previewMaterial.js` | 修正 | WebGL GLSL バーテックスシェーダー（`computeHeightAtPoint`）およびフラグメントシェーダー（`computeColorAtPoint`）に Profile 5 の変位・混色ロジックを完全移植 |
| `js/main.js` | 修正 | `isWeaveMode`（編み重ねモード判定）に `profileMode === 5` を追加。UIラベル表示、3MF エクスポート時のチューブ生成呼び出しと同期 |
| `docs/halftone_weave/` | 新規 | 仕様比較資料、実装計画、タスクリスト、ウォークスルー、図解SVG等を格納 |

---

## 4. Gitブランチおよびデプロイ状態

- **リポジトリ**: `https://github.com/Mithril-3d/BumpMesh_Color`
- **現在のブランチ**: `feature/halftone-weave`
- **追跡リモート**: `origin/feature/halftone-weave`
- **最新コミット**: `feat(weave): add Profile 5 Halftone Weave with anchored inner wall` (コミットハッシュ: `175273b`)
- **Vercel デプロイ環境**:
  - **環境**: Preview（※ユーザー指示に基づき、本番 Production には一切デプロイしていません）
  - **Preview URL**: `https://bump-mesh-color-35bfhg0e6-mithril-3d.vercel.app`
  - **状態**: 正常デプロイ完了（Vercel Authentication が有効なため、ログイン中ブラウザまたはローカル Live Server での確認を推奨）

---

## 5. Agy IDE で続きを行うためのチェックポイント＆推奨タスク

### 5.1 ローカルでの即時動作確認方法
VS Code / Agy IDE 内で Live Server を起動して確認できます：
1. 画面右下のステータスバーにある **`((•)) Go Live`** をクリック。
2. ブラウザで `http://127.0.0.1:5500/index.html` が開きます。
3. プロファイル選択から **「🎭 ハーフトーン編み（内壁固定・写真・多色向け）」** を選択して動作確認。

### 5.2 Agy IDE で今後拡張・調整できる機能候補
1. **専用パラメータのスライダーUI追加（現在は定数定義）**:
   - `Density`（周方向の波の密度／1周あたりの波の数。現在は既定値）
   - `Brightness Compensation`（混色部での第2色飛び出しゲイン補正係数）
   - `Highlight Clip Threshold`（2色モードでフラットリブ化する露出度の境界閾値）
2. **スライサーでの実機スライス検証**:
   - 生成された `.3mf` を Bambu Studio / OrcaSlicer に読み込み、「壁生成エンジン: Arachne」でスライスして、内壁の垂直密着と外壁ループの樹脂充填パスを確認。
3. **本番ブランチ（main）へのマージ**:
   - 実機検証完了後、GitHub 上で `feature/halftone-weave` から `main` への Pull Request を作成・マージ。
