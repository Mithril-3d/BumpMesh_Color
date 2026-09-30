/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * BumpMesh_Color by @Mithril_MEX
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * meshTuring.js — 3D Mesh Surface Reaction-Diffusion Simulator (Turing Pattern)
 *
 * Implements Gray-Scott reaction-diffusion directly on a 3D triangle mesh surface
 * graph using discrete Laplace-Beltrami operators with inverse-distance weighting.
 * No UV unwrapping or parameterization required.
 */

import { THREE } from './threeCompat.js';
import { QuantizedPointMap } from './meshIndex.js';

export const TURING_PRESETS = {
  maze: {
    id: 'maze',
    name: 'Maze / Brain (迷路・脳皺)',
    feed: 0.030,
    kill: 0.062,
    diffU: 0.20,
    diffV: 0.10,
    dt: 1.0,
    subSteps: 8,
    defaultHeight: 1.5,
  },
  coral: {
    id: 'coral',
    name: 'Coral / Fingerprint (サンゴ・指紋)',
    feed: 0.054,
    kill: 0.062,
    diffU: 0.20,
    diffV: 0.10,
    dt: 1.0,
    subSteps: 8,
    defaultHeight: 1.5,
  },
  spots: {
    id: 'spots',
    name: 'Spots / Leopard (ヒョウ柄・水玉)',
    feed: 0.034,
    kill: 0.063,
    diffU: 0.20,
    diffV: 0.10,
    dt: 1.0,
    subSteps: 8,
    defaultHeight: 1.2,
  },
  waves: {
    id: 'waves',
    name: 'Waves / Solitons (波紋・パルス)',
    feed: 0.014,
    kill: 0.047,
    diffU: 0.20,
    diffV: 0.10,
    dt: 1.0,
    subSteps: 8,
    defaultHeight: 1.5,
  },
  spirals: {
    id: 'spirals',
    name: 'Spirals / Organics (渦巻・有機)',
    feed: 0.018,
    kill: 0.051,
    diffU: 0.20,
    diffV: 0.10,
    dt: 1.0,
    subSteps: 8,
    defaultHeight: 1.5,
  },
};

/**
 * Builds an adjacency graph and discrete Cotangent Laplace-Beltrami weights on unique mesh vertices.
 *
 * The cotangent formulation calculates w_ij = 0.5 * (cot(alpha) + cot(beta)), normalized by
 * each vertex's barycentric dual area. This guarantees isotropic diffusion even on highly
 * irregular, anisotropic, or diagonal-biased meshes (e.g. cylinders, organic surfaces).
 *
 * @param {THREE.BufferGeometry} geometry - non-indexed triangle mesh
 * @returns {object} Graph structure with flattened neighbor lookups and cotangent weights
 */
export function buildMeshGraph(geometry) {
  const posAttr = geometry.attributes.position;
  const vertexCount = posAttr.count;
  const triCount = Math.floor(vertexCount / 3);

  const qmap = new QuantizedPointMap(1e4);
  const vertexToUnique = new Int32Array(vertexCount);
  const uniquePositionsList = [];

  // 1. Identify unique vertices
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

  // 1b. Compute robust vertex normals by accumulating face normals
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

  // Normalize vertex normals safely
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

  // 2. Accumulate Cotangent weights and Barycentric dual areas
  // For each edge (i, j) with opposite vertex k:
  // cot(theta) = (u . v) / |u x v| where u = p_i - p_k, v = p_j - p_k
  const edgeMap = new Map();
  function addCotanWeight(i, j, k) {
    if (i === j) return;
    const xi = uniquePositions[i * 3], yi = uniquePositions[i * 3 + 1], zi = uniquePositions[i * 3 + 2];
    const xj = uniquePositions[j * 3], yj = uniquePositions[j * 3 + 1], zj = uniquePositions[j * 3 + 2];
    const xk = uniquePositions[k * 3], yk = uniquePositions[k * 3 + 1], zk = uniquePositions[k * 3 + 2];

    const u1 = xi - xk, u2 = yi - yk, u3 = zi - zk;
    const v1 = xj - xk, v2 = yj - yk, v3 = zj - zk;

    const dot = u1 * v1 + u2 * v2 + u3 * v3;
    const cx = u2 * v3 - u3 * v2;
    const cy = u3 * v1 - u1 * v3;
    const cz = u1 * v2 - u2 * v1;
    const crossNorm = Math.hypot(cx, cy, cz);

    if (crossNorm < 1e-8) return;
    const cot = dot / crossNorm;

    const u = Math.min(i, j);
    const v = Math.max(i, j);
    const key = `${u}_${v}`;
    edgeMap.set(key, (edgeMap.get(key) || 0) + cot * 0.5);
  }

  const dualAreas = new Float32Array(uniqueCount);

  for (let t = 0; t < triCount; t++) {
    const i0 = vertexToUnique[t * 3];
    const i1 = vertexToUnique[t * 3 + 1];
    const i2 = vertexToUnique[t * 3 + 2];

    addCotanWeight(i0, i1, i2);
    addCotanWeight(i1, i2, i0);
    addCotanWeight(i2, i0, i1);

    const x0 = uniquePositions[i0 * 3], y0 = uniquePositions[i0 * 3 + 1], z0 = uniquePositions[i0 * 3 + 2];
    const x1 = uniquePositions[i1 * 3], y1 = uniquePositions[i1 * 3 + 1], z1 = uniquePositions[i1 * 3 + 2];
    const x2 = uniquePositions[i2 * 3], y2 = uniquePositions[i2 * 3 + 1], z2 = uniquePositions[i2 * 3 + 2];

    const ax = x1 - x0, ay = y1 - y0, az = z1 - z0;
    const bx = x2 - x0, by = y2 - y0, bz = z2 - z0;
    const area = 0.5 * Math.hypot(ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx);

    dualAreas[i0] += area / 3.0;
    dualAreas[i1] += area / 3.0;
    dualAreas[i2] += area / 3.0;
  }

  // 3. Build Adjacency and compute calibrated Cotangent Laplace weights
  const adj = Array.from({ length: uniqueCount }, () => []);
  for (const [key, cot] of edgeMap.entries()) {
    const sepIdx = key.indexOf('_');
    const u = parseInt(key.slice(0, sepIdx), 10);
    const v = parseInt(key.slice(sepIdx + 1), 10);
    // Non-negative cotangent weights for numerical monotonicity & stability
    const w = Math.max(0, cot);
    adj[u].push({ neighbor: v, weight: w });
    adj[v].push({ neighbor: u, weight: w });
  }

  const neighborOffsets = new Uint32Array(uniqueCount + 1);
  let totalEdges = 0;
  for (let u = 0; u < uniqueCount; u++) {
    neighborOffsets[u] = totalEdges;
    totalEdges += adj[u].length;
  }
  neighborOffsets[uniqueCount] = totalEdges;

  const neighborIndices = new Uint32Array(totalEdges);
  const neighborWeights = new Float32Array(totalEdges);

  let sumArea = 0;
  for (let u = 0; u < uniqueCount; u++) sumArea += dualAreas[u];
  const avgArea = uniqueCount > 0 ? sumArea / uniqueCount : 1.0;

  for (let u = 0; u < uniqueCount; u++) {
    const offset = neighborOffsets[u];
    const area = Math.max(dualAreas[u], 1e-6);
    // Scale by avgArea so standard Gray-Scott constants (Du=0.20, Dv=0.10) remain calibrated
    const areaScale = avgArea / area;

    for (let k = 0; k < adj[u].length; k++) {
      neighborIndices[offset + k] = adj[u][k].neighbor;
      neighborWeights[offset + k] = adj[u][k].weight * areaScale;
    }
  }

  return {
    uniqueCount,
    vertexCount,
    vertexToUnique,
    uniquePositions,
    uniqueNormals,
    neighborOffsets,
    neighborIndices,
    neighborWeights,
  };
}

/**
 * 3D Mesh Surface Reaction-Diffusion Simulator.
 */
export class MeshTuringSimulator {
  constructor(graph, options = {}) {
    this.graph = graph;
    this.uniqueCount = graph.uniqueCount;

    // Concentrations
    this.u = new Float32Array(this.uniqueCount).fill(1.0);
    this.v = new Float32Array(this.uniqueCount).fill(0.0);
    this.uNext = new Float32Array(this.uniqueCount);
    this.vNext = new Float32Array(this.uniqueCount);

    // Default params (Maze)
    this.setPreset('maze');

    // Override with custom options if provided
    if (options.feed != null) this.feed = options.feed;
    if (options.kill != null) this.kill = options.kill;
    if (options.diffU != null) this.diffU = options.diffU;
    if (options.diffV != null) this.diffV = options.diffV;
    if (options.dt != null) this.dt = options.dt;
    if (options.subSteps != null) this.subSteps = options.subSteps;
    if (options.height != null) this.height = options.height;

    this.stepCount = 0;
    this.excludedMask = null; // Uint8Array(uniqueCount), 1 = excluded
  }

  setExcludedVertices(mask) {
    this.excludedMask = mask;
    // Clear chemical concentrations on excluded vertices immediately
    if (mask) {
      for (let i = 0; i < this.uniqueCount; i++) {
        if (mask[i]) {
          this.u[i] = 1.0;
          this.v[i] = 0.0;
        }
      }
    }
  }

  setPreset(presetId) {
    const p = TURING_PRESETS[presetId] ?? TURING_PRESETS.maze;
    this.presetId = presetId;
    this.feed = p.feed;
    this.kill = p.kill;
    this.diffU = p.diffU;
    this.diffV = p.diffV;
    this.dt = p.dt;
    this.subSteps = p.subSteps;
    this.height = p.defaultHeight;
  }

  reset() {
    this.u.fill(1.0);
    this.v.fill(0.0);
    this.stepCount = 0;
  }

  /**
   * Injects seed chemical V at a specified 3D world position within a radius.
   * Excluded vertices are never seeded.
   */
  seedAtPoint(targetPoint, radius = 5.0, amount = 1.0) {
    const { uniquePositions, uniqueCount } = this.graph;
    const tx = targetPoint.x;
    const ty = targetPoint.y;
    const tz = targetPoint.z;
    const rSq = radius * radius;
    const mask = this.excludedMask;

    let affected = 0;
    for (let u = 0; u < uniqueCount; u++) {
      if (mask && mask[u]) continue;

      const dx = uniquePositions[u * 3] - tx;
      const dy = uniquePositions[u * 3 + 1] - ty;
      const dz = uniquePositions[u * 3 + 2] - tz;
      const distSq = dx * dx + dy * dy + dz * dz;

      if (distSq <= rSq) {
        const falloff = 1.0 - Math.sqrt(distSq) / radius;
        const addV = amount * falloff;
        this.v[u] = Math.min(1.0, this.v[u] + addV);
        this.u[u] = Math.max(0.0, this.u[u] - addV);
        affected++;
      }
    }
    return affected;
  }

  /**
   * Injects random seeds across the non-excluded surface.
   */
  seedRandom(count = 5, radius = 4.0) {
    const { uniquePositions, uniqueCount } = this.graph;
    if (uniqueCount === 0) return;
    const mask = this.excludedMask;

    let attempts = 0;
    let seeded = 0;
    while (seeded < count && attempts < count * 20) {
      attempts++;
      const randomIdx = Math.floor(Math.random() * uniqueCount);
      if (mask && mask[randomIdx]) continue;

      const pt = {
        x: uniquePositions[randomIdx * 3],
        y: uniquePositions[randomIdx * 3 + 1],
        z: uniquePositions[randomIdx * 3 + 2],
      };
      const hit = this.seedAtPoint(pt, radius, 1.0);
      if (hit > 0) seeded++;
    }
  }

  /**
   * Advances the simulation by `subSteps` using the Gray-Scott system.
   * Excluded vertices remain clamped at V = 0, U = 1.
   */
  step(subSteps = this.subSteps) {
    const { uniqueCount, neighborOffsets, neighborIndices, neighborWeights } = this.graph;
    const dt = this.dt;
    const diffU = this.diffU;
    const diffV = this.diffV;
    const F = this.feed;
    const k = this.kill;
    const mask = this.excludedMask;

    let curU = this.u;
    let curV = this.v;
    let nxtU = this.uNext;
    let nxtV = this.vNext;

    for (let s = 0; s < subSteps; s++) {
      for (let i = 0; i < uniqueCount; i++) {
        if (mask && mask[i]) {
          nxtU[i] = 1.0;
          nxtV[i] = 0.0;
          continue;
        }

        let lapU = 0.0;
        let lapV = 0.0;

        const start = neighborOffsets[i];
        const end = neighborOffsets[i + 1];
        const ui = curU[i];
        const vi = curV[i];

        for (let idx = start; idx < end; idx++) {
          const j = neighborIndices[idx];
          const w = neighborWeights[idx];
          lapU += w * (curU[j] - ui);
          lapV += w * (curV[j] - vi);
        }

        const uvv = ui * vi * vi;
        const du = diffU * lapU - uvv + F * (1.0 - ui);
        const dv = diffV * lapV + uvv - (F + k) * vi;

        const valU = ui + dt * du;
        const valV = vi + dt * dv;

        nxtU[i] = valU < 0.0 ? 0.0 : (valU > 1.0 ? 1.0 : valU);
        nxtV[i] = valV < 0.0 ? 0.0 : (valV > 1.0 ? 1.0 : valV);
      }

      // Swap buffers
      const tmpU = curU; curU = nxtU; nxtU = tmpU;
      const tmpV = curV; curV = nxtV; nxtV = tmpV;
      this.stepCount++;
    }

    this.u = curU;
    this.v = curV;
    this.uNext = nxtU;
    this.vNext = nxtV;
  }

  /**
   * Copies current V concentration to geometry vertex colors for preview.
   *
   * @param {THREE.BufferAttribute} colorAttr - RGB Float32 BufferAttribute
   */
  updateVertexColors(colorAttr) {
    const { vertexCount, vertexToUnique } = this.graph;
    const v = this.v;
    const arr = colorAttr.array;

    for (let i = 0; i < vertexCount; i++) {
      const uIdx = vertexToUnique[i];
      const val = v[uIdx];

      // Organic gold/coral highlight or monochrome grayscale
      // val = 0: dark slate/blue; val = 1: bright gold/cream
      const r = 0.15 + val * 0.85;
      const g = 0.18 + val * 0.72;
      const b = 0.25 + val * 0.35;

      const idx = i * 3;
      arr[idx] = r;
      arr[idx + 1] = g;
      arr[idx + 2] = b;
    }
    colorAttr.needsUpdate = true;
  }

  /**
   * Displaces vertices along their normal based on V concentration.
   *
   * @param {Float32Array} basePositions - original undisplaced positions
   * @param {THREE.BufferAttribute} posAttr - live position attribute to write to
   * @param {number} height - displacement magnitude in mm
   */
  updateDisplacement(basePositions, posAttr, height = this.height) {
    const { vertexCount, vertexToUnique, uniqueNormals } = this.graph;
    const v = this.v;
    const arr = posAttr.array;

    for (let i = 0; i < vertexCount; i++) {
      const uIdx = vertexToUnique[i];
      const val = v[uIdx];
      const disp = val * height;

      const i3 = i * 3;
      const u3 = uIdx * 3;
      const nx = uniqueNormals[u3];
      const ny = uniqueNormals[u3 + 1];
      const nz = uniqueNormals[u3 + 2];

      arr[i3] = basePositions[i3] + nx * disp;
      arr[i3 + 1] = basePositions[i3 + 1] + ny * disp;
      arr[i3 + 2] = basePositions[i3 + 2] + nz * disp;
    }
    posAttr.needsUpdate = true;
  }

  /**
   * Creates a new BufferGeometry with the final displaced positions and recalculates normals.
   */
  createDisplacedGeometry(baseGeometry, height = this.height) {
    const geo = baseGeometry.clone();
    const posAttr = geo.attributes.position;
    const baseArr = baseGeometry.attributes.position.array;

    this.updateDisplacement(baseArr, posAttr, height);
    geo.computeVertexNormals();
    return geo;
  }
}
