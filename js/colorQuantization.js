/*
 * Copyright (c) 2026 CNCKitchen and contributors
 * Color Quantization and Multi-Tool Mapping for BumpMesh
 */

/**
 * ITU-R Rec.709 Luminance
 */
export function getLuminance(r, g, b) {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255.0;
}

/**
 * Convert RGB [0-255] to Hex string "#RRGGBB"
 */
export function rgbToHex(r, g, b) {
  const toHex = (c) => Math.round(c).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Squared Euclidean distance between two RGB colors
 */
function colorDistSq(c1, c2) {
  const dr = c1[0] - c2[0];
  const dg = c1[1] - c2[1];
  const db = c1[2] - c2[2];
  return dr * dr + dg * dg + db * db;
}

/**
 * Quantize an ImageData using an already computed fixed palette.
 * Maps each pixel to its nearest palette color.
 *
 * @param {ImageData} imageData
 * @param {Array<{ id: number, color: number[], hex: string, toolId: number }>} palette
 * @returns {{ quantizedImageData: ImageData, luminanceMap: Float32Array }}
 */
export function quantizeImageWithPalette(imageData, palette) {
  const w = imageData.width;
  const h = imageData.height;
  const data = imageData.data;
  const totalPixels = w * h;
  const quantData = new Uint8ClampedArray(totalPixels * 4);
  const luminanceMap = new Float32Array(totalPixels);
  const k = palette ? palette.length : 0;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const r = data[idx];
    const g = data[idx + 1];
    const b = data[idx + 2];
    const a = data[idx + 3];

    luminanceMap[i] = getLuminance(r, g, b);

    if (k === 0) {
      quantData[idx]     = r;
      quantData[idx + 1] = g;
      quantData[idx + 2] = b;
      quantData[idx + 3] = a;
      continue;
    }

    let minD = Infinity;
    let bestColor = palette[0].color;
    for (let c = 0; c < k; c++) {
      const center = palette[c].color;
      const dr = center[0] - r;
      const dg = center[1] - g;
      const db = center[2] - b;
      const d = dr * dr + dg * dg + db * db;
      if (d < minD) {
        minD = d;
        bestColor = center;
      }
    }

    quantData[idx]     = bestColor[0];
    quantData[idx + 1] = bestColor[1];
    quantData[idx + 2] = bestColor[2];
    quantData[idx + 3] = a;
  }

  return {
    quantizedImageData: new ImageData(quantData, w, h),
    luminanceMap
  };
}

/**
 * Perform fast k-means++ clustering on one or multiple ImageData objects to extract k representative colors.
 * When multiple images are provided (e.g. from multiple texture layers), samples are gathered
 * across all visible layers to produce a unified global palette.
 *
 * @param {ImageData | Array<ImageData>} imageDataOrList 
 * @param {number} k (2 to 8)
 * @param {number} maxSamples (default 20000 for sub-10ms response)
 * @param {string} mode ('area' | 'gamut')
 * @returns {{
 *   palette: Array<{ id: number, color: number[], hex: string, ratio: number, toolId: number }>,
 *   quantizedImageData: ImageData,
 *   luminanceMap: Float32Array
 * }}
 */
export function quantizeImage(imageDataOrList, k = 4, maxSamples = 20000, mode = 'area') {
  const images = Array.isArray(imageDataOrList) ? imageDataOrList.filter(Boolean) : [imageDataOrList].filter(Boolean);
  if (images.length === 0) {
    throw new Error('No valid ImageData provided for quantization');
  }

  if (mode === 'gamut') {
    return quantizeImageGamut(images, k, maxSamples);
  }

  // 1. Build sample array for clustering across all images
  const samplesPerImage = Math.max(100, Math.floor(maxSamples / images.length));
  const samples = [];

  for (const img of images) {
    const totalPixels = img.width * img.height;
    const step = Math.max(1, Math.floor(totalPixels / samplesPerImage));
    const data = img.data;
    for (let i = 0; i < totalPixels; i += step) {
      const idx = i * 4;
      if (data[idx + 3] < 128) continue;
      samples.push([data[idx], data[idx + 1], data[idx + 2]]);
    }
  }

  if (samples.length === 0) {
    samples.push([128, 128, 128]);
  }

  // 2. k-means++ Initialization
  const centers = [];
  const firstIdx = Math.floor(Math.random() * samples.length);
  centers.push([...samples[firstIdx]]);

  const dists = new Float32Array(samples.length);

  while (centers.length < k && centers.length < samples.length) {
    let sumDist = 0;
    for (let i = 0; i < samples.length; i++) {
      let minDist = Infinity;
      for (const c of centers) {
        const d = colorDistSq(samples[i], c);
        if (d < minDist) minDist = d;
      }
      dists[i] = minDist;
      sumDist += minDist;
    }

    if (sumDist <= 0) break;

    let r = Math.random() * sumDist;
    let chosen = samples[0];
    for (let i = 0; i < samples.length; i++) {
      r -= dists[i];
      if (r <= 0) {
        chosen = samples[i];
        break;
      }
    }
    centers.push([...chosen]);
  }

  while (centers.length < k) {
    centers.push([...centers[centers.length - 1]]);
  }

  // 3. k-means Iterations
  const actualK = centers.length;
  const assignments = new Int32Array(samples.length);

  for (let iter = 0; iter < 12; iter++) {
    let changed = false;

    for (let i = 0; i < samples.length; i++) {
      let minD = Infinity;
      let minC = 0;
      for (let c = 0; c < actualK; c++) {
        const d = colorDistSq(samples[i], centers[c]);
        if (d < minD) {
          minD = d;
          minC = c;
        }
      }
      if (assignments[i] !== minC) {
        assignments[i] = minC;
        changed = true;
      }
    }

    if (!changed && iter > 0) break;

    const sumR = new Float64Array(actualK);
    const sumG = new Float64Array(actualK);
    const sumB = new Float64Array(actualK);
    const counts = new Uint32Array(actualK);

    for (let i = 0; i < samples.length; i++) {
      const c = assignments[i];
      sumR[c] += samples[i][0];
      sumG[c] += samples[i][1];
      sumB[c] += samples[i][2];
      counts[c]++;
    }

    for (let c = 0; c < actualK; c++) {
      if (counts[c] > 0) {
        centers[c][0] = Math.round(sumR[c] / counts[c]);
        centers[c][1] = Math.round(sumG[c] / counts[c]);
        centers[c][2] = Math.round(sumB[c] / counts[c]);
      }
    }
  }

  // 4. Count cluster ratios across sampled data
  const clusterCounts = new Uint32Array(actualK);
  for (let i = 0; i < samples.length; i++) {
    let minD = Infinity;
    let bestC = 0;
    for (let c = 0; c < actualK; c++) {
      const d = colorDistSq(samples[i], centers[c]);
      if (d < minD) {
        minD = d;
        bestC = c;
      }
    }
    clusterCounts[bestC]++;
  }

  // 5. Build palette array, sorted by area ratio (descending)
  const palette = [];
  const totalSamples = samples.length;
  for (let c = 0; c < actualK; c++) {
    const ratio = clusterCounts[c] / totalSamples;
    palette.push({
      id: c,
      color: [centers[c][0], centers[c][1], centers[c][2]],
      hex: rgbToHex(centers[c][0], centers[c][1], centers[c][2]),
      ratio: ratio,
      toolId: c + 1
    });
  }

  palette.sort((a, b) => b.ratio - a.ratio);
  palette.forEach((p, idx) => {
    p.toolId = idx + 1;
  });

  // Quantize the primary image using the computed palette
  const primaryRes = quantizeImageWithPalette(images[0], palette);

  return {
    palette,
    quantizedImageData: primaryRes.quantizedImageData,
    luminanceMap: primaryRes.luminanceMap
  };
}

/**
 * Bilinear sample luminance from raw ImageData
 */
export function sampleLuminanceBilinear(data, w, h, u, v) {
  u = ((u % 1) + 1) % 1;
  v = ((v % 1) + 1) % 1;
  v = 1 - v; // flip Y

  const fx = u * w - 0.5;
  const fy = v * h - 0.5;
  let x0 = Math.floor(fx);
  let y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;
  const x1 = (x0 + 1 + w) % w;
  const y1 = (y0 + 1 + h) % h;
  x0 = ((x0 % w) + w) % w;
  y0 = ((y0 % h) + h) % h;

  const idx00 = (y0 * w + x0) * 4;
  const idx10 = (y0 * w + x1) * 4;
  const idx01 = (y1 * w + x0) * 4;
  const idx11 = (y1 * w + x1) * 4;

  const l00 = getLuminance(data[idx00], data[idx00 + 1], data[idx00 + 2]);
  const l10 = getLuminance(data[idx10], data[idx10 + 1], data[idx10 + 2]);
  const l01 = getLuminance(data[idx01], data[idx01 + 1], data[idx01 + 2]);
  const l11 = getLuminance(data[idx11], data[idx11 + 1], data[idx11 + 2]);

  return l00 * (1 - tx) * (1 - ty)
       + l10 * tx * (1 - ty)
       + l01 * (1 - tx) * ty
       + l11 * tx * ty;
}

/**
 * Determine the nearest toolId at given UV coordinate
 */
export function getToolAtUV(data, w, h, u, v, palette) {
  u = ((u % 1) + 1) % 1;
  v = ((v % 1) + 1) % 1;
  v = 1 - v; // flip Y

  const x = Math.min(w - 1, Math.max(0, Math.floor(u * w)));
  const y = Math.min(h - 1, Math.max(0, Math.floor(v * h)));
  const idx = (y * w + x) * 4;
  const r = data[idx], g = data[idx + 1], b = data[idx + 2];

  let minDist = Infinity;
  let bestTool = palette[0]?.toolId ?? 1;

  for (const item of palette) {
    const c = item.color;
    const dr = c[0] - r;
    const dg = c[1] - g;
    const db = c[2] - b;
    const d = dr * dr + dg * dg + db * db;
    if (d < minDist) {
      minDist = d;
      bestTool = item.toolId;
    }
  }

  return bestTool;
}




/**

 * Simplex Orthogonal Basis Quantization (Gamut-Maximizing)

 * Optimized for multi-color 3D printing and interleaved slicing.

 * Instead of picking colors by area, it identifies the extremal vertices (basis colors)

 * that span the widest color gamut, allowing intermediate colors to be synthesized via blending.

 *

 * @param {ImageData} imageData

 * @param {number} k (2 to 8)

 * @param {number} maxSamples

 * @returns {{

 *   palette: Array<{ id: number, color: number[], hex: string, ratio: number, toolId: number }>,

 *   quantizedImageData: ImageData,

 *   luminanceMap: Float32Array

 * }}

 */

export function quantizeImageGamut(imageDataOrList, k = 4, maxSamples = 25000) {
  const images = Array.isArray(imageDataOrList) ? imageDataOrList.filter(Boolean) : [imageDataOrList].filter(Boolean);
  if (images.length === 0) {
    throw new Error('No valid ImageData provided for gamut quantization');
  }

  // 1. Subsample pixels across all visible images and build 3D voxel histogram (32x32x32)
  const samplesPerImage = Math.max(100, Math.floor(maxSamples / images.length));
  const bins = new Map();
  let sampledCount = 0;

  for (const img of images) {
    const totalPixels = img.width * img.height;
    const step = Math.max(1, Math.floor(totalPixels / samplesPerImage));
    const data = img.data;

    for (let i = 0; i < totalPixels; i += step) {
      const idx = i * 4;
      if (data[idx + 3] < 128) continue; // skip transparent
      sampledCount++;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const br = Math.min(31, Math.floor(r / 8));
      const bg = Math.min(31, Math.floor(g / 8));
      const bb = Math.min(31, Math.floor(b / 8));
      const key = (br << 10) | (bg << 5) | bb;

      let bin = bins.get(key);
      if (!bin) {
        bin = { sumR: 0, sumG: 0, sumB: 0, count: 0 };
        bins.set(key, bin);
      }
      bin.sumR += r;
      bin.sumG += g;
      bin.sumB += b;
      bin.count++;
    }
  }



  // Filter out noise outliers (at least 0.05% of samples)

  const minThreshold = Math.max(2, Math.floor(sampledCount * 0.0005));

  const candidates = [];

  for (const bin of bins.values()) {

    if (bin.count < minThreshold) continue;

    const avgR = bin.sumR / bin.count;

    const avgG = bin.sumG / bin.count;

    const avgB = bin.sumB / bin.count;

    const rgb = [avgR, avgG, avgB];

    const lum = getLuminance(avgR, avgG, avgB);

    const sat = (Math.max(avgR, avgG, avgB) - Math.min(avgR, avgG, avgB)) / 255.0;

    candidates.push({ rgb, count: bin.count, lum, sat });

  }



  if (candidates.length === 0) {

    candidates.push({ rgb: [128, 128, 128], count: 1, lum: 0.5, sat: 0 });

  }



  const centers = [];



  // Helper vector utilities

  const dot = (v1, v2) => v1[0]*v2[0] + v1[1]*v2[1] + v1[2]*v2[2];

  const sub = (v1, v2) => [v1[0]-v2[0], v1[1]-v2[1], v1[2]-v2[2]];

  const cross = (v1, v2) => [

    v1[1]*v2[2] - v1[2]*v2[1],

    v1[2]*v2[0] - v1[0]*v2[2],

    v1[0]*v2[1] - v1[1]*v2[0]

  ];

  const vlen = (v) => Math.hypot(v[0], v[1], v[2]);



  // Distance from point p to segment b1-b2

  const distToSegment = (p, b1, b2) => {

    const v = sub(b2, b1);

    const l2 = dot(v, v);

    if (l2 < 1e-6) return vlen(sub(p, b1));

    const t = Math.max(0, Math.min(1, dot(sub(p, b1), v) / l2));

    const proj = [b1[0] + t*v[0], b1[1] + t*v[1], b1[2] + t*v[2]];

    return vlen(sub(p, proj));

  };



  // Distance from point p to triangle plane b1-b2-b3

  const distToTrianglePlane = (p, b1, b2, b3) => {

    const v1 = sub(b2, b1);

    const v2 = sub(b3, b1);

    const n = cross(v1, v2);

    const nl = vlen(n);

    if (nl < 1e-4) {

      return Math.min(distToSegment(p, b1, b2), distToSegment(p, b2, b3), distToSegment(p, b3, b1));

    }

    return Math.abs(dot(sub(p, b1), n)) / nl;

  };



  // 1. Basis Point 1: Darkest anchor (Shadows)
  candidates.sort((a, b) => a.lum - b.lum);
  // Use the darkest candidate directly if it has meaningful representation (>= 0.2% of samples);
  // otherwise fall back to the 2nd-percentile bin to avoid isolated dark noise pixels.
  const shadowIdx = (candidates[0].count >= sampledCount * 0.002)
    ? 0
    : Math.min(candidates.length - 1, Math.floor(candidates.length * 0.02));
  const shadowCandidate = candidates[shadowIdx];
  centers.push([...shadowCandidate.rgb]);



  // 2. Basis Point 2: Furthest anchor from point 1 (Highlights / opposite hue)

  let maxD1 = -1;

  let bestP2 = candidates[candidates.length - 1].rgb;

  for (const c of candidates) {

    const d = vlen(sub(c.rgb, centers[0]));

    if (d > maxD1) {

      maxD1 = d;

      bestP2 = c.rgb;

    }

  }

  centers.push([...bestP2]);



  // 3. Basis Point 3: Furthest orthogonal anchor from segment 1-2

  if (k >= 3 && centers.length < k && candidates.length > centers.length) {

    let bestScore = -1;

    let bestP3 = candidates[0].rgb;

    for (const c of candidates) {

      const d = distToSegment(c.rgb, centers[0], centers[1]);

      const score = d * (1.0 + 1.8 * c.sat) * Math.pow(c.count, 0.15);

      if (score > bestScore) {

        bestScore = score;

        bestP3 = c.rgb;

      }

    }

    centers.push([...bestP3]);

  }



  // 4. Basis Point 4: Furthest orthogonal anchor from triangle plane 1-2-3

  if (k >= 4 && centers.length < k && candidates.length > centers.length) {

    let bestScore = -1;

    let bestP4 = candidates[0].rgb;

    for (const c of candidates) {

      const d = distToTrianglePlane(c.rgb, centers[0], centers[1], centers[2]);

      const score = d * (1.0 + 2.0 * c.sat) * Math.pow(c.count, 0.15);

      if (score > bestScore) {

        bestScore = score;

        bestP4 = c.rgb;

      }

    }

    centers.push([...bestP4]);

  }



  // 5. Basis Point 5+: Furthest from existing convex simplex

  while (centers.length < k && centers.length < candidates.length) {

    let bestScore = -1;

    let nextP = candidates[0].rgb;

    for (const c of candidates) {

      let minDist = Infinity;

      for (const b of centers) {

        const d = vlen(sub(c.rgb, b));

        if (d < minDist) minDist = d;

      }

      const score = minDist * (1.0 + 1.5 * c.sat) * Math.pow(c.count, 0.15);

      if (score > bestScore) {

        bestScore = score;

        nextP = c.rgb;

      }

    }

    centers.push([...nextP]);

  }



  // Pad if unique colors < k

  while (centers.length < k) {

    centers.push([...centers[centers.length - 1]]);

  }



  // Round centers to integers [0..255]

  for (const c of centers) {

    c[0] = Math.round(Math.max(0, Math.min(255, c[0])));

    c[1] = Math.round(Math.max(0, Math.min(255, c[1])));

    c[2] = Math.round(Math.max(0, Math.min(255, c[2])));

  }



  // Quantize primary image & count pixels per cluster across all visible images
  const actualK = centers.length;
  const clusterCounts = new Uint32Array(actualK);
  let totalAllPixels = 0;

  for (const img of images) {
    const imgPixels = img.width * img.height;
    const imgData = img.data;
    totalAllPixels += imgPixels;
    for (let i = 0; i < imgPixels; i++) {
      const idx = i * 4;
      const r = imgData[idx];
      const g = imgData[idx + 1];
      const b = imgData[idx + 2];

      let minD = Infinity;
      let bestC = 0;
      for (let c = 0; c < actualK; c++) {
        const center = centers[c];
        const dr = center[0] - r;
        const dg = center[1] - g;
        const db = center[2] - b;
        const d = dr * dr + dg * dg + db * db;
        if (d < minD) {
          minD = d;
          bestC = c;
        }
      }
      clusterCounts[bestC]++;
    }
  }

  // Build palette
  const palette = [];
  for (let c = 0; c < actualK; c++) {
    const ratio = clusterCounts[c] / Math.max(1, totalAllPixels);
    palette.push({
      id: c,
      color: [centers[c][0], centers[c][1], centers[c][2]],
      hex: rgbToHex(centers[c][0], centers[c][1], centers[c][2]),
      ratio: ratio,
      toolId: c + 1
    });
  }

  // Sort palette by ratio descending for consistent UI
  palette.sort((a, b) => b.ratio - a.ratio);
  palette.forEach((p, idx) => {
    p.toolId = idx + 1;
  });

  const primaryRes = quantizeImageWithPalette(images[0], palette);

  return {
    palette,
    quantizedImageData: primaryRes.quantizedImageData,
    luminanceMap: primaryRes.luminanceMap
  };
}

