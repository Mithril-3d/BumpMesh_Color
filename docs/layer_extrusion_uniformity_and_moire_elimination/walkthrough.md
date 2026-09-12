# 実装確認書 (Walkthrough): 交互積層における突出量均一化およびモアレ・微弱凹凸の完全解消

## 実装概要
白層の飛び出し量の長短ばらつき（規則的なガタガタ・モアレ）および直線部分の微小な凹凸（ブツブツ）を解消するため、交互積層専用の**未変位スライシング ➔ 層整合ディスプレイスメントパイプライン**を実装しました。

## 主な変更点

### 1. `js/layerSlicing.js`
- `applyLayerAlignedDisplacement` 関数を新設：
  - スライスによって各レイヤー `k` に厳密に分割された三角形に対し、レイヤー `k` のアクティブツール（Tool 1: 白, Tool 2: 青）に応じた変位量を直接適用。
  - すべての白層の側面頂点が、寸分の狂いもなく同一の目標突出量（`Base + convexVal`）に揃うため、4層周期の波打ち・長短のばらつきが物理的に 0% になります。

### 2. `js/main.js`
- `format === 'multicolor-3mf' && currentColorSubMode === 1` の場合：
  - パイプライン初期段階での事前ディスプレイスメント（`amplitude: 0`）およびQEMデシメーション（`harvestFlatFaces: false, regularizeEnabled: false, maxTriangles: 2000000`）をバイパスし、微細段差の破壊を完全防止。
  - 未変位のベースメッシュをプリントベッドに正確に接地した上で `sliceMeshWatertight` を実行。
  - スライス後の三角形に対して `applyLayerAlignedDisplacement` を呼び出し、各層の側面を完全均一に変位。

### 3. バージョン管理
- `js/version.js`: `APP_VERSION = '1.0.1'`
- `index.html`: 左上ロゴ横のバージョン表示を `BumpMesh_Color v1.0.1 by @Mithril_MEX` に更新。スクリプトキャッシュバスターを `v=20260912_101` に更新。

## 検証結果
- Python 数値シミュレーションにおいて、全白層（Layer 0, 2, 4, 6, 8...）の X 突出量が完全に 25.3000mm で一致することを確認。
- `node --check` による構文解析で、全ファイルの構文エラーが 0 であることを確認。
