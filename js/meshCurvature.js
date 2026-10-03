/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * BumpMesh_Color by @Mithril_MEX
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * meshCurvature.js — 3D Mesh Surface Multi-scale Geometric Cavity & Curvature Shading Engine
 *
 * Computes geometric cavity (crevices, depressions, eye sockets, nostrils) and ridge highlights
 * using multi-scale geodesic/spherical neighborhood evaluation directly from 3D triangle mesh topology.
 * Independent of local triangle tessellation or UV unwrapping.
 * Used for automatic organic shading on complex models (e.g. Suzanne monkey head, statues, figurines).
 */

import { THREE } from './threeCompat.js';
import { QuantizedPointMap } from './meshIndex.js';

/**
 * Compute multi-scale cavity and curvature shading scalar field across mesh vertices.
 *
 * @param {THREE.BufferGeometry} geometry - non-indexed triangle mesh
 * @param {object} options
 * @param {number} [options.radius=3.5] - evaluation radius in mm (determines scale of feature detection)
 * @param {number} [options.scale=1.0] - contrast multiplier
 * @param {number} [options.bias=0.5] - baseline brightness for flat areas (0.0=black, 0.5=mid grey, 1.0=white)
 * @param {number} [options.smoothSteps=2] - number of smoothing diffusion passes to reduce noise
 * @param {boolean} [options.invert=false] - if true, ridges are dark and crevices are light
 * @param {number} [options.gamma=1.0] - gamma curve exponent (<1 brightens shadows, >1 deepens blacks)
 * @returns {{
 *   uniqueCount: number,
 *   uniqueCurvature: Float32Array, // raw signed cavity score per unique vertex (-1..+1)
 *   uniqueLuminance: Float32Array, // 0.0..1.0 brightness per unique vertex
 *   vertexLuminance: Float32Array, // 0.0..1.0 brightness per triangle vertex
 *   vertexToUnique: Int32Array,
 *   uniquePositions: Float32Array,
 *   uniqueNormals: Float32Array
 * }}
 */
export function computeMeshCurvatureShading(geometry, options = {}) {
  const R = Math.max(0.2, options.radius ?? 3.5);
  const scale = options.scale ?? 1.0;
  const bias = options.bias ?? 0.5;
  const smoothSteps = Math.max(0, Math.min(10, options.smoothSteps ?? 2));
  const invert = !!options.invert;
  const gamma = Math.max(0.1, Math.min(4.0, options.gamma ?? 1.0));

  const posAttr = geometry.attributes.position;
  const vertexCount = posAttr.count;
  const triCount = Math.floor(vertexCount / 3);

  // 1. Quantize and identify unique vertices
  const qmap = new QuantizedPointMap(1e4);
  const vertexToUnique = new Int32Array(vertexCount);
  const uniquePositionsList = [];

  let uniqueCount = 0;
  for (let i = 0; i < vertexCount; i++) {
    const x = posAttr.getX(i);
    const y = posAttr.getY(i);
    const z = posAttr.getZ(i);

    const uIdx = qmap.getOrSet(x, y, z, uniqueCount);
    if (qmap.inserted) {
      uniqueCount++;
      uniquePositionsList.push(x, y, z);
    }
    vertexToUnique[i] = uIdx;
  }

  const uniquePositions = new Float32Array(uniquePositionsList);
  const uniqueNormals = new Float32Array(uniqueCount * 3);

  // 2. Compute area-weighted vertex normals
  for (let t = 0; t < triCount; t++) {
    const i0 = vertexToUnique[t * 3];
    const i1 = vertexToUnique[t * 3 + 1];
    const i2 = vertexToUnique[t * 3 + 2];

    const x0 = uniquePositions[i0 * 3], y0 = uniquePositions[i0 * 3 + 1], z0 = uniquePositions[i0 * 3 + 2];
    const x1 = uniquePositions[i1 * 3], y1 = uniquePositions[i1 * 3 + 1], z1 = uniquePositions[i1 * 3 + 2];
    const x2 = uniquePositions[i2 * 3], y2 = uniquePositions[i2 * 3 + 1], z2 = uniquePositions[i2 * 3 + 2];

    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
    const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
    const nx = ay * bz - az * by;
    const ny = az * bx - ax * bz;
    const nz = ax * by - ay * bx;

    uniqueNormals[i0 * 3] += nx; uniqueNormals[i0 * 3 + 1] += ny; uniqueNormals[i0 * 3 + 2] += nz;
    uniqueNormals[i1 * 3] += nx; uniqueNormals[i1 * 3 + 1] += ny; uniqueNormals[i1 * 3 + 2] += nz;
    uniqueNormals[i2 * 3] += nx; uniqueNormals[i2 * 3 + 1] += ny; uniqueNormals[i2 * 3 + 2] += nz;
  }

  // Normalize vertex normals
  for (let u = 0; u < uniqueCount; u++) {
    const nx = uniqueNormals[u * 3];
    const ny = uniqueNormals[u * 3 + 1];
    const nz = uniqueNormals[u * 3 + 2];
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-6) {
      uniqueNormals[u * 3] = nx / len;
      uniqueNormals[u * 3 + 1] = ny / len;
      uniqueNormals[u * 3 + 2] = nz / len;
    } else {
      uniqueNormals[u * 3] = 0;
      uniqueNormals[u * 3 + 1] = 0;
      uniqueNormals[u * 3 + 2] = 1;
    }
  }

  // 3. Build adjacency neighbor lists
  const neighborSets = Array.from({ length: uniqueCount }, () => new Set());
  for (let t = 0; t < triCount; t++) {
    const i0 = vertexToUnique[t * 3];
    const i1 = vertexToUnique[t * 3 + 1];
    const i2 = vertexToUnique[t * 3 + 2];
    if (i0 !== i1) { neighborSets[i0].add(i1); neighborSets[i1].add(i0); }
    if (i1 !== i2) { neighborSets[i1].add(i2); neighborSets[i2].add(i1); }
    if (i2 !== i0) { neighborSets[i2].add(i0); neighborSets[i0].add(i2); }
  }
  const adj = neighborSets.map(s => Array.from(s));

  // 4. Multi-scale Geometric Cavity & Ridge Evaluation
  // Evaluates the relative height/projection of surface points within geodesic radius R
  // Crevices: neighbors lie in front of vertex normal (h > 0) -> cavity score < 0 (dark)
  // Ridges: neighbors lie behind vertex normal (h < 0) -> cavity score > 0 (bright)
  // Flat surfaces: h approx 0 -> neutral
  const rawCurvature = new Float32Array(uniqueCount);
  const visitedTag = new Int32Array(uniqueCount);
  let visitToken = 0;
  const queue = new Int32Array(Math.min(10000, uniqueCount + 10));

  let maxAbsCurv = 1e-4;

  for (let u = 0; u < uniqueCount; u++) {
    const ux = uniquePositions[u * 3];
    const uy = uniquePositions[u * 3 + 1];
    const uz = uniquePositions[u * 3 + 2];
    const unx = uniqueNormals[u * 3];
    const uny = uniqueNormals[u * 3 + 1];
    const unz = uniqueNormals[u * 3 + 2];

    visitToken++;
    visitedTag[u] = visitToken;

    let qHead = 0;
    let qTail = 0;
    queue[qTail++] = u;

    let sumScore = 0;
    let sumWeight = 0;

    while (qHead < qTail && qTail < queue.length - 20) {
      const curr = queue[qHead++];
      const nbrs = adj[curr];
      for (let k = 0; k < nbrs.length; k++) {
        const v = nbrs[k];
        if (visitedTag[v] === visitToken) continue;
        visitedTag[v] = visitToken;

        const vx = uniquePositions[v * 3];
        const vy = uniquePositions[v * 3 + 1];
        const vz = uniquePositions[v * 3 + 2];

        const dx = vx - ux;
        const dy = vy - uy;
        const dz = vz - uz;
        const dist = Math.hypot(dx, dy, dz);

        if (dist <= R) {
          queue[qTail++] = v;

          // Projection along vertex normal
          const h = dx * unx + dy * uny + dz * unz;
          // Weight with linear falloff
          const w = (1.0 - dist / R);

          // Normal direction alignment weight:
          // If neighbor's normal faces inward relative to u, cavity is confirmed
          const vnx = uniqueNormals[v * 3];
          const vny = uniqueNormals[v * 3 + 1];
          const vnz = uniqueNormals[v * 3 + 2];
          const normalAlignment = unx * vnx + uny * vny + unz * vnz;

          // Scale score: negative for crevices/cavities, positive for ridges
          const s = (-h / R) * (1.2 - 0.2 * normalAlignment);
          sumScore += s * w;
          sumWeight += w;
        }
      }
    }

    const c = sumWeight > 0 ? (sumScore / sumWeight) : 0;
    rawCurvature[u] = c;
    if (Math.abs(c) > maxAbsCurv) {
      maxAbsCurv = Math.abs(c);
    }
  }

  // 5. Smoothing diffusion passes to eliminate mesh faceting noise
  let curBuffer = rawCurvature;
  if (smoothSteps > 0) {
    let nextBuffer = new Float32Array(uniqueCount);
    for (let step = 0; step < smoothSteps; step++) {
      for (let u = 0; u < uniqueCount; u++) {
        const nbrs = adj[u];
        if (nbrs.length === 0) {
          nextBuffer[u] = curBuffer[u];
          continue;
        }
        let sum = curBuffer[u] * 2.0;
        let countW = 2.0;
        for (let k = 0; k < nbrs.length; k++) {
          sum += curBuffer[nbrs[k]];
          countW += 1.0;
        }
        nextBuffer[u] = sum / countW;
      }
      const temp = curBuffer;
      curBuffer = nextBuffer;
      nextBuffer = temp;
    }
  }

  // 6. Robust normalization using 98th percentile
  const absVals = new Float32Array(uniqueCount);
  for (let u = 0; u < uniqueCount; u++) {
    absVals[u] = Math.abs(curBuffer[u]);
  }
  absVals.sort();
  const percentile98 = absVals[Math.floor(uniqueCount * 0.98)] || maxAbsCurv;
  const normScale = percentile98 > 1e-5 ? (1.0 / percentile98) : 1.0;

  // 7. Map to normalized luminance (0.0 to 1.0)
  const uniqueLuminance = new Float32Array(uniqueCount);
  for (let u = 0; u < uniqueCount; u++) {
    // Normalised signed cavity [-1.0 .. +1.0]
    let normalized = curBuffer[u] * normScale * scale;
    normalized = Math.max(-1.0, Math.min(1.0, normalized));

    // Map: -1 (crevice) -> 0.0 (dark), 0 (flat) -> bias (e.g. 0.5), +1 (ridge) -> 1.0 (light)
    let lum;
    if (normalized >= 0) {
      lum = bias + normalized * (1.0 - bias);
    } else {
      lum = bias + normalized * bias;
    }

    if (invert) {
      lum = 1.0 - lum;
    }

    if (Math.abs(gamma - 1.0) > 1e-3) {
      lum = Math.pow(Math.max(0.0, Math.min(1.0, lum)), gamma);
    }

    uniqueLuminance[u] = Math.max(0.0, Math.min(1.0, lum));
  }

  // 8. Expand to per-triangle vertices
  const vertexLuminance = new Float32Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    const u = vertexToUnique[i];
    vertexLuminance[i] = uniqueLuminance[u];
  }

  return {
    uniqueCount,
    uniqueCurvature: curBuffer,
    uniqueLuminance,
    vertexLuminance,
    vertexToUnique,
    uniquePositions,
    uniqueNormals
  };
}
