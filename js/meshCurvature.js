/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * BumpMesh_Color by @Mithril_MEX
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * meshCurvature.js — 3D Mesh Surface Curvature & Cavity Shading Engine
 *
 * Computes geometric mean curvature, crevice/cavity depth, and ridge highlights
 * directly from 3D triangle mesh topology without requiring UV unwrapping or external textures.
 * Used for automatic organic shading on complex models (e.g. human heads, sculptures, figurines).
 */

import { THREE } from './threeCompat.js';
import { QuantizedPointMap } from './meshIndex.js';

/**
 * Compute curvature and cavity shading scalar field across mesh vertices.
 *
 * @param {THREE.BufferGeometry} geometry - non-indexed triangle mesh
 * @param {object} options
 * @param {number} [options.scale=1.0] - contrast/sensitivity multiplier
 * @param {number} [options.bias=0.5] - baseline brightness for flat areas (0.0=black, 0.5=mid grey, 1.0=white)
 * @param {number} [options.smoothSteps=2] - number of smoothing diffusion passes to reduce mesh faceting noise
 * @param {boolean} [options.invert=false] - if true, ridges are dark and crevices are light
 * @param {number} [options.gamma=1.0] - gamma curve exponent (<1 brightens shadows, >1 deepens blacks)
 * @returns {{
 *   uniqueCount: number,
 *   uniqueCurvature: Float32Array, // raw signed curvature per unique vertex
 *   uniqueLuminance: Float32Array, // 0.0..1.0 brightness per unique vertex
 *   vertexLuminance: Float32Array, // 0.0..1.0 brightness per triangle vertex
 *   vertexToUnique: Int32Array,
 *   uniquePositions: Float32Array,
 *   uniqueNormals: Float32Array
 * }}
 */
export function computeMeshCurvatureShading(geometry, options = {}) {
  const scale = options.scale ?? 1.0;
  const bias = options.bias ?? 0.5;
  const smoothSteps = Math.max(0, Math.min(10, options.smoothSteps ?? 2));
  const invert = !!options.invert;
  const gamma = Math.max(0.1, Math.min(4.0, options.gamma ?? 1.0));

  const posAttr = geometry.attributes.position;
  const vertexCount = posAttr.count;
  const triCount = Math.floor(vertexCount / 3);

  // 1. Identify unique vertices using spatial quantization
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

  // 2. Compute area-weighted vertex normals from face normals
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

  // 4. Calculate initial raw curvature: L_u = (centroid of neighbors) - p_u
  // Signed mean curvature scalar: C_u = - (L_u . n_u)
  // Positive = Ridge (convex), Negative = Crevice/Cavity (concave)
  const rawCurvature = new Float32Array(uniqueCount);
  let maxAbsCurv = 1e-4;

  for (let u = 0; u < uniqueCount; u++) {
    const neighbors = Array.from(neighborSets[u]);
    if (neighbors.length === 0) {
      rawCurvature[u] = 0;
      continue;
    }

    const ux = uniquePositions[u * 3];
    const uy = uniquePositions[u * 3 + 1];
    const uz = uniquePositions[u * 3 + 2];
    const unx = uniqueNormals[u * 3];
    const uny = uniqueNormals[u * 3 + 1];
    const unz = uniqueNormals[u * 3 + 2];

    let cx = 0, cy = 0, cz = 0;
    let sumWeight = 0;

    for (let k = 0; k < neighbors.length; k++) {
      const v = neighbors[k];
      const vx = uniquePositions[v * 3];
      const vy = uniquePositions[v * 3 + 1];
      const vz = uniquePositions[v * 3 + 2];
      const d = Math.hypot(vx - ux, vy - uy, vz - uz);
      const w = 1.0 / Math.max(d, 1e-4);
      cx += vx * w;
      cy += vy * w;
      cz += vz * w;
      sumWeight += w;
    }

    if (sumWeight > 0) {
      cx /= sumWeight;
      cy /= sumWeight;
      cz /= sumWeight;
    }

    // Displacement from vertex to neighbor centroid
    const lx = cx - ux;
    const ly = cy - uy;
    const lz = cz - uz;

    // Projection along outward normal:
    // If vertex protrudes outwards (ridge), neighbor centroid is inward -> (L . n) < 0 -> curvature > 0
    // If vertex is in a cavity (crevice), neighbor centroid is outward -> (L . n) > 0 -> curvature < 0
    const c = - (lx * unx + ly * uny + lz * unz);
    rawCurvature[u] = c;
    if (Math.abs(c) > maxAbsCurv) {
      maxAbsCurv = Math.abs(c);
    }
  }

  // 5. Smoothing diffusion passes to eliminate discrete polygon facet noise
  let curBuffer = rawCurvature;
  if (smoothSteps > 0) {
    let nextBuffer = new Float32Array(uniqueCount);
    for (let step = 0; step < smoothSteps; step++) {
      for (let u = 0; u < uniqueCount; u++) {
        const neighbors = Array.from(neighborSets[u]);
        if (neighbors.length === 0) {
          nextBuffer[u] = curBuffer[u];
          continue;
        }
        let sum = curBuffer[u] * 2.0; // Self-weight
        let countW = 2.0;
        for (let k = 0; k < neighbors.length; k++) {
          sum += curBuffer[neighbors[k]];
          countW += 1.0;
        }
        nextBuffer[u] = sum / countW;
      }
      // Swap buffers
      const temp = curBuffer;
      curBuffer = nextBuffer;
      nextBuffer = temp;
    }
  }

  // Re-estimate robust range for normalization (using 98th percentile to avoid needle outliers)
  const absVals = new Float32Array(uniqueCount);
  for (let u = 0; u < uniqueCount; u++) {
    absVals[u] = Math.abs(curBuffer[u]);
  }
  absVals.sort();
  const percentile98 = absVals[Math.floor(uniqueCount * 0.98)] || maxAbsCurv;
  const normScale = percentile98 > 1e-6 ? (1.0 / percentile98) : 1.0;

  // 6. Map to normalized luminance (0.0 to 1.0)
  const uniqueLuminance = new Float32Array(uniqueCount);
  for (let u = 0; u < uniqueCount; u++) {
    // Normalised signed curvature [-1.0 .. +1.0]
    let normalized = curBuffer[u] * normScale * scale;
    // Clamp to [-1.0, 1.0]
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

    // Apply gamma curve
    if (Math.abs(gamma - 1.0) > 1e-3) {
      lum = Math.pow(Math.max(0.0, Math.min(1.0, lum)), gamma);
    }

    uniqueLuminance[u] = Math.max(0.0, Math.min(1.0, lum));
  }

  // 7. Expand to per-triangle vertices for direct rendering and displacement consumption
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
