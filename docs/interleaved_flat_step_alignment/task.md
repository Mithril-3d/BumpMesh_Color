# タスクリスト: 交互積層（振り重ね）フラット段差標準化と層境界アラインメント

- [x] 計画・設計 <!-- id: 0 -->
  - [x] ジグザグ発生原因の特定（45°ルーバー庇の層内Z傾斜とメッシュ三角形分割の干渉） <!-- id: 1 -->
  - [x] ドキュメント (`task.md`, `implementation_plan.md`) の作成 <!-- id: 2 -->
- [x] 実装 <!-- id: 3 -->
  - [x] `index.html`: 断面形状のデフォルトを「フラット段差（標準ステップ・推奨）」に変更、表示名・ツールチップの更新 <!-- id: 4 -->
  - [x] `js/main.js`: `interleavedSettings.profileMode` の初期値を `0` に変更、UIイベント連携の確認 <!-- id: 5 -->
  - [x] `js/layerBlending.js`: `computeLouverDisplacement` のデフォルト引数 `profileMode = 0` への更新、フラットモード時の完全均一変位の保証 <!-- id: 6 -->
  - [x] `js/displacement.js`: `settings.interleavedProfileMode` のフォールバックを `0` に変更 <!-- id: 7 -->
  - [x] `js/previewMaterial.js`: 3Dプレビューシェーダーに `interleavedProfileMode` を追加し、フラットステッププレビューを同期 <!-- id: 8 -->
- [x] 検証 <!-- id: 9 -->
  - [x] キューブモデルを用いたスライス断面のジグザグ測定テスト（誤差レンジ・標準偏差） <!-- id: 10 -->
  - [x] 3Dプレビューおよびエクスポートパイプラインの動作確認 <!-- id: 11 -->
  - [x] `walkthrough.md` の作成 <!-- id: 12 -->
