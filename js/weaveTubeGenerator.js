/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * weaveTubeGenerator.js
 *
 * 編み重ね（Weave: ハーフトーン編み・矩形ブロック・三角波・正弦波）専用の
 * 「断面四角の輪ゴム積層チューブ生成エンジン」。
 *
 * - 円柱プリセット: 幾何学的真円に対して高速・高精度に生成。
 * - 任意3Dメッシュ: 各Zレイヤーの水平断面から交線セグメントを抽出し、
 *   閉じたポリゴンループ（複数島・C字凹輪郭対応）を独立して構築。
 *   猫の耳や動物の足などの「複数島」、錦鯉のC字などの「凹形状」もブリッジや円盤化せず
 *   そのままの輪郭でハーフトーン編みチューブを生成し、100%水密マニホールドとして出力する。
 */

/**
 * 水平断面上の交線セグメント群を連結し、閉じた島ループ（CCW外周）の配列を返す
 */
function stitchSegmentsToLoops(segs, normals) {
  const nSeg = segs.length / 4;
  if (nSeg < 3) return [];

  const SCALE = 2000; // 0.5 um precision key
  const keyOf = (x, y) => `${Math.round(x * SCALE)},${Math.round(y * SCALE)}`;

  // 向きを三角形外向き法線に対してCCW（外側が右）に揃える
  const sX1 = new Float64Array(nSeg);
  const sY1 = new Float64Array(nSeg);
  const sX2 = new Float64Array(nSeg);
  const sY2 = new Float64Array(nSeg);
  for (let i = 0; i < nSeg; i++) {
    const sb = i * 4;
    let x1 = segs[sb], y1 = segs[sb + 1], x2 = segs[sb + 2], y2 = segs[sb + 3];
    const nx = normals[i * 2], ny = normals[i * 2 + 1];
    const dx = x2 - x1, dy = y2 - y1;
    // CCW外周なら進行方向(dx,dy)の右90度(dy, -dx)が外向き法線(nx,ny)と一致する
    if (dy * nx - dx * ny < 0) {
      const tx = x1, ty = y1;
      x1 = x2; y1 = y2; x2 = tx; y2 = ty;
    }
    sX1[i] = x1; sY1[i] = y1;
    sX2[i] = x2; sY2[i] = y2;
  }

  const startMap = new Map();
  for (let i = 0; i < nSeg; i++) {
    const k = keyOf(sX1[i], sY1[i]);
    let arr = startMap.get(k);
    if (!arr) { arr = []; startMap.set(k, arr); }
    arr.push(i);
  }

  const used = new Uint8Array(nSeg);
  const loops = [];

  for (let startIdx = 0; startIdx < nSeg; startIdx++) {
    if (used[startIdx]) continue;
    used[startIdx] = 1;

    const pts = [[sX1[startIdx], sY1[startIdx]]];
    let curX = sX2[startIdx], curY = sY2[startIdx];
    const sx = sX1[startIdx], sy = sY1[startIdx];

    let steps = 0;
    while (steps < nSeg + 2) {
      steps++;
      if (Math.hypot(curX - sx, curY - sy) < 0.01 && pts.length >= 3) {
        break; // closed cleanly
      }
      pts.push([curX, curY]);

      const k = keyOf(curX, curY);
      const candidates = startMap.get(k);
      let nextIdx = -1;
      if (candidates) {
        for (let c = 0; c < candidates.length; c++) {
          if (!used[candidates[c]]) {
            nextIdx = candidates[c];
            break;
          }
        }
      }

      // 許容誤差フォールバック（0.08mm以内の最近接未使用セグメント始点）
      if (nextIdx === -1) {
        let bestD2 = 0.08 * 0.08;
        for (let j = 0; j < nSeg; j++) {
          if (used[j]) continue;
          const dx = sX1[j] - curX, dy = sY1[j] - curY;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestD2) {
            bestD2 = d2;
            nextIdx = j;
          }
        }
      }

      if (nextIdx === -1) break;
      used[nextIdx] = 1;
      curX = sX2[nextIdx];
      curY = sY2[nextIdx];
    }

    if (pts.length < 3) continue;

    // 重複連続頂点を整理
    const clean = [];
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const prev = clean.length > 0 ? clean[clean.length - 1] : pts[pts.length - 1];
      if (Math.hypot(p[0] - prev[0], p[1] - prev[1]) > 1e-4) {
        clean.push(p);
      }
    }
    if (clean.length < 3) continue;

    // 符号付き面積と周長を計算
    let area2 = 0;
    let perim = 0;
    for (let i = 0; i < clean.length; i++) {
      const a = clean[i];
      const b = clean[(i + 1) % clean.length];
      area2 += a[0] * b[1] - b[0] * a[1];
      perim += Math.hypot(b[0] - a[0], b[1] - a[1]);
    }
    const area = 0.5 * area2;
    if (Math.abs(area) < 0.2 || perim < 2.0) continue;

    loops.push({ pts: clean, area, perim });
  }

  if (loops.length === 0) return [];

  // 外周ループ (area > 0) を優先採用。もし法線が全面逆向きだった場合のみ反転して使う
  const outer = loops.filter(lp => lp.area > 0);
  if (outer.length > 0) return outer;

  return loops.map(lp => ({
    pts: lp.pts.slice().reverse(),
    area: -lp.area,
    perim: lp.perim,
  }));
}

/**
 * メッシュの各Zレイヤーにおける全閉ループ（複数島・凹輪郭）を抽出する
 */
function buildMeshLayerLoops(meshPositions, minZ, thickness, totalLayers) {
  const triCount = Math.floor(meshPositions.length / 9);
  const layerTris = Array.from({ length: totalLayers }, () => []);

  for (let tIdx = 0; tIdx < triCount; tIdx++) {
    const b = tIdx * 9;
    const z0 = meshPositions[b + 2];
    const z1 = meshPositions[b + 5];
    const z2 = meshPositions[b + 8];
    const minTz = Math.min(z0, z1, z2);
    const maxTz = Math.max(z0, z1, z2);
    const l0 = Math.max(0, Math.floor((minTz - minZ) / thickness));
    const l1 = Math.min(totalLayers - 1, Math.floor((maxTz - minZ) / thickness));
    for (let l = l0; l <= l1; l++) {
      layerTris[l].push(tIdx);
    }
  }

  const allLayerLoops = new Array(totalLayers);
  let prevLoops = [];

  for (let lay = 0; lay < totalLayers; lay++) {
    const z = minZ + (lay + 0.5) * thickness;
    const tris = layerTris[lay];
    const segs = [];
    const normals = [];

    for (let k = 0; k < tris.length; k++) {
      const b = tris[k] * 9;
      const x0 = meshPositions[b],     y0 = meshPositions[b + 1], z0 = meshPositions[b + 2];
      const x1 = meshPositions[b + 3], y1 = meshPositions[b + 4], z1 = meshPositions[b + 5];
      const x2 = meshPositions[b + 6], y2 = meshPositions[b + 7], z2 = meshPositions[b + 8];

      const pts = [[x0, y0, z0], [x1, y1, z1], [x2, y2, z2]];
      const cuts = [];
      for (let e = 0; e < 3; e++) {
        const pa = pts[e];
        const pb = pts[(e + 1) % 3];
        const za = pa[2], zb = pb[2];
        // 半開区間判定により頂点ちょうどを通る際の重複交差を防止
        if ((za <= z && zb > z) || (zb <= z && za > z)) {
          const u = (z - za) / (zb - za);
          cuts.push(pa[0] + u * (pb[0] - pa[0]), pa[1] + u * (pb[1] - pa[1]));
        }
      }
      if (cuts.length >= 4) {
        const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
        const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
        const nx = ay * bz - az * by;
        const ny = az * bx - ax * bz;
        segs.push(cuts[0], cuts[1], cuts[2], cuts[3]);
        normals.push(nx, ny);
      }
    }

    const loops = stitchSegmentsToLoops(segs, normals);
    if (loops.length > 0) {
      allLayerLoops[lay] = loops;
      prevLoops = loops;
    } else {
      allLayerLoops[lay] = prevLoops;
    }
  }

  return allLayerLoops;
}

/**
 * 2D CCWポリゴンをEar-Clipping（耳切り法）で三角形分割する（凹形状・C字型完全対応）
 * 戻り値: 頂点インデックス配列 [i0, i1, i2, ...]
 */
function triangulatePolygonCCW(pts) {
  const n = pts.length;
  if (n < 3) return [];
  if (n === 3) return [0, 1, 2];

  const indices = [];
  for (let i = 0; i < n; i++) indices.push(i);

  const cross2 = (a, b, c) =>
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);

  const pointInTri = (p, a, b, c) => {
    const c1 = cross2(a, b, p);
    const c2 = cross2(b, c, p);
    const c3 = cross2(c, a, p);
    return c1 >= -1e-7 && c2 >= -1e-7 && c3 >= -1e-7;
  };

  const out = [];
  let guard = n * n * 2;
  let i = 0;

  while (indices.length > 3 && guard-- > 0) {
    const m = indices.length;
    const prevIdx = indices[(i - 1 + m) % m];
    const currIdx = indices[i % m];
    const nextIdx = indices[(i + 1) % m];
    const a = pts[prevIdx], b = pts[currIdx], c = pts[nextIdx];

    if (cross2(a, b, c) > 1e-8) {
      let hasInside = false;
      for (let j = 0; j < m; j++) {
        const ti = indices[j];
        if (ti === prevIdx || ti === currIdx || ti === nextIdx) continue;
        if (pointInTri(pts[ti], a, b, c)) {
          hasInside = true;
          break;
        }
      }
      if (!hasInside) {
        out.push(prevIdx, currIdx, nextIdx);
        indices.splice(i % m, 1);
        i = i % indices.length;
        continue;
      }
    }
    i = (i + 1) % m;
  }

  if (indices.length === 3) {
    out.push(indices[0], indices[1], indices[2]);
  } else if (indices.length > 3) {
    // 自己交差等の緊急フォールバックファン分割
    for (let k = 1; k < indices.length - 1; k++) {
      out.push(indices[0], indices[k], indices[k + 1]);
    }
  }
  return out;
}

/**
 * 輪ゴム積層チューブメッシュを生成する（任意メッシュ複数島・凹形状および円柱に対応）
 */
export function generateWeaveRubberBandTube({
  meshPositions = null,
  radius = 40,
  cx = 0,
  cy = 0,
  minZ = 0,
  thickness = 0.20,
  wallThickness = 0.40,
  totalLayers = 100,
  toolIds = [1, 2],
  profileMode = 4,
  pitch = 1.6,
  convexVal = 0.35,
  concaveVal = 0.00,
  sampleFn = null,
  toolWeaveModes = null,
  flatAmpScale = 1.0,
} = {}) {
  const t = Math.max(0.01, Number(thickness) || 0.20);
  const wall = Math.max(0.10, Number(wallThickness) || 0.40);
  const layers = Math.max(1, Math.round(totalLayers));
  const stroke = Math.max(0.01, (convexVal + concaveVal) > 0 ? (convexVal + concaveVal) : 0.60);
  const p = Math.max(0.2, Number(pitch) || 1.60);

  const edge = 0.05;
  let uKeypoints;
  if (profileMode === 4) {
    uKeypoints = [0.0, edge, 0.25, 0.5 - edge, 0.5, 0.5 + edge, 0.75, 1.0 - edge];
  } else if (profileMode === 3) {
    uKeypoints = [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
  } else {
    uKeypoints = [];
    const step = 1.0 / 12.0;
    for (let k = 0; k < 12; k++) uKeypoints.push(k * step);
  }
  const kpp = uKeypoints.length;

  // 正規化波形 B [0.0, 1.0]
  function getWaveB(phi, exposure = 1.0) {
    const u = ((phi / (2.0 * Math.PI)) % 1.0 + 1.0) % 1.0;
    if (profileMode === 5) {
      if (exposure <= 0.001) return 0.0;
      const s = Math.sin(phi);
      const thresh = 1.0 - 2.0 * Math.min(1.0, exposure);
      if (s <= thresh) return 0.0;
      const norm = (s - thresh) / (1.0 - thresh + 1e-5);
      return Math.pow(norm, 1.2) * exposure;
    } else if (profileMode === 4) {
      if (u < edge) return u / edge;
      if (u < 0.5 - edge) return 1.0;
      if (u < 0.5 + edge) return 1.0 - (u - (0.5 - edge)) / (2.0 * edge);
      return 0.0;
    } else if (profileMode === 3) {
      return Math.max(0.0, Math.min(1.0, 1.0 - 2.0 * Math.abs(u - 0.25)));
    } else {
      return 0.5 + 0.5 * Math.sin(phi);
    }
  }

  // 動的リサイズ可能な出力バッファ
  let capTris = 131072;
  let positions = new Float32Array(capTris * 9);
  let normals = new Float32Array(capTris * 9);
  let tools = new Int32Array(capTris);
  let triIdx = 0;

  function ensureCap(extra) {
    if (triIdx + extra <= capTris) return;
    while (triIdx + extra > capTris) capTris *= 2;
    const np = new Float32Array(capTris * 9); np.set(positions); positions = np;
    const nn = new Float32Array(capTris * 9); nn.set(normals); normals = nn;
    const nt = new Int32Array(capTris); nt.set(tools); tools = nt;
  }

  function addTri(x0, y0, z0, x1, y1, z1, x2, y2, z2, nx, ny, nz, tool) {
    if (triIdx >= capTris) ensureCap(1024);
    const b = triIdx * 9;
    positions[b]     = x0; positions[b + 1] = y0; positions[b + 2] = z0;
    positions[b + 3] = x1; positions[b + 4] = y1; positions[b + 5] = z1;
    positions[b + 6] = x2; positions[b + 7] = y2; positions[b + 8] = z2;
    normals[b]     = nx; normals[b + 1] = ny; normals[b + 2] = nz;
    normals[b + 3] = nx; normals[b + 4] = ny; normals[b + 5] = nz;
    normals[b + 6] = nx; normals[b + 7] = ny; normals[b + 8] = nz;
    tools[triIdx] = tool;
    triIdx++;
  }

  const L = Math.max(1, toolIds.length);
  const useArbitraryMesh = !!(meshPositions && meshPositions.length >= 9);
  const allLayerLoops = useArbitraryMesh
    ? buildMeshLayerLoops(meshPositions, minZ, t, layers)
    : null;

  for (let lay = 0; lay < layers; lay++) {
    const z_bot = Math.fround(minZ + lay * t);
    const z_top = Math.fround(minZ + (lay + 1) * t);
    const z_mid = (z_bot + z_top) * 0.5;
    const activeTool = toolIds[lay % L];
    const isToolWeave = (toolWeaveModes && toolWeaveModes[activeTool] !== undefined)
      ? !!toolWeaveModes[activeTool]
      : true;
    const colIdx = lay % L;
    const cycle = Math.floor(lay / L);
    const layerPhase = (colIdx * (2.0 * Math.PI / L)) + (cycle % 2) * Math.PI;
    const isSolidBottom = (lay < 3);

    // このレイヤーで生成するループ群を用意
    let loopsForLayer;
    if (useArbitraryMesh) {
      loopsForLayer = allLayerLoops[lay];
      if (!loopsForLayer || loopsForLayer.length === 0) continue;
    } else {
      // 円柱モード: 1つの真円ループとして統一処理
      const circumference = 2.0 * Math.PI * radius;
      const waveCount = Math.max(6, Math.round(circumference / p));
      const nPts = waveCount * kpp;
      const pts = [];
      const dPhi = (2.0 * Math.PI) / waveCount;
      for (let w = 0; w < waveCount; w++) {
        const basePhi = w * dPhi;
        for (let k = 0; k < kpp; k++) {
          const th = basePhi + uKeypoints[k] * dPhi;
          pts.push([cx + radius * Math.cos(th), cy + radius * Math.sin(th)]);
        }
      }
      loopsForLayer = [{ pts, area: Math.PI * radius * radius, perim: circumference, isCircle: true, waveCount }];
    }

    for (let lpIdx = 0; lpIdx < loopsForLayer.length; lpIdx++) {
      const lp = loopsForLayer[lpIdx];
      const waveCount = lp.waveCount || Math.max(4, Math.round(lp.perim / p));
      const N = waveCount * kpp;

      // ループ周長に沿って等間隔リサンプリング
      const basePtsX = new Float64Array(N);
      const basePtsY = new Float64Array(N);
      const normX = new Float64Array(N);
      const normY = new Float64Array(N);

      if (lp.isCircle) {
        for (let i = 0; i < N; i++) {
          const px = lp.pts[i][0];
          const py = lp.pts[i][1];
          basePtsX[i] = px;
          basePtsY[i] = py;
          const dx = px - cx, dy = py - cy;
          const dl = Math.hypot(dx, dy) || 1;
          normX[i] = dx / dl;
          normY[i] = dy / dl;
        }
      } else {
        const src = lp.pts;
        const m = src.length;
        const cumLen = new Float64Array(m + 1);
        for (let i = 0; i < m; i++) {
          const a = src[i], b = src[(i + 1) % m];
          cumLen[i + 1] = cumLen[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
        }
        const totalLen = cumLen[m];
        if (totalLen < 1e-4) continue;

        let segCursor = 0;
        for (let w = 0; w < waveCount; w++) {
          for (let k = 0; k < kpp; k++) {
            const idx = w * kpp + k;
            const targetS = ((w + uKeypoints[k]) / waveCount) * totalLen;
            while (segCursor < m - 1 && cumLen[segCursor + 1] < targetS) segCursor++;
            const s0 = cumLen[segCursor], s1 = cumLen[segCursor + 1];
            const frac = (s1 > s0 + 1e-9) ? (targetS - s0) / (s1 - s0) : 0;
            const a = src[segCursor], b = src[(segCursor + 1) % m];
            basePtsX[idx] = a[0] + frac * (b[0] - a[0]);
            basePtsY[idx] = a[1] + frac * (b[1] - a[1]);
          }
        }

        // CCWポリゴンの外向き2D法線を計算（右90度 = (ty, -tx)）
        for (let i = 0; i < N; i++) {
          const prev = (i - 1 + N) % N;
          const next = (i + 1) % N;
          const tx = basePtsX[next] - basePtsX[prev];
          const ty = basePtsY[next] - basePtsY[prev];
          const len = Math.hypot(tx, ty) || 1;
          normX[i] = ty / len;
          normY[i] = -tx / len;
        }

        // 鋭角部の内壁自己交差を抑えるため法線を軽く2回平滑化
        const tmpNx = new Float64Array(N);
        const tmpNy = new Float64Array(N);
        for (let pass = 0; pass < 2; pass++) {
          for (let i = 0; i < N; i++) {
            const prev = (i - 1 + N) % N;
            const next = (i + 1) % N;
            const sx = 0.25 * normX[prev] + 0.5 * normX[i] + 0.25 * normX[next];
            const sy = 0.25 * normY[prev] + 0.5 * normY[i] + 0.25 * normY[next];
            const sl = Math.hypot(sx, sy) || 1;
            tmpNx[i] = sx / sl;
            tmpNy[i] = sy / sl;
          }
          normX.set(tmpNx);
          normY.set(tmpNy);
        }
      }

      // 細い島（猫の耳先や尻尾先）で内壁が裏返らないよう実効肉厚を安全クランプ
      const halfWidthEst = (lp.area / Math.max(1e-3, lp.perim)) * 1.35;
      const effBaseWall = Math.min(2.0 * wall, Math.max(0.25, halfWidthEst));
      const effWall = Math.min(wall, Math.max(0.20, halfWidthEst));

      const outX = new Float64Array(N);
      const outY = new Float64Array(N);
      const inX  = new Float64Array(N);
      const inY  = new Float64Array(N);

      for (let i = 0; i < N; i++) {
        const px = basePtsX[i], py = basePtsY[i];
        const nx = normX[i], ny = normY[i];
        const wIdx = Math.floor(i / kpp);
        const kIdx = i % kpp;
        const phi = (wIdx + uKeypoints[kIdx]) * 2.0 * Math.PI + layerPhase;

        let exposure = 0.5;
        let multiColorInfo = null;
        if (sampleFn) {
          const sampled = sampleFn(px, py, z_mid, nx, ny, 0);
          const targetTool = sampled.targetTool;
          const blendWeight = sampled.blendWeight;
          multiColorInfo = sampled.multiColorInfo;
          if (multiColorInfo) {
            const { toolA, toolB, t: tAffinity } = multiColorInfo;
            if (activeTool === toolA) exposure = tAffinity;
            else if (activeTool === toolB) exposure = 1.0 - tAffinity;
            else exposure = 0.0;
          } else if (toolIds.length >= 2) {
            exposure = (activeTool === targetTool)
              ? 1.0
              : (blendWeight !== undefined ? (activeTool === toolIds[0] ? blendWeight : (1.0 - blendWeight)) : 0.0);
          } else {
            exposure = (activeTool === targetTool) ? 1.0 : 0.0;
          }
        }
        exposure = Math.max(0.0, Math.min(1.0, exposure));

        let comp = 1.0;
        if (profileMode === 5 && multiColorInfo && L > 2) {
          comp = 1.0 + 0.35 * (4.0 * exposure * (1.0 - exposure));
        }

        let disp;
        if (isToolWeave) {
          const B = getWaveB(phi, exposure);
          const effExposure = (profileMode === 5) ? 1.0 : Math.min(1.0, exposure * comp);
          disp = -concaveVal + stroke * effExposure * B;
        } else {
          const flatMul = (profileMode === 5) ? Math.max(0.0, Number(flatAmpScale ?? 1.0)) : 1.0;
          disp = -concaveVal + stroke * flatMul * Math.min(1.0, exposure * comp);
        }

        // 極小の島では外側変位が自己交差を起こさないよう自然に抑制
        const safeDisp = useArbitraryMesh ? Math.min(disp, Math.max(0.15, halfWidthEst * 0.8)) : disp;
        const inDisp = (profileMode === 5)
          ? (Math.min(0.0, safeDisp) - effBaseWall)
          : (safeDisp - effWall);

        outX[i] = Math.fround(px + nx * safeDisp);
        outY[i] = Math.fround(py + ny * safeDisp);
        inX[i]  = Math.fround(px + nx * inDisp);
        inY[i]  = Math.fround(py + ny * inDisp);
      }

      if (isSolidBottom) {
        ensureCap(N * 4);
        // 外壁
        for (let i = 0; i < N; i++) {
          const next = (i + 1) % N;
          const nx = normX[i], ny = normY[i];
          addTri(outX[i], outY[i], z_bot, outX[next], outY[next], z_bot, outX[next], outY[next], z_top, nx, ny, 0, activeTool);
          addTri(outX[i], outY[i], z_bot, outX[next], outY[next], z_top, outX[i], outY[i], z_top, nx, ny, 0, activeTool);
        }

        // 底面・上面キャップ（2D Ear-ClippingでC字型・複数島も破綻ゼロ）
        const polyPts = new Array(N);
        for (let i = 0; i < N; i++) polyPts[i] = [outX[i], outY[i]];
        const capTrisIdx = triangulatePolygonCCW(polyPts);
        for (let c = 0; c < capTrisIdx.length; c += 3) {
          const i0 = capTrisIdx[c], i1 = capTrisIdx[c + 1], i2 = capTrisIdx[c + 2];
          // 底面 (-Z)
          addTri(outX[i2], outY[i2], z_bot, outX[i1], outY[i1], z_bot, outX[i0], outY[i0], z_bot, 0, 0, -1, activeTool);
          // 上面 (+Z)
          addTri(outX[i0], outY[i0], z_top, outX[i1], outY[i1], z_top, outX[i2], outY[i2], z_top, 0, 0, 1, activeTool);
        }
      } else {
        ensureCap(N * 8);
        for (let i = 0; i < N; i++) {
          const next = (i + 1) % N;
          const nx = normX[i], ny = normY[i];
          const ob0x = outX[i], ob0y = outY[i], ob1x = outX[next], ob1y = outY[next];
          const ib0x = inX[i],  ib0y = inY[i],  ib1x = inX[next],  ib1y = inY[next];

          // 1. 外壁
          addTri(ob0x, ob0y, z_bot, ob1x, ob1y, z_bot, ob1x, ob1y, z_top, nx, ny, 0, activeTool);
          addTri(ob0x, ob0y, z_bot, ob1x, ob1y, z_top, ob0x, ob0y, z_top, nx, ny, 0, activeTool);

          // 2. 内壁
          addTri(ib1x, ib1y, z_bot, ib0x, ib0y, z_bot, ib0x, ib0y, z_top, -nx, -ny, 0, activeTool);
          addTri(ib1x, ib1y, z_bot, ib0x, ib0y, z_top, ib1x, ib1y, z_top, -nx, -ny, 0, activeTool);

          // 3. 上面リング (+Z)
          addTri(ib0x, ib0y, z_top, ob0x, ob0y, z_top, ob1x, ob1y, z_top, 0, 0, 1, activeTool);
          addTri(ib0x, ib0y, z_top, ob1x, ob1y, z_top, ib1x, ib1y, z_top, 0, 0, 1, activeTool);

          // 4. 下面リング (-Z)
          addTri(ob0x, ob0y, z_bot, ib0x, ib0y, z_bot, ib1x, ib1y, z_bot, 0, 0, -1, activeTool);
          addTri(ob0x, ob0y, z_bot, ib1x, ib1y, z_bot, ob1x, ob1y, z_bot, 0, 0, -1, activeTool);
        }
      }
    }
  }

  return {
    positions: positions.subarray(0, triIdx * 9),
    normals: normals.subarray(0, triIdx * 9),
    tools: tools.subarray(0, triIdx),
    triCount: triIdx,
  };
}
