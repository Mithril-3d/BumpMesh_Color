# タスクリスト: BumpMesh_Color 保存機能の包括的更新 (v1.1.4)

## 1. 準備・設計
- [x] 既存の保存・読込処理とUI構造の確認 <!-- id: 0 -->
- [x] 実装計画 (implementation_plan.md) の作成とユーザー承認 <!-- id: 1 -->

## 2. sessionStorage / localStorage 切替機能の実装
- [x] UIの追加（設定画面またはヘッダーに「Session（短期）」/「Local（長期）」切替UIを追加） <!-- id: 2 -->
- [x] ストレージ切替ロジックの実装（切替時の旧ストレージ削除、競合防止） <!-- id: 3 -->
- [x] 保存モード自体の永続化（次回起動時の判定用キー保持） <!-- id: 4 -->
- [x] 自動保存・起動時復元・設定リセットのストレージ対応 <!-- id: 5 -->

## 3. プライバシーポリシーの更新
- [x] index.html のプライバシーポリシー項目の更新 <!-- id: 6 -->
- [x] 全言語（js/i18n/*.js）の imprint.privacyLocal 翻訳文の更新 <!-- id: 7 -->

## 4. .bumpmesh 保存・読込の全機能対応
- [x] スナップショット（getSettingsSnapshot）への新項目追加 <!-- id: 8 -->
  - [x] Color / Multi-Tool（モードON/OFF、Preview、色数、Tool割当、Untextured Tool、SubMode）
  - [x] Interleaved（Layer Thickness、Convex Amp、Concave Amp、Profile Mode、Shading Mode）
  - [x] Model Scale（X倍率、Y倍率、Z倍率、Uniform Scale ON/OFF）
  - [x] AutoFit / 自動生成モデル（Model Mode、Shape、Height、Repeat、Ngon、解放状態）
- [x] スナップショット適用（applySettingsSnapshot）への復元処理追加 <!-- id: 9 -->
- [x] モデルエクスポート時の二重スケーリング防止処理 <!-- id: 10 -->
- [x] プロジェクトインポート時のAutoFit・スケール・カラー復元処理 <!-- id: 11 -->
- [x] 古い .bumpmesh との後方互換性ガード <!-- id: 12 -->

## 5. バージョン更新 (v1.1.4)
- [x] js/version.js を 1.1.4 に更新 <!-- id: 13 -->
- [x] index.html のバージョン表示を v1.1.4 に更新 <!-- id: 14 -->

## 6. 検証と動作確認
- [x] 短期保存と長期保存の動作検証（リロード、タブ終了、ストレージ切替、リセット） <!-- id: 15 -->
- [x] .bumpmesh の保存と読込の検証（全機能、モデルあり/なし、倍率二重適用防止、旧ファイル互換性） <!-- id: 16 -->
- [x] ウォークスルー (walkthrough.md) の作成と完了報告 <!-- id: 17 -->
