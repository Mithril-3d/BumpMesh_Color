# 実装計画: ネイティブメッシュUVモードにおけるサイズスライダー無効化バグの修正

## 1. 概要とバグの原因
OBJ / 3MF や牛のモデル（`spot.obj`）など、UV座標属性を持つモデルをロードすると、マッピング方式が自動的に「Native Mesh UV（`MODE_MESH_UV = 7`）」に設定されます。
しかし、コミット `01e2aa7` で本機能が導入された際、以下の2箇所でスケール（サイズ）処理が欠落していました。

1. **GPUシェーダー (`js/previewMaterial.js`)**:
   `sampleMeshUVMap` および `sampleMeshUVMapColor` 関数内で `offsetUV` と `rotation` は適用されているものの、`scaleUV` が完全に欠落していました。そのため、画面上のプレビューで「サイズ U / サイズ V」スライダーを操作してもテクスチャの大きさが一切変わりませんでした。
2. **CPU側UV計算 (`js/mapping.js`)**:
   `computeUV` 関数内で `mode === MODE_MESH_UV` の場合、直前で計算した `scaleU, scaleV` を無視して `applyTransform(..., 1, 1, ...)` とスケール値に `1, 1` を固定で渡していました。そのため、エクスポートやスライス処理でもサイズスライダーの値が一切反映されませんでした。

---

## 2. 変更計画

### 2.1 `js/previewMaterial.js` の修正
`sampleMeshUVMap` および `sampleMeshUVMapColor` で、他のマッピング方式と同様に `(rawUV * textureAspect) / scaleUV` を適用します。

```glsl
// Sample native Mesh UV (aspect and scale corrected, with offset and rotation)
float sampleMeshUVMap(vec2 rawUV) {
  vec2 uv = (rawUV * textureAspect) / scaleUV + offsetUV;
  float c = cos(rotation); float s = sin(rotation);
  uv -= 0.5;
  uv  = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  uv += 0.5;
  return texture2D(displacementMap, uv).r;
}

vec3 sampleMeshUVMapColor(vec2 rawUV) {
  vec2 uv = (rawUV * textureAspect) / scaleUV + offsetUV;
  float c = cos(rotation); float s = sin(rotation);
  uv -= 0.5;
  uv  = vec2(c * uv.x - s * uv.y, s * uv.x + c * uv.y);
  uv += 0.5;
  return texture2D(colorMap, uv).rgb;
}
```

### 2.2 `js/mapping.js` の修正
1. `computeUV` 内で、`scaleU, scaleV` を正しく渡すように修正します。
```javascript
if (mode === MODE_MESH_UV && meshUV) {
  return applyTransform(meshUV.u, meshUV.v, scaleU, scaleV, offsetU, offsetV, cosR, sinR);
}
```
2. `getScaleReferenceLengths` で `case MODE_MESH_UV:` を明示的に追加します。

### 2.3 `js/main.js` の修正
UV付きモデル読み込み時（`_applyLoadedPresetGeometry` および `handleModelFile`）に、初期サイズをモデルのバウンディングボックス最大長（`_scaleAnchorMm()`）に設定し、初期表示で 1:1（テクスチャ全体が等倍でぴったりフィット）になるようにします。

---

## 3. 検証方法
1. Node.js によるユニットテストスクリプトを作成し、`computeUV` にて `scaleU` を変化させた際に UV 座標がスケールに応じて拡大・縮小されることを確認。
2. シェーダーコードの構文チェック。
3. リグレッションテスト（Triplanar, Planar, Cylindrical などの既存モードに影響がないことの確認）。
