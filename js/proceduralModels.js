/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as THREE from 'three';

/**
 * 画像サイズ、指定高さ、一周枚数、角数から自動サイズ寸法を計算する
 * 
 * @param {Object} params
 * @param {number} params.imageWidth   - 画像のピクセル幅
 * @param {number} params.imageHeight  - 画像のピクセル高さ
 * @param {number} params.targetHeight - 指定モデル高さ (mm, デフォルト 100)
 * @param {number} params.repeatCount  - 一周あたりの画像枚数 (デフォルト 1)
 * @param {string} params.shape        - 'cylinder' | 'ngon' | 'bowl' | 'cube'
 * @param {number} params.n            - n角形の辺数 (デフォルト 6, 最小 3)
 * @returns {Object} 計算結果の寸法情報
 */
export function computeAutoFitDimensions({
  imageWidth = 1000,
  imageHeight = 1000,
  targetHeight = 100,
  repeatCount = 1,
  shape = 'cylinder',
  n = 6,
} = {}) {
  const H = Math.max(1, Number(targetHeight) || 100);
  const N = Math.max(1, Math.round(Number(repeatCount) || 1));
  const sides = Math.max(3, Math.round(Number(n) || 6));
  
  // アスペクト比 (幅 / 高さ)
  const imgW = Math.max(1, Number(imageWidth) || 1000);
  const imgH = Math.max(1, Number(imageHeight) || 1000);
  const aspect = imgW / imgH;

  // 画像1枚の展開幅 (mm)
  const widthSingle = H * aspect;
  // 一周分の外周長 (Circumference / Perimeter, mm)
  const circumference = N * widthSingle;

  let radius = 0;
  let sideLength = 0;

  if (shape === 'cylinder' || shape === 'bowl') {
    // 円周 C = 2 * PI * R
    radius = circumference / (2 * Math.PI);
  } else if (shape === 'ngon') {
    // 正n角形: 外周 C = n * s
    sideLength = circumference / sides;
    // 1辺 s から外接円半径 R: s / 2 = R * sin(PI / n) => R = s / (2 * sin(PI / n))
    radius = sideLength / (2 * Math.sin(Math.PI / sides));
  } else {
    // cube (固定50mmまたはH基準)
    radius = H * 0.5;
    sideLength = H;
  }

  return {
    shape,
    height: H,
    repeatCount: N,
    n: sides,
    aspect,
    widthSingle,
    circumference,
    radius,
    sideLength,
  };
}

/**
 * 高精細な筒（円柱 / Cylinder）ジオメトリを生成
 * Z-up 座標系で原点中心に配置された非インデックス BufferGeometry を返す
 */
export function createCylinderGeometry({
  radius = 40,
  height = 100,
  radialSegments = null,
  heightSegments = null,
} = {}) {
  const R = Math.max(0.5, Number(radius) || 40);
  const H = Math.max(1, Number(height) || 100);

  // 外周長と高さに応じて解像度を自動調整（0.8〜1.0mmピッチ程度を目標に）
  const circumference = 2 * Math.PI * R;
  const radSegs = radialSegments || Math.min(360, Math.max(96, Math.round(circumference / 0.8)));
  const hSegs = heightSegments || Math.min(250, Math.max(50, Math.round(H / 1.0)));

  // Three.js CylinderGeometry: (radiusTop, radiusBottom, height, radialSegments, heightSegments)
  const cyl = new THREE.CylinderGeometry(R, R, H, radSegs, hSegs, false);
  // Z-up（3Dプリント標準）にするため X軸回りに 90度回転
  cyl.rotateX(Math.PI / 2);
  const nonIndexed = cyl.toNonIndexed();
  cyl.dispose();
  return nonIndexed;
}

/**
 * 高精細な正n角形柱（Regular n-gon Prism）ジオメトリを生成
 * 側面各面を縦横に細分化し、ディスプレイスメントや積層スライスが綺麗に適用できるようにする
 */
export function createNgonPrismGeometry({
  n = 6,
  radius = 40,
  height = 100,
} = {}) {
  const sides = Math.max(3, Math.round(Number(n) || 6));
  const R = Math.max(0.5, Number(radius) || 40);
  const H = Math.max(1, Number(height) || 100);

  const halfH = H * 0.5;
  const sideLength = 2 * R * Math.sin(Math.PI / sides);

  // 1面あたりの横分割数と縦分割数（約0.8〜1.0mmピッチ）
  const uSegs = Math.min(64, Math.max(4, Math.round(sideLength / 0.8)));
  const vSegs = Math.min(250, Math.max(20, Math.round(H / 1.0)));

  // 正n角形の底面/上面の各頂点 (XY平面)
  // 正面（Y負またはX正）に最初の面が綺麗に向くよう角度オフセットを調整
  const angleOffset = Math.PI / sides;
  const vertices2D = [];
  for (let i = 0; i <= sides; i++) {
    const angle = angleOffset + (i * 2 * Math.PI) / sides;
    vertices2D.push({
      x: R * Math.cos(angle),
      y: R * Math.sin(angle),
    });
  }

  const positions = [];
  const normals = [];
  const uvs = [];

  // ── 1. 側面パネル（n面）の生成 ──
  for (let i = 0; i < sides; i++) {
    const p0 = vertices2D[i];
    const p1 = vertices2D[i + 1];

    // 面の外向き法線ベクトル (XY平面上で辺に垂直)
    const edgeX = p1.x - p0.x;
    const edgeY = p1.y - p0.y;
    const nx = edgeY;
    const ny = -edgeX;
    const nLen = Math.hypot(nx, ny) || 1;
    const fnx = nx / nLen;
    const fny = ny / nLen;
    const fnz = 0;

    for (let v = 0; v < vSegs; v++) {
      const v0 = v / vSegs;
      const v1 = (v + 1) / vSegs;
      const z0 = -halfH + v0 * H;
      const z1 = -halfH + v1 * H;

      for (let u = 0; u < uSegs; u++) {
        const u0 = u / uSegs;
        const u1 = (u + 1) / uSegs;

        // 4頂点の座標
        const x00 = (1 - u0) * p0.x + u0 * p1.x;
        const y00 = (1 - u0) * p0.y + u0 * p1.y;

        const x10 = (1 - u1) * p0.x + u1 * p1.x;
        const y10 = (1 - u1) * p0.y + u1 * p1.y;

        const x01 = x00;
        const y01 = y00;

        const x11 = x10;
        const y11 = y10;

        // 全体外周におけるUV座標 (U: 0〜1, V: 0〜1)
        const globalU0 = (i + u0) / sides;
        const globalU1 = (i + u1) / sides;

        // 三角形 1: (u0, v0) -> (u1, v0) -> (u1, v1)
        positions.push(
          x00, y00, z0,
          x10, y10, z0,
          x11, y11, z1
        );
        normals.push(
          fnx, fny, fnz,
          fnx, fny, fnz,
          fnx, fny, fnz
        );
        uvs.push(
          globalU0, v0,
          globalU1, v0,
          globalU1, v1
        );

        // 三角形 2: (u0, v0) -> (u1, v1) -> (u0, v1)
        positions.push(
          x00, y00, z0,
          x11, y11, z1,
          x01, y01, z1
        );
        normals.push(
          fnx, fny, fnz,
          fnx, fny, fnz,
          fnx, fny, fnz
        );
        uvs.push(
          globalU0, v0,
          globalU1, v1,
          globalU0, v1
        );
      }
    }
  }

  // ── 2. 底面キャップ (Z = -halfH, 法線 0, 0, -1) ──
  // 中心と各辺の細分化頂点を結ぶ扇形
  for (let i = 0; i < sides; i++) {
    const p0 = vertices2D[i];
    const p1 = vertices2D[i + 1];

    for (let u = 0; u < uSegs; u++) {
      const u0 = u / uSegs;
      const u1 = (u + 1) / uSegs;

      const x0 = (1 - u0) * p0.x + u0 * p1.x;
      const y0 = (1 - u0) * p0.y + u0 * p1.y;
      const x1 = (1 - u1) * p0.x + u1 * p1.x;
      const y1 = (1 - u1) * p0.y + u1 * p1.y;

      // 底面は下向き法線 (時計回りで頂点配置)
      positions.push(
        0, 0, -halfH,
        x1, y1, -halfH,
        x0, y0, -halfH
      );
      normals.push(
        0, 0, -1,
        0, 0, -1,
        0, 0, -1
      );
      uvs.push(
        0.5, 0.5,
        0.5 + (x1 / (2 * R)), 0.5 + (y1 / (2 * R)),
        0.5 + (x0 / (2 * R)), 0.5 + (y0 / (2 * R))
      );
    }
  }

  // ── 3. 上面キャップ (Z = +halfH, 法線 0, 0, 1) ──
  for (let i = 0; i < sides; i++) {
    const p0 = vertices2D[i];
    const p1 = vertices2D[i + 1];

    for (let u = 0; u < uSegs; u++) {
      const u0 = u / uSegs;
      const u1 = (u + 1) / uSegs;

      const x0 = (1 - u0) * p0.x + u0 * p1.x;
      const y0 = (1 - u0) * p0.y + u0 * p1.y;
      const x1 = (1 - u1) * p0.x + u1 * p1.x;
      const y1 = (1 - u1) * p0.y + u1 * p1.y;

      // 上面は上向き法線 (反時計回りで頂点配置)
      positions.push(
        0, 0, halfH,
        x0, y0, halfH,
        x1, y1, halfH
      );
      normals.push(
        0, 0, 1,
        0, 0, 1,
        0, 0, 1
      );
      uvs.push(
        0.5, 0.5,
        0.5 + (x0 / (2 * R)), 0.5 + (y0 / (2 * R)),
        0.5 + (x1 / (2 * R)), 0.5 + (y1 / (2 * R))
      );
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));

  return geometry;
}

/**
 * 高精細なお椀（Bowl）ジオメトリを生成
 * 最大半径 R_outer, 高さ H_total にスケーリング追従するソリッドメッシュ
 */
export function createBowlGeometry({
  outerRadius = 40,
  height = 45,
  radialSegments = 128,
  heightSteps = 60,
} = {}) {
  const R_outer = Math.max(1, Number(outerRadius) || 40);
  const H_total = Math.max(1, Number(height) || 45);
  // 底面座面の半径（外径の約40%）
  const R_base = R_outer * 0.4375;

  const points = [];
  // 1. 底面中心 (0, 0)
  points.push(new THREE.Vector2(0, 0));
  // 2. 底面の平らな座面縁 (R_base, 0)
  points.push(new THREE.Vector2(R_base, 0));

  // 3. 外側カーブ: dr/dz = 1 - z/H_total
  // 底面 z=0 で45°傾斜、上縁 z=H_total で90°垂直へ立ち上がる
  const steps = Math.max(30, Math.round(Number(heightSteps) || 60));
  for (let i = 1; i <= steps; i++) {
    const z = (i / steps) * H_total;
    // 標準化されたカーブを R_base と (R_outer - R_base) に合わせてスケール
    const t = z / H_total; // 0 -> 1
    const curveShape = 2 * t - t * t; // 0 で傾き2(立ち上がり)、1で傾き0
    const r = R_base + (R_outer - R_base) * curveShape;
    points.push(new THREE.Vector2(r, z));
  }

  // 4. 上面: 水平フラットに中心まで閉じる (ソリッド化)
  const topSteps = 12;
  for (let i = 1; i <= topSteps; i++) {
    const t = i / topSteps;
    const r = R_outer * (1 - t);
    points.push(new THREE.Vector2(r, H_total));
  }

  const radSegs = Math.max(64, Math.round(Number(radialSegments) || 128));
  const lathe = new THREE.LatheGeometry(points, radSegs);
  lathe.rotateX(Math.PI / 2);
  lathe.center();
  const nonIndexed = lathe.toNonIndexed();
  lathe.dispose();
  return nonIndexed;
}

/**
 * 通常モード用キューブ (固定50×50×50 mm, 50分割)
 */
export function createCubeGeometry(size = 50, segments = 50) {
  const box = new THREE.BoxGeometry(size, size, size, segments, segments, segments);
  const nonIndexed = box.toNonIndexed();
  box.dispose();
  return nonIndexed;
}
