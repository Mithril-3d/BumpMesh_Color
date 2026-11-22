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
 * 水平断面上の交線セグメント群を連結し、外周ループ (area > 0) と穴ループ (area < 0) に分けて返す
 */
function stitchSegmentsToLoops(segs, normals) {
  const nSeg = segs.length / 4;
  if (nSeg < 3) return { outer: [], holes: [] };

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

  if (loops.length === 0) return { outer: [], holes: [] };

  const outer = loops.filter(lp => lp.area > 0);
  const holes = loops.filter(lp => lp.area < 0);
  if (outer.length > 0) return { outer, holes };

  // 万一法線が全面逆向きのメッシュだった場合のみ反転して外周扱い
  return {
    outer: holes.map(lp => ({
      pts: lp.pts.slice().reverse(),
      area: -lp.area,
      perim: lp.perim,
    })),
    holes: [],
  };
}

function pointInPolygon2D(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1];
    const xj = poly[j][0], yj = poly[j][1];
    const intersect = ((yi > py) !== (yj > py)) &&
      (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-12) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

/**
 * メッシュの各Zレイヤーにおける全閉ループ（複数島＋穴）を抽出する
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
  let prevData = { outer: [], holes: [] };

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

    const res = stitchSegmentsToLoops(segs, normals);
    if (res.outer.length > 0) {
      allLayerLoops[lay] = res;
      prevData = res;
    } else {
      allLayerLoops[lay] = prevData;
    }
  }

  return allLayerLoops;
}

function polygonHasSelfIntersection(pts) {
  const n = pts.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const ax = a[0], ay = a[1], bx = b[0], by = b[1];
    const minAx = ax < bx ? ax : bx, maxAx = ax > bx ? ax : bx;
    const minAy = ay < by ? ay : by, maxAy = ay > by ? ay : by;
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = pts[j], d = pts[(j + 1) % n];
      const cx = c[0], cy = c[1], dx = d[0], dy = d[1];
      if ((cx > dx ? cx : dx) < minAx - 1e-6) continue;
      if ((cx < dx ? cx : dx) > maxAx + 1e-6) continue;
      if ((cy > dy ? cy : dy) < minAy - 1e-6) continue;
      if ((cy < dy ? cy : dy) > maxAy + 1e-6) continue;
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(den) < 1e-10) continue;
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      if (t > 1e-5 && t < 1.0 - 1e-5 && u > 1e-5 && u < 1.0 - 1e-5) return true;
    }
  }
  return false;
}

/**
 * 穴付き2D CCWポリゴンをブリッジング＋Ear-Clippingで三角形分割する（中充填の穴抜き対応）
 * 戻り値: { pts: 統合頂点配列 [[x,y],...], tris: 三角形インデックス配列 [i0,i1,i2,...] }
 */
function triangulatePolygonWithHoles(outerPts, holePtsList = []) {
  let merged = outerPts.slice();

  if (holePtsList && holePtsList.length > 0) {
    // 各穴の最右頂点(maxX)を求めて降順ソート
    const holesWithMax = holePtsList.map(h => {
      let maxIdx = 0;
      for (let i = 1; i < h.length; i++) {
        if (h[i][0] > h[maxIdx][0]) maxIdx = i;
      }
      return { pts: h, maxIdx, maxX: h[maxIdx][0] };
    }).sort((a, b) => b.maxX - a.maxX);

    const segIntersect = (ax, ay, bx, by, cx, cy, dx, dy) => {
      const den = (bx - ax) * (dy - cy) - (by - ay) * (dx - cx);
      if (Math.abs(den) < 1e-10) return false;
      const t = ((cx - ax) * (dy - cy) - (cy - ay) * (dx - cx)) / den;
      const u = ((cx - ax) * (by - ay) - (cy - ay) * (bx - ax)) / den;
      return t > 1e-5 && t < 1.0 - 1e-5 && u > 1e-5 && u < 1.0 - 1e-5;
    };

    for (const hole of holesWithMax) {
      const hPts = hole.pts;
      const hm = hole.maxIdx;
      const M = hPts[hm];

      // Eberlyの厳密水平レイ法: Mから+X方向へ水平レイを伸ばし、mergedとの最短交点Iを含む辺の右端点を優先
      let bestRayX = Infinity;
      let rayEdgeIdx = -1;
      for (let ei = 0; ei < merged.length; ei++) {
        const ea = merged[ei], eb = merged[(ei + 1) % merged.length];
        if ((ea[1] <= M[1] && eb[1] > M[1]) || (eb[1] <= M[1] && ea[1] > M[1])) {
          const ix = ea[0] + ((M[1] - ea[1]) / (eb[1] - ea[1])) * (eb[0] - ea[0]);
          if (ix >= M[0] - 1e-6 && ix < bestRayX) {
            bestRayX = ix;
            rayEdgeIdx = ei;
          }
        }
      }

      const isBridgeClear = (P) => {
        for (let ei = 0; ei < merged.length; ei++) {
          const ea = merged[ei], eb = merged[(ei + 1) % merged.length];
          if (segIntersect(M[0], M[1], P[0], P[1], ea[0], ea[1], eb[0], eb[1])) return false;
        }
        for (let hi = 0; hi < hPts.length; hi++) {
          const ha = hPts[hi], hb = hPts[(hi + 1) % hPts.length];
          if (segIntersect(M[0], M[1], P[0], P[1], ha[0], ha[1], hb[0], hb[1])) return false;
        }
        return true;
      };

      let bestPIdx = -1;
      if (rayEdgeIdx >= 0) {
        const iA = rayEdgeIdx;
        const iB = (rayEdgeIdx + 1) % merged.length;
        const cand = (merged[iA][0] >= merged[iB][0]) ? [iA, iB] : [iB, iA];
        for (const ci of cand) {
          if (isBridgeClear(merged[ci])) {
            bestPIdx = ci;
            break;
          }
        }
      }

      if (bestPIdx === -1) {
        let bestDist2 = 1e18;
        for (let pi = 0; pi < merged.length; pi++) {
          const P = merged[pi];
          if (P[0] < M[0] - 1e-4) continue;
          const d2 = (P[0] - M[0]) ** 2 + (P[1] - M[1]) ** 2;
          if (d2 >= bestDist2) continue;
          if (isBridgeClear(P)) {
            bestDist2 = d2;
            bestPIdx = pi;
          }
        }
      }
      if (bestPIdx === -1) {
        let bestDist2 = 1e18;
        for (let pi = 0; pi < merged.length; pi++) {
          const P = merged[pi];
          const d2 = (P[0] - M[0]) ** 2 + (P[1] - M[1]) ** 2;
          if (d2 < bestDist2) { bestDist2 = d2; bestPIdx = pi; }
        }
      }

      if (bestPIdx >= 0) {
        const P = merged[bestPIdx];
        const bridge = [];
        for (let k = 0; k < hPts.length; k++) {
          bridge.push(hPts[(hm + k) % hPts.length]);
        }
        bridge.push(M, P);
        merged.splice(bestPIdx + 1, 0, ...bridge);
      }
    }
  }

  return { pts: merged, tris: triangulatePolygonCCW(merged) };
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

  const samePt = (p, q) => Math.abs(p[0] - q[0]) < 1e-6 && Math.abs(p[1] - q[1]) < 1e-6;

  const pointInTri = (p, a, b, c) => {
    if (samePt(p, a) || samePt(p, b) || samePt(p, c)) return false;
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
    // 自己交差等により厳密耳切りが停止した場合も、全体を跨ぐファン分割は行わず
    // 最小面積の局所三角形から順に安全に切り落とす
    while (indices.length > 3) {
      const m = indices.length;
      let bestK = 0;
      let bestScore = 1e18;
      for (let k = 0; k < m; k++) {
        const a = pts[indices[(k - 1 + m) % m]];
        const b = pts[indices[k]];
        const c = pts[indices[(k + 1) % m]];
        const cr = cross2(a, b, c);
        const perim = Math.hypot(b[0] - a[0], b[1] - a[1]) + Math.hypot(c[0] - b[0], c[1] - b[1]) + Math.hypot(a[0] - c[0], a[1] - c[1]);
        const score = (cr > 0 ? cr : (Math.abs(cr) + 1000.0)) + perim * 0.1;
        if (score < bestScore) {
          bestScore = score;
          bestK = k;
        }
      }
      const pIdx = indices[(bestK - 1 + m) % m];
      const cIdx = indices[bestK];
      const nIdx = indices[(bestK + 1) % m];
      out.push(pIdx, cIdx, nIdx);
      indices.splice(bestK, 1);
    }
    if (indices.length === 3) out.push(indices[0], indices[1], indices[2]);
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
  solidFill = false,
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
    const isSolidBottom = !!solidFill || (lay < 3);

    // このレイヤーで生成するループ群を用意
    let loopsForLayer;
    let holesForLayer = [];
    if (useArbitraryMesh) {
      const layerData = allLayerLoops[lay];
      loopsForLayer = layerData?.outer;
      holesForLayer = layerData?.holes || [];
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
        // この外周ループに内包される穴ループを抽出
        const myHoles = [];
        for (let hi = 0; hi < holesForLayer.length; hi++) {
          const hp = holesForLayer[hi].pts;
          if (hp.length >= 3 && pointInPolygon2D(hp[0][0], hp[0][1], lp.pts)) {
            myHoles.push(hp);
          }
        }

        // 底面・上面キャップ用の内側コア(corePts)を先に確定し、outX/outYも整合させる:
        // 波打ちトゲ(outX,outY)や凹み谷(-concaveVal)のノコギリ歯で自己交差が起きないよう、
        // 滑らかな一定インセットの内側コア(corePts)と穴(myHoles)で厳密に穴くり抜き三角形分割し、
        // corePts〜outPts間の波打ちフリンジはO(N)クワッド帯で接続する
        let safeCoreInset = Math.min(Math.max(0, concaveVal), Math.max(0.0, halfWidthEst * 0.35));
        if (safeCoreInset > 1e-4 && myHoles.length > 0) {
          let minGapSq = 1e18;
          for (const hp of myHoles) {
            for (let hi = 0; hi < hp.length; hi++) {
              const hx = hp[hi][0], hy = hp[hi][1];
              for (let i = 0; i < N; i += 2) {
                const dx = basePtsX[i] - hx, dy = basePtsY[i] - hy;
                const d2 = dx * dx + dy * dy;
                if (d2 < minGapSq) minGapSq = d2;
              }
            }
          }
          safeCoreInset = Math.min(safeCoreInset, Math.sqrt(minGapSq) * 0.35);
        }

        const corePts = new Array(N);
        // 鋭角な凹み部でインセットが自己交差しないよう、自己交差が出た場合はsafeCoreInsetを段階的に縮小
        for (let attempt = 0; attempt < 5; attempt++) {
          for (let i = 0; i < N; i++) {
            corePts[i] = [
              Math.fround(basePtsX[i] - normX[i] * safeCoreInset),
              Math.fround(basePtsY[i] - normY[i] * safeCoreInset),
            ];
          }
          if (safeCoreInset <= 1e-4 || !polygonHasSelfIntersection(corePts)) break;
          safeCoreInset = (attempt < 3) ? safeCoreInset * 0.45 : 0.0;
        }

        let hasFringe = false;
        for (let i = 0; i < N; i++) {
          const cx_i = corePts[i][0];
          const cy_i = corePts[i][1];
          const dxo = outX[i] - cx_i, dyo = outY[i] - cy_i;
          const dotOut = dxo * normX[i] + dyo * normY[i];
          if (dotOut > 1e-4) {
            hasFringe = true;
          } else {
            outX[i] = cx_i;
            outY[i] = cy_i;
          }
        }

        // 外壁
        ensureCap(N * 2 + myHoles.reduce((s, h) => s + h.length * 2, 0));
        for (let i = 0; i < N; i++) {
          const next = (i + 1) % N;
          const nx = normX[i], ny = normY[i];
          addTri(outX[i], outY[i], z_bot, outX[next], outY[next], z_bot, outX[next], outY[next], z_top, nx, ny, 0, activeTool);
          addTri(outX[i], outY[i], z_bot, outX[next], outY[next], z_top, outX[i], outY[i], z_top, nx, ny, 0, activeTool);
        }

        // 穴ループの側壁（CWループなので外向き＝穴の中心向き）
        for (const hp of myHoles) {
          const hm = hp.length;
          for (let i = 0; i < hm; i++) {
            const next = (i + 1) % hm;
            const ax = hp[i][0], ay = hp[i][1];
            const bx = hp[next][0], by = hp[next][1];
            const dx = bx - ax, dy = by - ay;
            const dl = Math.hypot(dx, dy) || 1;
            const hnx = dy / dl, hny = -dx / dl;
            addTri(ax, ay, z_bot, bx, by, z_bot, bx, by, z_top, hnx, hny, 0, activeTool);
            addTri(ax, ay, z_bot, bx, by, z_top, ax, ay, z_top, hnx, hny, 0, activeTool);
          }
        }

        const { pts: capPts, tris: capTrisIdx } = triangulatePolygonWithHoles(corePts, myHoles);
        ensureCap(capTrisIdx.length * 2 + (hasFringe ? N * 4 : 0));
        for (let c = 0; c < capTrisIdx.length; c += 3) {
          const p0 = capPts[capTrisIdx[c]], p1 = capPts[capTrisIdx[c + 1]], p2 = capPts[capTrisIdx[c + 2]];
          // 底面 (-Z)
          addTri(p2[0], p2[1], z_bot, p1[0], p1[1], z_bot, p0[0], p0[1], z_bot, 0, 0, -1, activeTool);
          // 上面 (+Z)
          addTri(p0[0], p0[1], z_top, p1[0], p1[1], z_top, p2[0], p2[1], z_top, 0, 0, 1, activeTool);
        }

        // 外側の波打ちフリンジ帯 (corePts -> outPts) を上面(+Z)・下面(-Z)に張る
        if (hasFringe) {
          for (let i = 0; i < N; i++) {
            const next = (i + 1) % N;
            const c0x = corePts[i][0],    c0y = corePts[i][1];
            const c1x = corePts[next][0], c1y = corePts[next][1];
            const o0x = outX[i],          o0y = outY[i];
            const o1x = outX[next],       o1y = outY[next];
            const d0 = (c0x !== o0x || c0y !== o0y);
            const d1 = (c1x !== o1x || c1y !== o1y);
            if (!d0 && !d1) continue;
            if (d0 && d1) {
              // 上面 (+Z): c0 -> o0 -> o1, c0 -> o1 -> c1
              addTri(c0x, c0y, z_top, o0x, o0y, z_top, o1x, o1y, z_top, 0, 0, 1, activeTool);
              addTri(c0x, c0y, z_top, o1x, o1y, z_top, c1x, c1y, z_top, 0, 0, 1, activeTool);
              // 下面 (-Z)
              addTri(o1x, o1y, z_bot, o0x, o0y, z_bot, c0x, c0y, z_bot, 0, 0, -1, activeTool);
              addTri(c1x, c1y, z_bot, o1x, o1y, z_bot, c0x, c0y, z_bot, 0, 0, -1, activeTool);
            } else if (d0) {
              addTri(c0x, c0y, z_top, o0x, o0y, z_top, c1x, c1y, z_top, 0, 0, 1, activeTool);
              addTri(c1x, c1y, z_bot, o0x, o0y, z_bot, c0x, c0y, z_bot, 0, 0, -1, activeTool);
            } else {
              addTri(c0x, c0y, z_top, o1x, o1y, z_top, c1x, c1y, z_top, 0, 0, 1, activeTool);
              addTri(c1x, c1y, z_bot, o1x, o1y, z_bot, c0x, c0y, z_bot, 0, 0, -1, activeTool);
            }
          }
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

    // 輪ゴム中空モード (lay >= 3 && !solidFill) で穴ループが存在する場合、
    // 穴の内壁（とぐろの中央空洞側の壁）も輪ゴムリングとして生成する
    if (!isSolidBottom && holesForLayer.length > 0) {
      for (let hi = 0; hi < holesForLayer.length; hi++) {
        const hp = holesForLayer[hi].pts;
        const hm = hp.length;
        if (hm < 3) continue;
        const hWall = Math.min(wall, Math.max(0.20, Math.abs(holesForLayer[hi].area) / Math.max(1e-3, holesForLayer[hi].perim) * 1.2));
        ensureCap(hm * 8);
        // hpはCW（穴の中心から見て外向き＝右90度は(dy,-dx)が穴の中心向き）
        const hOutX = new Float64Array(hm);
        const hOutY = new Float64Array(hm);
        const hInX  = new Float64Array(hm);
        const hInY  = new Float64Array(hm);
        const hNx   = new Float64Array(hm);
        const hNy   = new Float64Array(hm);
        for (let i = 0; i < hm; i++) {
          const prev = (i - 1 + hm) % hm;
          const next = (i + 1) % hm;
          const tx = hp[next][0] - hp[prev][0];
          const ty = hp[next][1] - hp[prev][1];
          const len = Math.hypot(tx, ty) || 1;
          // CWループの右90度(ty/len, -tx/len)は穴の中心方向（自由空間側）
          const nx = ty / len;
          const ny = -tx / len;
          hNx[i] = nx;
          hNy[i] = ny;
          hInX[i]  = Math.fround(hp[i][0]);
          hInY[i]  = Math.fround(hp[i][1]);
          hOutX[i] = Math.fround(hp[i][0] - nx * hWall); // 肉側（外側）へ厚み
          hOutY[i] = Math.fround(hp[i][1] - ny * hWall);
        }
        for (let i = 0; i < hm; i++) {
          const next = (i + 1) % hm;
          const nx = hNx[i], ny = hNy[i];
          const ib0x = hInX[i],  ib0y = hInY[i],  ib1x = hInX[next],  ib1y = hInY[next];
          const ob0x = hOutX[i], ob0y = hOutY[i], ob1x = hOutX[next], ob1y = hOutY[next];
          // 穴側壁 (穴中心向き法線: CWなので ib0 -> ib1 -> top で穴側を向く)
          addTri(ib0x, ib0y, z_bot, ib1x, ib1y, z_bot, ib1x, ib1y, z_top, nx, ny, 0, activeTool);
          addTri(ib0x, ib0y, z_bot, ib1x, ib1y, z_top, ib0x, ib0y, z_top, nx, ny, 0, activeTool);
          // 肉側壁
          addTri(ob1x, ob1y, z_bot, ob0x, ob0y, z_bot, ob0x, ob0y, z_top, -nx, -ny, 0, activeTool);
          addTri(ob1x, ob1y, z_bot, ob0x, ob0y, z_top, ob1x, ob1y, z_top, -nx, -ny, 0, activeTool);
          // 上面リング (+Z)
          addTri(ib0x, ib0y, z_top, ib1x, ib1y, z_top, ob1x, ob1y, z_top, 0, 0, 1, activeTool);
          addTri(ib0x, ib0y, z_top, ob1x, ob1y, z_top, ob0x, ob0y, z_top, 0, 0, 1, activeTool);
          // 下面リング (-Z)
          addTri(ib1x, ib1y, z_bot, ib0x, ib0y, z_bot, ob0x, ob0y, z_bot, 0, 0, -1, activeTool);
          addTri(ib1x, ib1y, z_bot, ob0x, ob0y, z_bot, ob1x, ob1y, z_bot, 0, 0, -1, activeTool);
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
