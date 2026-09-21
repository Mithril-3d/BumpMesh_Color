# 保存機能更新および v1.1.4 ウォークスルー

BumpMesh_Color の設定保存機能の拡張（`sessionStorage` / `localStorage` の切替）、プライバシーポリシーの全13言語更新、および `.bumpmesh` プロジェクト保存・読込の全機能対応（Color/Multi-Tool, Interleaved, Model Scale, AutoFit）が完了しました。

---

## 修正したファイル一覧

1. **[index.html](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/index.html)**
   - 設定パネル上部に「Auto-save（自動保存）」切替セグメントUI（Session / Persistent）を追加。
   - プライバシーポリシーの英文（デフォルト）を、ユーザー選択に応じた保存先と端末外非送信の明記に更新。
   - バージョン表示を `v1.1.4` に更新、スクリプトのキャッシュバスターを更新。

2. **[style.css](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/style.css)**
   - `.storage-mode-row`, `.storage-mode-toggle`, `.storage-mode-btn` のスタイルを追加（ダーク・ライト両テーマ対応）。

3. **[js/main.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/main.js)**
   - **ストレージ切替ロジック**: `setStorageMode()`, `getActiveStorage()`, 切替時の旧ストレージ消去による競合防止。
   - **設定スナップショット拡張 (`getSettingsSnapshot`)**: Color, Interleaved, Model Scale, AutoFit の全パラメータを保存対象に追加。
   - **設定復元拡張 (`applySettingsSnapshot`)**: 全新機能のパラメータ復元、イベント発火、UI同期。
   - **二重スケール防止 (`_geometryToBinarySTL`)**: 保存時、原寸（100%基準）の基本ジオメトリ `_baseGeometryPositions` をシリアライズし、インポート時の倍率再適用による二重拡大・縮小を防止。
   - **設定のみインポートのAutoFit復元**: モデルがない状態で設定のみをインポートした場合に、AutoFit条件から自動モデル生成を行うフォールバックを追加。
   - **全ストレージリセット (`resetSettingsToDefaults`)**: 選択中のストレージおよび両ストレージからキーを初期化。

4. **[js/version.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/version.js)**
   - `APP_VERSION = '1.1.4'` に更新。

5. **[js/i18n/*.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/i18n/)（全13言語: ja, en, zh, de, fr, es, it, pt, ko, pl, ru, tr, uk, da）**
   - ストレージ切替UI用キー（`storage.modeLabel`, `storage.session`, `storage.local`, `storage.sessionDesc`, `storage.localDesc`）を追加。
   - `imprint.privacyLocal` の文面を各言語で適切に更新。

---

## 主な仕様と対応内容

### 1. `sessionStorage` / `localStorage` 切替仕様
- **保存方式**:
  - **短期保存 (Session)**: `sessionStorage` を使用。タブを閉じるまで保持され、リロードでも維持。
  - **長期保存 (Persistent)**: `localStorage` を使用。ブラウザを終了しても設定が永続化。
- **選択状態の記憶**:
  - ユーザーが選択した保存方式自体のキー（`bumpmesh-storage-mode`）は `localStorage` に保持され、次回起動時も前回の選択状態が継続されます。
- **データ競合防止**:
  - 保存先を切り替えた瞬間、古いストレージに残っていた `bumpmesh-settings` を確実に `removeItem` で消去し、新ストレージへ最新スナップショットを即座に書き込みます。

### 2. `.bumpmesh` 保存・読込の後方互換性と新機能対応
- **追加された保存・復元項目**:
  - **Color / Multi-Tool**: Color Mode ON/OFF, Color Preview ON/OFF, Color Count, Color Sub Mode, 各色Tool割当, Untextured Tool, パレット情報
  - **Interleaved**: Layer Thickness, Convex Amp, Concave Amp, Profile Mode, Shading Mode
  - **Model Scale**: X倍率, Y倍率, Z倍率, Uniform Scale ON/OFF
  - **AutoFit / 自動生成モデル**: 解放状態, Model Mode, Shape, Height, Repeat, Ngon
- **モデル倍率の二重適用防止**:
  - モデルを含むプロジェクト保存時、原寸（100%）の頂点データでSTLを保存し、設定JSONに倍率（例: 150%）を記録。
  - インポート時にモデル読み込み（100%基準）→ 設定適用（150%へスケール）が行われるため、二重拡大・縮小が発生しません。
- **後方互換性**:
  - 古いバージョンの `.bumpmesh` ファイル（新項目が存在しない場合）でも、安全なデフォルト値（`snap.xxx != null ? snap.xxx : default`）によってエラーなく正しく読み込まれます。

---

## 実施した動作確認と結果

ブラウザサブエージェントによる検証を実施し、すべて正常に動作することを確認しました。

| 検証項目 | 確認内容 | 結果 |
| :--- | :--- | :--- |
| **ヘッダー表示** | ヘッダー左上のバージョン表示が `v1.1.4` であること | **OK** |
| **ストレージ切替UI** | 設定パネル最上部に「Session」「Persistent」ボタンが表示されること | **OK** |
| **ストレージ切替動作** | 「Persistent」をクリックし、`active` 付与および `localStorage` に `'local'` が保存されること | **OK** |
| **プライバシーポリシー** | モーダル本文に `sessionStorage` と `localStorage` の両方が記載されていること | **OK** |
| **モデルスケール** | スケールXを 150% に変更し、モデルが 75×75×75 mm に拡大反映されること | **OK** |
| **Color Mode** | Color Mode を ON にし、マルチツール・カラー量子化パネルが正常に展開されること | **OK** |
| **AutoFit モード** | プリセットモデルの隠しボタンから Auto-fit モードをアンロックし、形状やパラメータが表示されること | **OK** |

---

## 残っている既知の制限
- ブラウザが「プライベートブラウジングモード」や「サードパーティCookie/ストレージ制限」を厳格に適用している場合、ブラウザのセキュリティ制約により `localStorage` / `sessionStorage` への書き込みが例外（QuotaExceededError 等）になることがあります。本実装では `try...catch` で安全に例外を補足し、アプリがクラッシュしないよう保護しています。
