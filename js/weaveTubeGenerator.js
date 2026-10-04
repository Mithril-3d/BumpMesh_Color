/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * weaveTubeGenerator.js
 * 
 * 編み重ね（Weave: 矩形ブロック・三角波・正弦波）専用の「断面四角の輪ゴム積層チューブ生成エンジン」。
 * 
 * 円柱プリセットだけでなく、頭部モデルや彫刻、スザンヌ、カスタムSTLなど「任意の3Dメッシュ」に対応。
 * 各レイヤーの水平断面から外周輪郭半径 R(theta, z) を自動抽出し、
 * 厚み thickness（0.2mm）、幅 wallThickness（デフォルト 0.40mm）の断面四角い「輪ゴム（帯状リング）」として
 * レイヤーごとに直接プロシージャル生成し、100%水密なマニホールドとして出力する。
 * 
 * - 幅が0.40mm（ノズル径相当）であるため、スライサー上でトップ/ボトムインフィルが一切発生せず、
 *   全層が100%外周ペリメータとしてスライスされる。
 * - 波の周期の角（立ち上がり・立ち下がり）の正確な角度に頂点を打つため、
 *   サンプリング破綻（ギザギザ・毛羽立ち・モザイク砂嵐）が物理的にゼロとなり、美しいエッジの立った市松模様を形成する。
 */

/**
 * 2D半直線と線分の交差距離をクラメルの公式で計算
 */
function raySegmentIntersect(Dx, Dy, P1x, P1y, P2x, P2y) {
  const Vx = P2x - P1x;
  const Vy = P2y - P1y;
  const det = -Dx * Vy + Dy * Vx;
  if (Math.abs(det) < 1e-9) return null;
  const s = (-P1x * Vy + Vx * P1y) / det;
  const t = (Dx * P1y - Dy * P1x) / det;
  if (t < -1e-4 || t > 1.0001 || s < 0.01) return null;
  return s;
}

/**
 * メッシュの各レイヤー・各角度における外周輪郭半径 R(theta, z) を抽出する
 */
export function buildMeshContourRadii(meshPositions, cx, cy, minZ, thickness, totalLayers, angles, defaultRadius) {
  const N = angles.length;
  const layerRadii = new Float32Array(totalLayers * N);
  const triCount = Math.floor(meshPositions.length / 9);

  // 1. Zバケットによる交差三角形の高速インデックス化
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

  // 角度の cos / sin を事前計算
  const cosAngles = new Float32Array(N);
  const sinAngles = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    cosAngles[i] = Math.cos(angles[i]);
    sinAngles[i] = Math.sin(angles[i]);
  }

  let prevLayerRadii = null;

  for (let lay = 0; lay < totalLayers; lay++) {
    const z = minZ + (lay + 0.5) * thickness;
    const tris = layerTris[lay];
    const segs = []; // [p1x, p1y, p2x, p2y] relative to (cx, cy)

    for (let k = 0; k < tris.length; k++) {
      const b = tris[k] * 9;
      const x0 = meshPositions[b] - cx,     y0 = meshPositions[b + 1] - cy,     z0 = meshPositions[b + 2];
      const x1 = meshPositions[b + 3] - cx, y1 = meshPositions[b + 4] - cy, z1 = meshPositions[b + 5];
      const x2 = meshPositions[b + 6] - cx, y2 = meshPositions[b + 7] - cy, z2 = meshPositions[b + 8];

      const pts = [[x0, y0, z0], [x1, y1, z1], [x2, y2, z2]];
      const cuts = [];
      for (let e = 0; e < 3; e++) {
        const pa = pts[e];
        const pb = pts[(e + 1) % 3];
        const za = pa[2], zb = pb[2];
        if ((za <= z && zb >= z) || (za >= z && zb <= z)) {
          if (Math.abs(za - zb) > 1e-7) {
            const u = (z - za) / (zb - za);
            cuts.push(pa[0] + u * (pb[0] - pa[0]), pa[1] + u * (pb[1] - pa[1]));
          }
        }
      }
      if (cuts.length >= 4) {
        segs.push(cuts[0], cuts[1], cuts[2], cuts[3]);
      }
    }

    const curOffset = lay * N;
    if (segs.length === 0) {
      if (prevLayerRadii) {
        layerRadii.set(prevLayerRadii, curOffset);
      } else {
        layerRadii.fill(defaultRadius, curOffset, curOffset + N);
      }
      continue;
    }

    const numSegs = segs.length / 4;
    for (let i = 0; i < N; i++) {
      const Dx = cosAngles[i];
      const Dy = sinAngles[i];
      let maxDist = 0.0;

      for (let s = 0; s < numSegs; s++) {
        const sb = s * 4;
        const p1x = segs[sb],     p1y = segs[sb + 1];
        const p2x = segs[sb + 2], p2y = segs[sb + 3];
        const dist = raySegmentIntersect(Dx, Dy, p1x, p1y, p2x, p2y);
        if (dist !== null && dist > maxDist) {
          maxDist = dist;
        }
      }

      if (maxDist > 0.1) {
        layerRadii[curOffset + i] = maxDist;
      } else if (prevLayerRadii && prevLayerRadii[i] > 0.1) {
        layerRadii[curOffset + i] = prevLayerRadii[i];
      } else {
        layerRadii[curOffset + i] = defaultRadius;
      }
    }

    // 隙間がある場合の隣接角度補間
    for (let i = 0; i < N; i++) {
      if (layerRadii[curOffset + i] <= 0.1) {
        let leftIdx = (i - 1 + N) % N;
        while (leftIdx !== i && layerRadii[curOffset + leftIdx] <= 0.1) leftIdx = (leftIdx - 1 + N) % N;
        let rightIdx = (i + 1) % N;
        while (rightIdx !== i && layerRadii[curOffset + rightIdx] <= 0.1) rightIdx = (rightIdx + 1) % N;
        layerRadii[curOffset + i] = (layerRadii[curOffset + leftIdx] + layerRadii[curOffset + rightIdx]) * 0.5 || defaultRadius;
      }
    }

    prevLayerRadii = layerRadii.subarray(curOffset, curOffset + N);
  }

  return layerRadii;
}

/**
 * 輪ゴム積層チューブメッシュを生成する（任意メッシュおよび円柱に対応）
 * 
 * @param {Object} options
 * @param {Float32Array} [options.meshPositions=null] - 任意モデルの三角形頂点配列（指定時はモデルの外形輪郭に追従）
 * @param {number} [options.radius=40] - 基準外径半径 (mm, 円柱時またはフォールバック)
 * @param {number} [options.cx=0] - 中心X (mm)
 * @param {number} [options.cy=0] - 中心Y (mm)
 * @param {number} [options.minZ=0] - 底面Z (mm)
 * @param {number} [options.thickness=0.20] - レイヤー厚み (mm)
 * @param {number} [options.wallThickness=0.40] - 輪ゴムの肉厚 (mm, デフォルト 0.40)
 * @param {number} [options.totalLayers=100] - レイヤー総数
 * @param {Array<number>} [options.toolIds=[1, 2]] - 使用ツールID配列 [tool0, tool1]
 * @param {number} [options.profileMode=4] - 2: 正弦波, 3: 三角波, 4: 矩形ブロック
 * @param {number} [options.pitch=1.6] - 波の周方向ピッチ (mm, デフォルト 1.6)
 * @param {number} [options.convexVal=0.35] - 凸量 (mm)
 * @param {number} [options.concaveVal=0.00] - 凹量 (mm)
 * @param {Function} [options.sampleFn=null] - (x, y, z, nx, ny, nz) => { targetTool, blendWeight, multiColorInfo }
 * @returns {{ positions: Float32Array, normals: Float32Array, tools: Int32Array, triCount: number }}
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
} = {}) {
  const t = Math.max(0.01, Number(thickness) || 0.20);
  const wall = Math.max(0.10, Number(wallThickness) || 0.40);
  const layers = Math.max(1, Math.round(totalLayers));
  const stroke = Math.max(0.01, (convexVal + concaveVal) > 0 ? (convexVal + concaveVal) : 0.60);

  const circumference = 2.0 * Math.PI * radius;
  const p = Math.max(0.2, Number(pitch) || 1.60);
  const waveCount = Math.max(6, Math.round(circumference / p));

  // 波の周期に応じた角（立ち上がり・立ち下がり）の角度グリッドを構築
  const edge = 0.05;
  let uKeypoints;
  if (profileMode === 4) {
    // 矩形ブロック: 偶数層と奇数層の全角を含む8点
    uKeypoints = [0.0, edge, 0.25, 0.5 - edge, 0.5, 0.5 + edge, 0.75, 1.0 - edge];
  } else if (profileMode === 3) {
    // 三角波: 山・谷・中間の8点
    uKeypoints = [0.0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875];
  } else {
    // 正弦波: 1周期あたり12点均等分割
    uKeypoints = [];
    const step = 1.0 / 12.0;
    for (let k = 0; k < 12; k++) uKeypoints.push(k * step);
  }

  const angles = [];
  const dPhi = (2.0 * Math.PI) / waveCount;
  for (let w = 0; w < waveCount; w++) {
    const basePhi = w * dPhi;
    for (const u of uKeypoints) {
      angles.push(basePhi + u * dPhi);
    }
  }
  const N = angles.length;

  // メッシュが与えられた場合は全レイヤー・全角度の外周輪郭半径を抽出
  let contourRadii = null;
  if (meshPositions && meshPositions.length >= 9) {
    contourRadii = buildMeshContourRadii(meshPositions, cx, cy, minZ, t, layers, angles, radius);
  }

  // 正規化波形 B [0.0, 1.0]
  function getWaveB(phi) {
    const u = ((phi / (2.0 * Math.PI)) % 1.0 + 1.0) % 1.0;
    if (profileMode === 4) {
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

  // 1レイヤーあたりの三角形数: 外壁(2N) + 内壁(2N) + 上面(2N) + 下面(2N) = 8N
  const trisPerLayer = N * 8;
  const totalTris = layers * trisPerLayer;

  const positions = new Float32Array(totalTris * 9);
  const normals = new Float32Array(totalTris * 9);
  const tools = new Int32Array(totalTris);

  let triIdx = 0;
  function addTri(x0, y0, z0, x1, y1, z1, x2, y2, z2, nx, ny, nz, tool) {
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

  // 頂点座標キャッシュ（各レイヤーで再利用）
  const outBot = new Float32Array(N * 3);
  const outTop = new Float32Array(N * 3);
  const inBot  = new Float32Array(N * 3);
  const inTop  = new Float32Array(N * 3);

  for (let lay = 0; lay < layers; lay++) {
    const z_bot = Math.fround(minZ + lay * t);
    const z_top = Math.fround(minZ + (lay + 1) * t);
    const z_mid = (z_bot + z_top) * 0.5;
    const activeTool = toolIds[lay % toolIds.length];
    const layerPhase = (lay % 2) * Math.PI;

    // 各角度における内外の頂点位置を計算
    for (let i = 0; i < N; i++) {
      const th = angles[i];
      const cosTh = Math.cos(th);
      const sinTh = Math.sin(th);
      const phi = waveCount * th + layerPhase;
      const B = getWaveB(phi);

      const r_base = (contourRadii && contourRadii[lay * N + i] > 0.1) ? contourRadii[lay * N + i] : radius;

      // テクスチャ/曲率サンプリングによる exposure
      let exposure = 0.5;
      if (sampleFn) {
        const testX = cx + r_base * cosTh;
        const testY = cy + r_base * sinTh;
        const { targetTool, blendWeight, multiColorInfo } = sampleFn(testX, testY, z_mid, cosTh, sinTh, 0);
        if (multiColorInfo) {
          const { toolA, toolB, t: tAffinity } = multiColorInfo;
          if (activeTool === toolA) exposure = tAffinity;
          else if (activeTool === toolB) exposure = 1.0 - tAffinity;
          else exposure = 0.0;
        } else if (toolIds.length >= 2) {
          exposure = (activeTool === targetTool) ? 1.0 : (blendWeight !== undefined ? (activeTool === toolIds[0] ? blendWeight : (1.0 - blendWeight)) : 0.0);
        } else {
          exposure = (activeTool === targetTool) ? 1.0 : 0.0;
        }
      }
      exposure = Math.max(0.0, Math.min(1.0, exposure));

      // フラット段差と同等のアルゴリズム: 各層の露出率 exposure に応じてシンプルに波打ち出っ張る
      const disp = -concaveVal + stroke * exposure * B;

      const r_out = Math.fround(r_base + disp);
      const r_in  = Math.fround(r_out - wall);

      const obX = cx + r_out * cosTh;
      const obY = cy + r_out * sinTh;
      const ibX = cx + r_in * cosTh;
      const ibY = cy + r_in * sinTh;

      const idx = i * 3;
      outBot[idx] = obX; outBot[idx + 1] = obY; outBot[idx + 2] = z_bot;
      outTop[idx] = obX; outTop[idx + 1] = obY; outTop[idx + 2] = z_top;
      inBot[idx]  = ibX; inBot[idx + 1]  = ibY; inBot[idx + 2]  = z_bot;
      inTop[idx]  = ibX; inTop[idx + 1]  = ibY; inTop[idx + 2]  = z_top;
    }

    const isSolidBottom = (lay < 3);

    if (isSolidBottom) {
      // 🧱 最初の3層は中身の詰まったソリッド円盤ディスク（ベッド定着・底面用）
      for (let i = 0; i < N; i++) {
        const next = (i + 1) % N;
        const i0 = i * 3;
        const i1 = next * 3;

        const ob0_x = outBot[i0], ob0_y = outBot[i0 + 1], ob0_z = outBot[i0 + 2];
        const ob1_x = outBot[i1], ob1_y = outBot[i1 + 1], ob1_z = outBot[i1 + 2];
        const ot0_x = outTop[i0], ot0_y = outTop[i0 + 1], ot0_z = outTop[i0 + 2];
        const ot1_x = outTop[i1], ot1_y = outTop[i1 + 1], ot1_z = outTop[i1 + 2];

        const nx = Math.cos(angles[i]);
        const ny = Math.sin(angles[i]);

        // 1. 外壁 (Outer Wall: CCW from outside)
        addTri(ob0_x, ob0_y, ob0_z, ob1_x, ob1_y, ob1_z, ot1_x, ot1_y, ot1_z, nx, ny, 0, activeTool);
        addTri(ob0_x, ob0_y, ob0_z, ot1_x, ot1_y, ot1_z, ot0_x, ot0_y, ot0_z, nx, ny, 0, activeTool);

        // 2. 底面 (Bottom Face: CCW looking from below)
        addTri(ob1_x, ob1_y, ob1_z, ob0_x, ob0_y, ob0_z, cx, cy, z_bot, 0, 0, -1, activeTool);

        // 3. 上面 (Top Face: CCW looking from above)
        addTri(ot0_x, ot0_y, ot0_z, ot1_x, ot1_y, ot1_z, cx, cy, z_top, 0, 0, 1, activeTool);
      }
    } else {
      // 🧶 4層目以降は中空の輪ゴム（帯状リング）
      for (let i = 0; i < N; i++) {
        const next = (i + 1) % N;
        const i0 = i * 3;
        const i1 = next * 3;

        const ob0_x = outBot[i0], ob0_y = outBot[i0 + 1], ob0_z = outBot[i0 + 2];
        const ob1_x = outBot[i1], ob1_y = outBot[i1 + 1], ob1_z = outBot[i1 + 2];
        const ot0_x = outTop[i0], ot0_y = outTop[i0 + 1], ot0_z = outTop[i0 + 2];
        const ot1_x = outTop[i1], ot1_y = outTop[i1 + 1], ot1_z = outTop[i1 + 2];

        const ib0_x = inBot[i0], ib0_y = inBot[i0 + 1], ib0_z = inBot[i0 + 2];
        const ib1_x = inBot[i1], ib1_y = inBot[i1 + 1], ib1_z = inBot[i1 + 2];
        const it0_x = inTop[i0], it0_y = inTop[i0 + 1], it0_z = inTop[i0 + 2];
        const it1_x = inTop[i1], it1_y = inTop[i1 + 1], it1_z = inTop[i1 + 2];

        const nx = Math.cos(angles[i]);
        const ny = Math.sin(angles[i]);

        // 1. 外壁 (Outer Wall: CCW from outside)
        addTri(ob0_x, ob0_y, ob0_z, ob1_x, ob1_y, ob1_z, ot1_x, ot1_y, ot1_z, nx, ny, 0, activeTool);
        addTri(ob0_x, ob0_y, ob0_z, ot1_x, ot1_y, ot1_z, ot0_x, ot0_y, ot0_z, nx, ny, 0, activeTool);

        // 2. 内壁 (Inner Wall: CCW from inside)
        addTri(ib1_x, ib1_y, ib1_z, ib0_x, ib0_y, ib0_z, it0_x, it0_y, it0_z, -nx, -ny, 0, activeTool);
        addTri(ib1_x, ib1_y, ib1_z, it0_x, it0_y, it0_z, it1_x, it1_y, it1_z, -nx, -ny, 0, activeTool);

        // 3. 上面 (Top Ring Face: +Z)
        addTri(it0_x, it0_y, it0_z, ot0_x, ot0_y, ot0_z, ot1_x, ot1_y, ot1_z, 0, 0, 1, activeTool);
        addTri(it0_x, it0_y, it0_z, ot1_x, ot1_y, ot1_z, it1_x, it1_y, it1_z, 0, 0, 1, activeTool);

        // 4. 下面 (Bottom Ring Face: -Z)
        addTri(ob0_x, ob0_y, ob0_z, ib0_x, ib0_y, ib0_z, ib1_x, ib1_y, ib1_z, 0, 0, -1, activeTool);
        addTri(ob0_x, ob0_y, ob0_z, ib1_x, ib1_y, ib1_z, ob1_x, ob1_y, ob1_z, 0, 0, -1, activeTool);
      }
    }
  }

  return {
    positions,
    normals,
    tools,
    triCount: triIdx,
  };
}
