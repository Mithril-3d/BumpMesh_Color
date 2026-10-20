# 知覚的カラー量子化（アクセントカラー優先クラスタリング）仕様メモ

## 1. 課題と背景
- **発生事象**: スライムなど「大面積のベース色（青系 約95%）」と「小面積のキーカラー（口の赤 約1.1%）」を持つテクスチャにおいて、ツール数 3 でカラー量子化を行うと、赤が青のグラデーションに吸収されて脱落し、青系2色＋黒（または濁った茶色）になってしまう。ツール数を 4 に増やしてようやく赤が出現する。
- **原因**: 現行の標準 k-means（k-means++）は「全ピクセルに対する色誤差の二乗和（MSE）」を最小化する。青のグラデーション誤差を低減する方が、1.1% の赤を残すよりも全体誤差が小さくなるため、数理的に赤が切り捨てられる。

---

## 2. 解決アルゴリズム設計

1. **カラーヒストグラム集約 ＋ 頻度の非線形圧縮（Sub-linear Weighting）**
   - 5ビット（各色32段階）カラービンにピクセルを集約。
   - ピクセル数 `count` に対し、`weight = Math.pow(count, 0.35)` のべき乗圧縮を適用。
   - 大面積（青 30,000px）と小面積（赤 1,000px）の重み比率を 30:1 から 約 3.3:1 に圧縮し、アクセントカラーが背景色に押しつぶされないようにする。
   - 全体の 0.05% 未満の微小ノイズ（JPEG圧縮ノイズ）は足切り。

2. **CIELAB知覚色空間 ＋ 明度差重みの低減（Luminance De-emphasis）**
   - sRGB から CIELAB (L*, a*, b*) へ変換。
   - 距離計算式: `distSq = 0.25 * (dL)^2 + (da)^2 + (db)^2`
   - 明度差（L*）の重みを 0.25 に抑え、色相・色度差（a*, b*）を 4倍重視する。
   - これにより「水色」と「濃い青」は同じ色相グループに統合され、色相が真逆の「赤」が強い別色として評価される。

3. **最遠点サンプリング（MaxMin / K-Center法）による初期色選定**
   - 1色目: 最も重みの大きい代表色。
   - 2色目以降: 既存の選択色から最も知覚色距離が離れているビンを選定 (`dist * sqrt(weight)`)。
   - 青とは色相が正反対の「赤」が初期色の段階で確実に確保される。

---

## 3. 実装コード（ドロップイン可能）

`js/colorQuantization.js` の `quantizeImage` 関数を以下のロジックで差し替え、またはモード切り替え可能。

```javascript
/**
 * sRGB to CIELAB conversion
 */
function rgbToLab(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
  g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
  b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;

  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = (r * 0.2126729 + g * 0.7151522 + b * 0.0721750);
  const z = (r * 0.0193339 + g * 0.1191920 + b * 0.9503041) / 1.08883;

  const f = t => t > 0.008856 ? Math.cbrt(t) : (7.787 * t + 16 / 116);
  const fx = f(x), fy = f(y), fz = f(z);

  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/**
 * CIELAB distance with reduced luminance weight to favor chromatic hue contrast
 */
function labDistSq(lab1, lab2, lWeight = 0.25) {
  const dL = lab1[0] - lab2[0];
  const da = lab1[1] - lab2[1];
  const db = lab1[2] - lab2[2];
  return lWeight * dL * dL + da * da + db * db;
}

/**
 * Perceptual Accent-Priority Quantization
 */
export function quantizeImageAccentPriority(imageData, k = 4) {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;
  const totalPixels = w * h;

  // 1. 5-bit color histogram
  const hist = new Map();
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    if (data[idx + 3] < 128) continue;
    const r = data[idx] >> 3, g = data[idx + 1] >> 3, b = data[idx + 2] >> 3;
    const key = (r << 10) | (g << 5) | b;
    hist.set(key, (hist.get(key) || 0) + 1);
  }

  // 2. Build bins with non-linear frequency weighting
  const minCount = Math.max(1, totalPixels * 0.0005); // ignore <0.05% noise
  const bins = [];
  for (const [key, count] of hist.entries()) {
    if (count < minCount) continue;
    const r = ((key >> 10) & 31) * 8 + 4;
    const g = ((key >> 5) & 31) * 8 + 4;
    const b = (key & 31) * 8 + 4;
    bins.push({
      color: [r, g, b],
      lab: rgbToLab(r, g, b),
      count,
      weight: Math.pow(count, 0.35)
    });
  }

  if (bins.length === 0) {
    bins.push({ color: [128, 128, 128], lab: [53, 0, 0], count: 1, weight: 1 });
  }

  // 3. Furthest Point (MaxMin) initialization
  bins.sort((a, b) => b.weight - a.weight);
  const centers = [ bins[0] ];

  while (centers.length < k && centers.length < bins.length) {
    let bestBin = null, bestScore = -1;
    for (const bin of bins) {
      let minDist = Infinity;
      for (const c of centers) {
        const d = labDistSq(bin.lab, c.lab, 0.25);
        if (d < minDist) minDist = d;
      }
      const score = minDist * Math.sqrt(bin.weight);
      if (score > bestScore) {
        bestScore = score;
        bestBin = bin;
      }
    }
    centers.push(bestBin);
  }

  // 4. Weighted k-means clustering in Lab space
  let curCenters = centers.map(c => [...c.color]);
  for (let iter = 0; iter < 12; iter++) {
    const sums = curCenters.map(() => [0, 0, 0]);
    const wSums = curCenters.map(() => 0);

    for (const bin of bins) {
      const binLab = rgbToLab(...bin.color);
      let minD = Infinity, bestC = 0;
      for (let c = 0; c < curCenters.length; c++) {
        const cLab = rgbToLab(...curCenters[c]);
        const d = labDistSq(binLab, cLab, 0.25);
        if (d < minD) { minD = d; bestC = c; }
      }
      sums[bestC][0] += bin.color[0] * bin.weight;
      sums[bestC][1] += bin.color[1] * bin.weight;
      sums[bestC][2] += bin.color[2] * bin.weight;
      wSums[bestC] += bin.weight;
    }

    for (let c = 0; c < curCenters.length; c++) {
      if (wSums[c] > 0) {
        curCenters[c][0] = Math.round(sums[c][0] / wSums[c]);
        curCenters[c][1] = Math.round(sums[c][1] / wSums[c]);
        curCenters[c][2] = Math.round(sums[c][2] / wSums[c]);
      }
    }
  }

  // 5. Build full quantized image & pixel count
  const clusterCounts = new Uint32Array(curCenters.length);
  const quantData = new Uint8ClampedArray(totalPixels * 4);
  const luminanceMap = new Float32Array(totalPixels);

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2], a = data[idx + 3];
    luminanceMap[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;

    const pLab = rgbToLab(r, g, b);
    let minD = Infinity, bestC = 0;
    for (let c = 0; c < curCenters.length; c++) {
      const cLab = rgbToLab(...curCenters[c]);
      const d = labDistSq(pLab, cLab, 0.25);
      if (d < minD) { minD = d; bestC = c; }
    }

    clusterCounts[bestC]++;
    const col = curCenters[bestC];
    quantData[idx]     = col[0];
    quantData[idx + 1] = col[1];
    quantData[idx + 2] = col[2];
    quantData[idx + 3] = a;
  }

  // 6. Build palette sorted by pixel ratio descending
  const palette = curCenters.map((c, idx) => ({
    id: idx,
    color: c,
    hex: `#${c[0].toString(16).padStart(2, '0')}${c[1].toString(16).padStart(2, '0')}${c[2].toString(16).padStart(2, '0')}`,
    ratio: clusterCounts[idx] / totalPixels,
    toolId: idx + 1
  })).sort((a, b) => b.ratio - a.ratio);

  palette.forEach((p, idx) => { p.toolId = idx + 1; });

  return {
    palette,
    quantizedImageData: new ImageData(quantData, w, h),
    luminanceMap
  };
}
```

---

## 4. 検証結果
スライム構成比率（水色65%, 濃紺30%, 黒3.5%, 赤1.5%）での検証:
- **K=2**: 青系 ＋ 赤系
- **K=3**: **青系（体全体） ＋ 赤系（口） ＋ 黒系（目・輪郭）**
- **K=4**: 水色（明） ＋ 赤系 ＋ 黒系 ＋ 濃紺（暗）

