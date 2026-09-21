# 保存機能の包括的更新および v1.1.4 実装計画

BumpMesh_Color の設定保存機能を拡張し、`sessionStorage` / `localStorage` の切替機能、プライバシーポリシーの更新、および `.bumpmesh` プロジェクト保存・読込の全機能対応（Color/Multi-Tool, Interleaved, Model Scale, AutoFit）を安全に実装します。

## ユーザー確認事項 (User Review Required)

> [!IMPORTANT]
> **ストレージ切替UIの配置場所**:
> 設定パネル（Settings Panel）の最上部（「Preset Models」の直上）に、モダンなセグメントボタングループ `[ 短期保存 (Session) | 長期保存 (Local) ]` を配置します。これにより、設定パネルを開いた際に直感的に現在の保存方式を把握・切り替えできるようにします。

> [!IMPORTANT]
> **モデル保存時の二重拡大・縮小防止設計**:
> モデル倍率（例: 200%）が適用されている状態で「モデルを含めて保存」する場合、STLデータとしては原寸（100%の基本ジオメトリ）を出力し、設定JSONに倍率（200%）を記録します。
> 読み込み時、モデルが100%で初期化された後に倍率（200%）が適用されるため、**二重拡大（200% × 200% = 400%）や二重縮小が完全に防止**されます。また、「設定のみ」の読み込みでも現在開いているモデルに対して正確に倍率が反映されます。

---

## 提案する変更内容 (Proposed Changes)

### 1. sessionStorage / localStorage 切替機能の実装
#### [MODIFY] [index.html](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/index.html)
- 設定パネルの最上部に、保存期間を選択するUI要素を追加：
  ```html
  <div class="storage-mode-row">
    <span class="storage-mode-label" data-i18n="storage.modeLabel">Auto-save:</span>
    <div class="storage-mode-toggle">
      <button type="button" id="storage-mode-session" class="storage-mode-btn active" data-storage-mode="session" data-i18n="storage.session" data-i18n-title="storage.sessionDesc">Session</button>
      <button type="button" id="storage-mode-local" class="storage-mode-btn" data-storage-mode="local" data-i18n="storage.local" data-i18n-title="storage.localDesc">Persistent</button>
    </div>
  </div>
  ```

#### [MODIFY] [style.css](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/style.css)
- ストレージ切替ボタングループのスタイリング（既存の `.model-mode-tab` や `.theme-toggle` に調和するコンパクトなデザイン）。

#### [MODIFY] [js/main.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/main.js)
- `STORAGE_MODE_KEY = 'bumpmesh-storage-mode'` を定義し、`localStorage` から前回の選択モード（デフォルトは `'session'`）を読み込み。
- 保存モード切り替えハンドラ：
  - 切り替え時、現在の設定スナップショットを新しいストレージ（`sessionStorage` または `localStorage`）に即座に書き込み。
  - **競合防止**: 古いストレージから `PROJECT_STORAGE_KEY` を `removeItem` で確実に消去。
- 自動保存関数 `_autoSaveSettings()`：
  - 現在選択中のストレージ（sessionStorage または localStorage）に保存。
- 復元関数 `_restoreSessionSettings()`：
  - 選択中のストレージから設定を復元。
- 設定リセット `resetSettingsToDefaults()`：
  - 選択中のストレージ（および念のため両方）から `PROJECT_STORAGE_KEY` を削除して初期化。

---

### 2. プライバシーポリシーの更新
#### [MODIFY] [index.html](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/index.html)
- `imprint.privacyLocal` のデフォルト英文を更新。

#### [MODIFY] [js/i18n/*.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/i18n/)（全13言語）
- 全言語の `imprint.privacyLocal` を更新：
  - ユーザーの選択に応じて `sessionStorage` または `localStorage` に設定を保存すること
  - 保存対象は言語、テーマ、テクスチャ設定、マッピング設定、各種UI設定などであること
  - 設定データはユーザーのブラウザ内に保持され、外部サーバーへ送信されないこと
  - Cookieや利用者追跡のための保存ではないこと
- ストレージ切替UI用の辞書キーを追加：
  - `storage.modeLabel`
  - `storage.session`
  - `storage.local`
  - `storage.sessionDesc`
  - `storage.localDesc`

---

### 3. `.bumpmesh` の保存・読込を全機能に対応
#### [MODIFY] [js/main.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/main.js)
- **`getSettingsSnapshot()` の拡張**:
  - **Color / Multi-Tool**:
    - `colorModeEnabled`: `colorModeToggle?.checked ?? false`
    - `colorPreviewEnabled`: `colorPreviewToggle?.checked ?? true`
    - `colorCount`: `parseInt(colorCountSlider?.value || '4', 10)`
    - `colorSubMode`: `currentColorSubMode`
    - `untexturedToolId`: `settings.untexturedToolId ?? 1`
    - `userAssignedToolIds`: `[..._userAssignedToolIds]`
    - `palette`: `currentColorPalette`
  - **Interleaved**:
    - `interleavedThickness`: `interleavedSettings.layerThickness`
    - `interleavedConvex`: `interleavedSettings.convexAmp`
    - `interleavedConcave`: `interleavedSettings.concaveAmp`
    - `interleavedProfileMode`: `interleavedSettings.profileMode`
    - `interleavedShadingMode`: `interleavedSettings.shadingMode`
  - **Model Scale**:
    - `modelScale`: `{ x: _modelScale.x, y: _modelScale.y, z: _modelScale.z }`
    - `scaleUniform`: `_scaleUniform`
  - **AutoFit / 自動生成モデル**:
    - `autoFitUnlocked`: `autoFitUnlocked`
    - `currentModelMode`: `currentModelMode`
    - `currentPresetKey`: `currentPresetKey`
    - `autoFitShape`: `autoFitShape`
    - `autoFitHeight`: `autoFitHeight`
    - `autoFitRepeat`: `autoFitRepeat`
    - `autoFitNgon`: `autoFitNgon`

- **`applySettingsSnapshot(snap)` の拡張**:
  - Color Mode, Color Preview, Color Count, Color Sub Mode, Untextured Tool, Tool ID割当の復元とイベント発火。
  - Interleaved設定（Thickness, Convex, Concave, Profile, Shading）の各入力への値設定と `interleavedSettings` 同期。
  - Model Scale設定（X, Y, Z, Uniform）の各入力への反映と `applyModelScale()` 実行。
  - AutoFit設定の復元（`autoFitUnlocked` が真なら隠しタブのアンロック表示、パラメータ入力の復元、モデル無し設定読込時に必要ならAutoFit再生成）。
  - **後方互換性**: 各項目について `snap.xxx != null ? snap.xxx : デフォルト値` でガードし、古い `.bumpmesh` ファイルを読み込んでもエラーにならないようにする。

- **モデル保存時の二重スケール防止**:
  - `_geometryToBinarySTL`:
    - `_baseGeometryPositions` が存在する場合、その頂点配列を使用してSTLをシリアライズ。
    - これにより、STL自体は常に倍率100%の原型で保存され、読み込み時に設定された倍率が一度だけ適用される。

---

### 4. バージョン更新 (v1.1.4)
#### [MODIFY] [js/version.js](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/js/version.js)
- `APP_VERSION = '1.1.4'` に更新。

#### [MODIFY] [index.html](file:///c:/Users/Vogler/Documents/3dprint/Antigravity/BumpMesh_Color/index.html)
- `<span id="app-version" class="app-version">v1.1.4</span>` に更新。

---

## 検証計画 (Verification Plan)

### 自動/ブラウザ検証
1. **短期保存 (sessionStorage) の確認**:
   - 設定を変更後、ページをリロードして設定が維持されることを確認。
   - 新規タブで開いた場合に初期値に戻ることを確認。
2. **長期保存 (localStorage) の確認**:
   - 保存先を「長期保存」に切り替え、設定を変更。
   - リロード後も維持され、保存先モード選択も保持されることを確認。
3. **ストレージ切替時の競合防止確認**:
   - 切替時に旧ストレージのキーが削除され、競合しないことをブラウザのストレージインスペクタで確認。
4. **設定リセットの確認**:
   - リセット実行でストレージが初期化されることを確認。
5. **.bumpmesh 保存・復元の確認**:
   - Color Mode ON, Interleaved Mode, スケール変更（例: X=150%, Y=120%）, AutoFitモデル等の状態で `.bumpmesh` を保存。
   - 別状態でインポートし、全パラメータおよびモデルが正確に復元されることを確認。
   - モデルあり保存と設定のみ保存の両方で、スケールの二重適用が起きないことを確認。
   - 古いプロジェクトデータ（新項目を含まないもの）を読み込んでもエラーが発生しないことを確認。
