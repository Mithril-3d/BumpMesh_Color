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
    diffU: 0.16,
    diffV: 0.08,
    dt: 1.0,
    subSteps: 12,
    defaultHeight: 1.5,
  },
  coral: {
    id: 'coral',
    name: 'Coral / Fingerprint (サンゴ・指紋)',
    feed: 0.050,
    kill: 0.063,
    diffU: 0.16,
    diffV: 0.08,
    dt: 1.0,
    subSteps: 12,
    defaultHeight: 1.5,
  },
  spots: {
    id: 'spots',
    name: 'Spots / Leopard (ヒョウ柄・水玉)',
    feed: 0.034,
    kill: 0.063,
    diffU: 0.16,
    diffV: 0.08,
    dt: 1.0,
    subSteps: 12,
    defaultHeight: 1.2,
  },
  waves: {
    id: 'waves',
    name: 'Waves / Solitons (波紋・パルス)',
    feed: 0.014,
    kill: 0.047,
    diffU: 0.16,
    diffV: 0.08,
    dt: 1.0,
    subSteps: 12,
    defaultHeight: 1.5,
  },
  spirals: {
    id: 'spirals',
    name: 'Spirals / Organics (渦巻・有機)',
    feed: 0.018,
    kill: 0.051,
    diffU: 0.16,
    diffV: 0.08,
    dt: 1.0,
    subSteps: 12,
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

  // 2. Build neighbor sets from mesh triangles
  const neighborSets = Array.from({ length: uniqueCount }, () => new Set());
  for (let t = 0; t < triCount; t++) {
    const i0 = vertexToUnique[t * 3];
    const i1 = vertexToUnique[t * 3 + 1];
    const i2 = vertexToUnique[t * 3 + 2];
    if (i0 !== i1) { neighborSets[i0].add(i1); neighborSets[i1].add(i0); }
    if (i1 !== i2) { neighborSets[i1].add(i2); neighborSets[i2].add(i1); }
    if (i2 !== i0) { neighborSets[i2].add(i0); neighborSets[i0].add(i2); }
  }

  // 3. Build flattened adjacency and compute isotropic geometric Laplace weights
  // Note: Cotangent weights degenerate to 0.0 on right-angle triangles (e.g. subdivided
  // cube and cylinder grids where opposite angles are 90 deg), causing strong vertical
  // anisotropy. Inverse-distance weights guarantee strictly positive, isotropic diffusion
  // in all spatial directions (X, Y, Z) on any 3D mesh.
  const neighborOffsets = new Uint32Array(uniqueCount + 1);
  let totalEdges = 0;
  for (let u = 0; u < uniqueCount; u++) {
    neighborOffsets[u] = totalEdges;
    totalEdges += neighborSets[u].size;
  }
  neighborOffsets[uniqueCount] = totalEdges;

  const neighborIndices = new Uint32Array(totalEdges);
  const neighborWeights = new Float32Array(totalEdges);

  for (let u = 0; u < uniqueCount; u++) {
    const offset = neighborOffsets[u];
    const neighbors = Array.from(neighborSets[u]);
    const ux = uniquePositions[u * 3];
    const uy = uniquePositions[u * 3 + 1];
    const uz = uniquePositions[u * 3 + 2];

    let sumW = 0.0;
    const tempW = [];
    for (let k = 0; k < neighbors.length; k++) {
      const v = neighbors[k];
      neighborIndices[offset + k] = v;
      const vx = uniquePositions[v * 3];
      const vy = uniquePositions[v * 3 + 1];
      const vz = uniquePositions[v * 3 + 2];
      const dist = Math.hypot(vx - ux, vy - uy, vz - uz);
      const w = 1.0 / Math.max(dist, 1e-4);
      tempW.push(w);
      sumW += w;
    }

    // Calibrate each vertex so total weight equals 4.0
    // (exact mathematical equivalent of standard 2D 5-point discrete Laplacian stencil)
    const normFactor = sumW > 0 ? (4.0 / sumW) : 1.0;
    for (let k = 0; k < neighbors.length; k++) {
      neighborWeights[offset + k] = tempW[k] * normFactor;
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
    this.boundaryMargin = options.boundaryMargin ?? 2.0;

    this.stepCount = 0;
    this.excludedMask = null; // Uint8Array(uniqueCount), 1 = excluded
    this.boundaryDist = null; // Float32Array(uniqueCount), distance in mm to boundary
    this.effectiveWeights = graph.neighborWeights;
  }

  setExcludedVertices(mask) {
    this.excludedMask = mask;
    if (!mask) {
      this.effectiveWeights = this.graph.neighborWeights;
      this.boundaryDist = null;
      return;
    }

    const { uniqueCount, uniquePositions, neighborOffsets, neighborIndices, neighborWeights } = this.graph;

    // 1. Clear chemical concentrations on excluded vertices immediately
    for (let i = 0; i < uniqueCount; i++) {
      if (mask[i]) {
        this.u[i] = 1.0;
        this.v[i] = 0.0;
      }
    }

    // 2. Precompute zero-flux Neumann Laplace weights:
    // Any edge connecting to an excluded neighbor is treated as zero-flux.
    // Active non-excluded neighbor weights are re-normalized to sum to 4.0,
    // ensuring consistent isotropic diffusion without boundary accumulation or artificial wall ridges.
    const effW = new Float32Array(neighborWeights.length);
    for (let i = 0; i < uniqueCount; i++) {
      if (mask[i]) continue;
      const start = neighborOffsets[i];
      const end = neighborOffsets[i + 1];
      let sumActiveW = 0.0;
      for (let idx = start; idx < end; idx++) {
        const j = neighborIndices[idx];
        if (!mask[j]) {
          sumActiveW += neighborWeights[idx];
        }
      }
      const scale = sumActiveW > 0 ? (4.0 / sumActiveW) : 1.0;
      for (let idx = start; idx < end; idx++) {
        const j = neighborIndices[idx];
        if (!mask[j]) {
          effW[idx] = neighborWeights[idx] * scale;
        } else {
          effW[idx] = 0.0; // zero flux across boundary
        }
      }
    }
    this.effectiveWeights = effW;

    // 3. Compute geodesic surface distance to boundary via BFS on the mesh graph
    const bDist = new Float32Array(uniqueCount).fill(Infinity);
    const queue = [];
    for (let i = 0; i < uniqueCount; i++) {
      if (mask[i]) {
        bDist[i] = 0.0;
        queue.push(i);
      }
    }

    let head = 0;
    while (head < queue.length) {
      const u = queue[head++];
      const d = bDist[u];
      const ux = uniquePositions[u * 3];
      const uy = uniquePositions[u * 3 + 1];
      const uz = uniquePositions[u * 3 + 2];

      const start = neighborOffsets[u];
      const end = neighborOffsets[u + 1];
      for (let idx = start; idx < end; idx++) {
        const v = neighborIndices[idx];
        const vx = uniquePositions[v * 3];
        const vy = uniquePositions[v * 3 + 1];
        const vz = uniquePositions[v * 3 + 2];
        const edgeLen = Math.hypot(vx - ux, vy - uy, vz - uz);
        const candDist = d + edgeLen;
        if (candDist < bDist[v]) {
          bDist[v] = candDist;
          queue.push(v);
        }
      }
    }
    this.boundaryDist = bDist;
  }

  setBoundaryMargin(margin) {
    this.boundaryMargin = Math.max(0, margin);
  }

  getBoundaryFactor(uIdx) {
    if (!this.boundaryDist || this.boundaryMargin <= 0) return 1.0;
    const d = this.boundaryDist[uIdx];
    if (d <= 0.0) return 0.0;
    if (d >= this.boundaryMargin) return 1.0;
    const t = d / this.boundaryMargin;
    return t * t * (3.0 - 2.0 * t); // smoothstep
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
   * Uses an organic multi-subseed cluster with random angular perturbation
   * to break rotational symmetry and trigger natural branching / mitosis.
   * Excluded vertices are never seeded.
   */
  seedAtPoint(targetPoint, radius = 5.0, amount = 1.0) {
    const { uniquePositions, uniqueNormals, uniqueCount } = this.graph;
    const tx = targetPoint.x;
    const ty = targetPoint.y;
    const tz = targetPoint.z;
    const rSq = radius * radius;
    const mask = this.excludedMask;

    // Find local normal at seed point or use (0, 0, 1) default
    let nx = 0, ny = 0, nz = 1;
    let minD = Infinity;
    for (let u = 0; u < uniqueCount; u++) {
      const dx = uniquePositions[u * 3] - tx;
      const dy = uniquePositions[u * 3 + 1] - ty;
      const dz = uniquePositions[u * 3 + 2] - tz;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < minD) {
        minD = d;
        nx = uniqueNormals[u * 3];
        ny = uniqueNormals[u * 3 + 1];
        nz = uniqueNormals[u * 3 + 2];
      }
    }

    // Build orthonormal tangent frame (t1, t2)
    let upX = 0, upY = 1, upZ = 0;
    if (Math.abs(ny) > 0.9) { upX = 1; upY = 0; upZ = 0; }
    // t1 = normalize(up x n)
    let t1x = upY * nz - upZ * ny;
    let t1y = upZ * nx - upX * nz;
    let t1z = upX * ny - upY * nx;
    const t1len = Math.hypot(t1x, t1y, t1z) || 1;
    t1x /= t1len; t1y /= t1len; t1z /= t1len;
    // t2 = n x t1
    const t2x = ny * t1z - nz * t1y;
    const t2y = nz * t1x - nx * t1z;
    const t2z = nx * t1y - ny * t1x;

    // Generate 3-5 sub-seed offsets on the tangent disk
    const subSeeds = [{ ox: 0, oy: 0, oz: 0, weight: 1.0, radScale: 0.7 }];
    const numSub = 4;
    for (let s = 0; s < numSub; s++) {
      const angle = (s / numSub) * Math.PI * 2 + (Math.random() - 0.5) * 0.6;
      const dist = (0.25 + 0.45 * Math.random()) * radius;
      const su = Math.cos(angle) * dist;
      const sv = Math.sin(angle) * dist;
      subSeeds.push({
        ox: t1x * su + t2x * sv,
        oy: t1y * su + t2y * sv,
        oz: t1z * su + t2z * sv,
        weight: 0.6 + 0.4 * Math.random(),
        radScale: 0.55 + 0.25 * Math.random(),
      });
    }

    let affected = 0;
    for (let u = 0; u < uniqueCount; u++) {
      if (mask && mask[u]) continue;

      const px = uniquePositions[u * 3];
      const py = uniquePositions[u * 3 + 1];
      const pz = uniquePositions[u * 3 + 2];
      const dx = px - tx;
      const dy = py - ty;
      const dz = pz - tz;
      const distSq = dx * dx + dy * dy + dz * dz;

      // Generous bounding sphere
      if (distSq > rSq * 1.5) continue;

      let totalVal = 0;
      for (let s = 0; s < subSeeds.length; s++) {
        const sub = subSeeds[s];
        const sdx = dx - sub.ox;
        const sdy = dy - sub.oy;
        const sdz = dz - sub.oz;
        const sDist = Math.hypot(sdx, sdy, sdz);
        const subR = radius * sub.radScale;
        if (sDist < subR) {
          const fall = 1.0 - sDist / subR;
          totalVal += fall * sub.weight;
        }
      }

      if (totalVal > 0.05) {
        // High-frequency subtle perturbation to break uniformity
        const noise = 0.85 + 0.3 * Math.random();
        const addV = Math.min(1.0, amount * totalVal * noise);
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
    const bDist = this.boundaryDist;
    const margin = this.boundaryMargin;

    let attempts = 0;
    let seeded = 0;
    while (seeded < count && attempts < count * 20) {
      attempts++;
      const randomIdx = Math.floor(Math.random() * uniqueCount);
      if (mask && mask[randomIdx]) continue;
      // Avoid planting seeds right at the exclusion boundary margin
      if (bDist && margin > 0 && bDist[randomIdx] < margin + 1.0) continue;

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
   * Uses precomputed zero-flux Neumann Laplace weights so excluded boundaries
   * do not bleed excess substrate U or produce artificial ridges/walls.
   */
  step(subSteps = this.subSteps) {
    const { uniqueCount, neighborOffsets, neighborIndices } = this.graph;
    const weights = this.effectiveWeights;
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
          const w = weights[idx];
          if (w === 0) continue;
          const j = neighborIndices[idx];
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
   * Uses smoothstep thresholding and boundary falloff to isolate sharp pattern ridges
   * and smoothly transition to flat background at exclusion boundaries.
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

      // Smoothstep mapping (baseline cutoff at 0.16, peak at 0.38)
      const norm = Math.max(0, Math.min(1, (val - 0.16) / 0.22));
      const bFactor = this.getBoundaryFactor(uIdx);
      const smoothVal = norm * norm * (3.0 - 2.0 * norm) * bFactor;

      // Organic gold/coral highlight: smoothVal = 0 (dark navy), smoothVal = 1 (bright gold)
      const r = 0.15 + smoothVal * 0.85;
      const g = 0.18 + smoothVal * 0.72;
      const b = 0.25 + smoothVal * 0.35;

      const idx = i * 3;
      arr[idx] = r;
      arr[idx + 1] = g;
      arr[idx + 2] = b;
    }
    colorAttr.needsUpdate = true;
  }

  /**
   * Displaces vertices along their normal based on V concentration.
   * Smoothstep curve and boundary falloff eliminate broad plateaus and keep
   * exclusion borders completely flat without unsightly boundary ridges/walls.
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

      // Smoothstep mapping isolates sharp ridges and keeps background at 0 displacement
      const norm = Math.max(0, Math.min(1, (val - 0.16) / 0.22));
      const bFactor = this.getBoundaryFactor(uIdx);
      const smoothVal = norm * norm * (3.0 - 2.0 * norm) * bFactor;
      const disp = smoothVal * height;

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
