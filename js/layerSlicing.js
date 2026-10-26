/*
 * Copyright (c) 2026 CNCKitchen and contributors
 * Watertight Layer-Aligned Slicing for Interleaved Multi-Tool 3MF Export
 *
 * Slices all triangles at exact layer boundary planes Z = minZ + k * thickness
 * using shared edge intersection cache and preserving winding order.
 * This guarantees:
 *  1. Every output triangle lies STRICTLY within a single layer [z_k, z_{k+1}].
 *  2. No triangle crosses any layer boundary.
 *  3. Color/tool boundaries are 100% horizontal with zero diagonal bleeding.
 *  4. Slicers see exactly ONE tool per slice layer with zero within-layer tool changes.
 *  5. Watertight manifold geometry (manifold = yes, open edges = 0).
 */

import { computeLouverDisplacement, getInterleavedToolAtLayer } from './layerBlending.js';
import { TolerantPointMap } from './meshIndex.js';

export function sliceMeshWatertight(positions, normals, minZ, thickness, totalLayers, excludeWeights = null) {
  const t = Math.max(0.01, thickness);
  const zCuts = [];
  for (let k = 1; k < totalLayers; k++) {
    zCuts.push(Math.fround(minZ + k * t));
  }
  const triCount = (positions.length / 9) | 0;
  if (zCuts.length === 0) {
    const triExcl = new Uint8Array(triCount);
    if (excludeWeights) {
      for (let i = 0; i < triCount; i++) {
        if (excludeWeights[i * 3] > 0.99) triExcl[i] = 1;
      }
    }
    return { positions, normals, triExcluded: triExcl };
  }

  const SNAP_TOL = 0.0005; // 0.5 um cut-plane snap tolerance

  // Step 1: Dedup original vertices using TolerantPointMap with cut-plane snapping
  const welder = new TolerantPointMap(0.0002);
  const triVerts = new Int32Array(triCount * 3);
  const uniqueNorms = [];
  const vertExcluded = [];

  for (let i = 0; i < triCount; i++) {
    const b = i * 9;
    for (let j = 0; j < 3; j++) {
      let x = positions[b + j * 3];
      let y = positions[b + j * 3 + 1];
      let z = positions[b + j * 3 + 2];
      // Snap to nearest zCut if within SNAP_TOL to prevent micro-slivers at boundary planes
      const k = Math.round((z - minZ) / t);
      if (k >= 1 && k < totalLayers) {
        const cutZ = zCuts[k - 1];
        if (Math.abs(z - cutZ) < SNAP_TOL) {
          z = cutZ;
        }
      }
      const vid = welder.getOrSet(x, y, z);
      triVerts[i * 3 + j] = vid;
      if (vid >= uniqueNorms.length) {
        const nx = normals ? normals[b + j * 3] : 0;
        const ny = normals ? normals[b + j * 3 + 1] : 0;
        const nz = normals ? normals[b + j * 3 + 2] : 1;
        uniqueNorms.push([nx, ny, nz]);
        vertExcluded.push(excludeWeights && excludeWeights[i * 3] > 0.99 ? 1 : 0);
      }
    }
  }

  const uniqueVerts = [];
  const uXYZ = welder.uniqueXYZ;
  for (let i = 0; i < uXYZ.length; i += 3) {
    uniqueVerts.push([uXYZ[i], uXYZ[i + 1], uXYZ[i + 2]]);
  }

  // Step 2: Shared edge-cut cache: "minId,maxId,cutIdx" -> newVertId
  const edgeCutCache = new Map();

  function getEdgeCut(idA, idB, cutIdx) {
    const minId = Math.min(idA, idB);
    const maxId = Math.max(idA, idB);
    const key = `${minId},${maxId},${cutIdx}`;
    let cutId = edgeCutCache.get(key);
    if (cutId !== undefined) return cutId;

    const zCut = zCuts[cutIdx];
    const A = uniqueVerts[idA];
    const B = uniqueVerts[idB];
    if (Math.abs(A[2] - zCut) < 1e-6) return idA;
    if (Math.abs(B[2] - zCut) < 1e-6) return idB;

    const dz = B[2] - A[2];
    const alpha = Math.abs(dz) > 1e-10 ? Math.max(0, Math.min(1, (zCut - A[2]) / dz)) : 0.5;
    if (alpha < 1e-4) return idA;
    if (alpha > 1.0 - 1e-4) return idB;

    const px = A[0] + alpha * (B[0] - A[0]);
    const py = A[1] + alpha * (B[1] - A[1]);
    const pz = zCut; // exact cut height

    const nA = uniqueNorms[idA];
    const nB = uniqueNorms[idB];
    let nx = nA[0] + alpha * (nB[0] - nA[0]);
    let ny = nA[1] + alpha * (nB[1] - nA[1]);
    let nz = nA[2] + alpha * (nB[2] - nA[2]);
    const nlen = Math.hypot(nx, ny, nz) || 1;
    nx /= nlen; ny /= nlen; nz /= nlen;

    // Coincidence check with endpoints to guarantee zero micro-edges
    if (Math.hypot(px - A[0], py - A[1], pz - A[2]) < 0.0002) return idA;
    if (Math.hypot(px - B[0], py - B[1], pz - B[2]) < 0.0002) return idB;

    cutId = uniqueVerts.length;
    uniqueVerts.push([Math.fround(px), Math.fround(py), Math.fround(pz)]);
    uniqueNorms.push([Math.fround(nx), Math.fround(ny), Math.fround(nz)]);
    vertExcluded.push((vertExcluded[idA] && vertExcluded[idB]) ? 1 : 0);
    edgeCutCache.set(key, cutId);
    return cutId;
  }

  const CHUNK_SIZE = 131072; // 128K triangles per chunk to avoid millions of small Array allocations
  const triChunks = [];
  const layerChunks = [];
  const exclChunks = [];
  let curTriChunk = new Int32Array(CHUNK_SIZE * 3);
  let curLayerChunk = new Int32Array(CHUNK_SIZE);
  let curExclChunk = new Uint8Array(CHUNK_SIZE);
  let chunkCount = 0;
  let totalTriangles = 0;

  function emitTri(id0, id1, id2, layerIdx, isExcl = 0) {
    if (id0 === id1 || id1 === id2 || id2 === id0) return;
    const p0 = uniqueVerts[id0], p1 = uniqueVerts[id1], p2 = uniqueVerts[id2];
    const e1x = p1[0]-p0[0], e1y = p1[1]-p0[1], e1z = p1[2]-p0[2];
    const e2x = p2[0]-p0[0], e2y = p2[1]-p0[1], e2z = p2[2]-p0[2];
    const cx = e1y*e2z - e1z*e2y, cy = e1z*e2x - e1x*e2z, cz = e1x*e2y - e1y*e2x;
    if (cx*cx + cy*cy + cz*cz < 1e-16) return; // Drop collinear zero-area sliver

    if (chunkCount >= CHUNK_SIZE) {
      triChunks.push(curTriChunk);
      layerChunks.push(curLayerChunk);
      exclChunks.push(curExclChunk);
      curTriChunk = new Int32Array(CHUNK_SIZE * 3);
      curLayerChunk = new Int32Array(CHUNK_SIZE);
      curExclChunk = new Uint8Array(CHUNK_SIZE);
      chunkCount = 0;
    }
    const b = chunkCount * 3;
    curTriChunk[b]     = id0;
    curTriChunk[b + 1] = id1;
    curTriChunk[b + 2] = id2;
    curLayerChunk[chunkCount] = Math.max(0, Math.min(totalLayers - 1, layerIdx));
    curExclChunk[chunkCount]  = isExcl ? 1 : 0;
    chunkCount++;
    totalTriangles++;
  }

  const cutEdgesPerCut = Array.from({ length: zCuts.length }, () => []);

  // Direct polygon-clipping slicer: clips triangles strictly against layer boundary planes
  // in sequential order. Guarantees O(K) complexity instead of exponential O(2^K) subdivision tree explosion,
  // eliminating millions of redundant slivers while preserving 100% watertight topology with zero open edges.
  for (let tIdx = 0; tIdx < triCount; tIdx++) {
    const isExcl = excludeWeights ? (excludeWeights[tIdx * 3] > 0.99 ? 1 : 0) : 0;
    const v0 = triVerts[tIdx * 3];
    const v1 = triVerts[tIdx * 3 + 1];
    const v2 = triVerts[tIdx * 3 + 2];

    const z0 = uniqueVerts[v0][2], z1 = uniqueVerts[v1][2], z2 = uniqueVerts[v2][2];
    const minZ = Math.min(z0, z1, z2);
    const maxZ = Math.max(z0, z1, z2);

    let startCut = 0;
    while (startCut < zCuts.length && zCuts[startCut] < minZ - 1e-6) startCut++;
    let endCut = startCut;
    while (endCut < zCuts.length && zCuts[endCut] <= maxZ + 1e-6) endCut++;

    if (startCut >= endCut) {
      emitTri(v0, v1, v2, startCut, isExcl);
      continue;
    }

    let poly = [v0, v1, v2];

    for (let cutIdx = startCut; cutIdx < endCut; cutIdx++) {
      const zCut = zCuts[cutIdx];
      const below = [];
      const above = [];
      let cutEdgeStart = -1;
      let cutEdgeEnd = -1;

      const num = poly.length;
      const EPS = 1e-6;

      for (let i = 0; i < num; i++) {
        const curId = poly[i];
        const nextId = poly[(i + 1) % num];
        const curZ = uniqueVerts[curId][2];
        const nextZ = uniqueVerts[nextId][2];

        const curDiff = curZ - zCut;
        const nextDiff = nextZ - zCut;

        const curState = curDiff < -EPS ? -1 : (curDiff > EPS ? 1 : 0);
        const nextState = nextDiff < -EPS ? -1 : (nextDiff > EPS ? 1 : 0);

        if (curState <= 0) {
          if (below.length === 0 || below[below.length - 1] !== curId) below.push(curId);
        }
        if (curState >= 0) {
          if (above.length === 0 || above[above.length - 1] !== curId) above.push(curId);
        }

        if ((curState < 0 && nextState > 0) || (curState > 0 && nextState < 0)) {
          const interId = getEdgeCut(curId, nextId, cutIdx);
          if (interId !== curId && interId !== nextId) {
            if (below.length === 0 || below[below.length - 1] !== interId) below.push(interId);
            if (above.length === 0 || above[above.length - 1] !== interId) above.push(interId);
            if (curState < 0) {
              cutEdgeEnd = interId;
            } else {
              cutEdgeStart = interId;
            }
          }
        } else if (curState === 0 && nextState > 0) {
          cutEdgeEnd = curId;
        } else if (curState > 0 && nextState === 0) {
          cutEdgeStart = nextId;
        } else if (curState === 0 && nextState < 0) {
          cutEdgeStart = curId;
        } else if (curState < 0 && nextState === 0) {
          cutEdgeEnd = nextId;
        }
      }

      if (below.length > 1 && below[below.length - 1] === below[0]) below.pop();
      if (above.length > 1 && above[above.length - 1] === above[0]) above.pop();

      if (cutEdgeStart !== -1 && cutEdgeEnd !== -1 && cutEdgeStart !== cutEdgeEnd) {
        if (cutEdgesPerCut[cutIdx]) {
          cutEdgesPerCut[cutIdx].push([cutEdgeStart, cutEdgeEnd]);
        }
      }

      if (below.length >= 3) {
        for (let j = 1; j < below.length - 1; j++) {
          emitTri(below[0], below[j], below[j + 1], cutIdx, isExcl);
        }
      }

      if (above.length < 3) {
        poly = [];
        break;
      }
      poly = above;
    }

    if (poly.length >= 3) {
      for (let j = 1; j < poly.length - 1; j++) {
        emitTri(poly[0], poly[j], poly[j + 1], endCut, isExcl);
      }
    }
  }

  if (chunkCount > 0) {
    triChunks.push(curTriChunk.subarray(0, chunkCount * 3));
    layerChunks.push(curLayerChunk.subarray(0, chunkCount));
    exclChunks.push(curExclChunk.subarray(0, chunkCount));
  }

  // Convert chunk stores to flat Float32Array positions and normals, and Int32Array layers
  const outPos = new Float32Array(totalTriangles * 9);
  const outNrm = new Float32Array(totalTriangles * 9);
  const outLay = new Int32Array(totalTriangles);
  const outExcl = new Uint8Array(totalTriangles);

  let triOffset = 0;
  for (let c = 0; c < triChunks.length; c++) {
    const tChunk = triChunks[c];
    const lChunk = layerChunks[c];
    const eChunk = exclChunks[c];
    const count = lChunk.length;

    outLay.set(lChunk, triOffset);
    outExcl.set(eChunk, triOffset);

    for (let i = 0; i < count; i++) {
      const gTri = triOffset + i;
      const b3 = i * 3;
      const i0 = tChunk[b3], i1 = tChunk[b3 + 1], i2 = tChunk[b3 + 2];
      const p0 = uniqueVerts[i0], p1 = uniqueVerts[i1], p2 = uniqueVerts[i2];
      const n0 = uniqueNorms[i0], n1 = uniqueNorms[i1], n2 = uniqueNorms[i2];
      const b9 = gTri * 9;

      outPos[b9]   = p0[0]; outPos[b9+1] = p0[1]; outPos[b9+2] = p0[2];
      outPos[b9+3] = p1[0]; outPos[b9+4] = p1[1]; outPos[b9+5] = p1[2];
      outPos[b9+6] = p2[0]; outPos[b9+7] = p2[1]; outPos[b9+8] = p2[2];

      outNrm[b9]   = n0[0]; outNrm[b9+1] = n0[1]; outNrm[b9+2] = n0[2];
      outNrm[b9+3] = n1[0]; outNrm[b9+4] = n1[1]; outNrm[b9+5] = n1[2];
      outNrm[b9+6] = n2[0]; outNrm[b9+7] = n2[1]; outNrm[b9+8] = n2[2];
    }
    triOffset += count;
  }

  // Deduplicate boundary cut edges per cut-plane to guarantee zero redundant shelf quads
  // and maintain strict manifold topology with zero open or non-manifold edges.
  for (let c = 0; c < cutEdgesPerCut.length; c++) {
    const rawEdges = cutEdgesPerCut[c];
    if (!rawEdges || rawEdges.length <= 1) continue;
    const seen = new Set();
    const deduped = [];
    for (const [id0, id1] of rawEdges) {
      if (id0 === id1) continue;
      const key = `${id0},${id1}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduped.push([id0, id1]);
    }
    cutEdgesPerCut[c] = deduped;
  }

  return {
    positions: outPos,
    normals: outNrm,
    layers: outLay,
    triExcluded: outExcl,
    vertExcluded: new Uint8Array(vertExcluded),
    cutEdgesPerCut,
    uniqueVerts,
    uniqueNorms,
    zCuts
  };
}

/**
 * Compute displacement strictly within a specific layer context.
 * Guarantees that vertices on cut boundary planes evaluate to their containing layer's
 * active tool, preventing slope artifacts or irregular layer step jags.
 */
function computeLayerDisplacementByLayer(
  activeTool,
  targetToolId,
  lay,
  z,
  minZ,
  t,
  toolIds,
  convexVal,
  concaveVal,
  profileMode,
  blendWeight,
  shadingMode,
  multiColorInfo = null,
  weaveOptions = null
) {
  // Mode 0: Step (discrete 0 / 1)
  if (shadingMode === 0) {
    const isMatch = (activeTool === targetToolId);
    if ((profileMode !== 2 && profileMode !== 3 && profileMode !== 4) || !isMatch) {
      return isMatch ? convexVal : -concaveVal;
    }
    if ((profileMode === 2 || profileMode === 3 || profileMode === 4) && weaveOptions) {
      const waveAmp = Math.max(0.0, weaveOptions.amp ?? 0.60);
      const cx = weaveOptions.cx ?? 0;
      const cy = weaveOptions.cy ?? 0;
      const px = weaveOptions.x ?? 0;
      const py = weaveOptions.y ?? 0;
      const dx = px - cx, dy = py - cy;
      const theta = Math.atan2(dy, dx);
      const waveCount = weaveOptions.waveCount ?? Math.max(6, Math.round((2.0 * Math.PI * 20.0) / (weaveOptions.pitch ?? 1.6)));
      const layerPhase = (lay % 2) * Math.PI;
      const phi = waveCount * theta + layerPhase;
      const u = ((phi / (2.0 * Math.PI)) % 1.0 + 1.0) % 1.0;
      let W;
      if (profileMode === 4) {
        // 🧱 Block Pulse (Trapezoidal Rectangular Wave)
        const edge = 0.05;
        if (u < edge) W = -1.0 + 2.0 * (u / edge);
        else if (u < 0.5 - edge) W = 1.0;
        else if (u < 0.5 + edge) W = 1.0 - 2.0 * ((u - (0.5 - edge)) / (2.0 * edge));
        else if (u < 1.0 - edge) W = -1.0;
        else W = -1.0 + 2.0 * ((u - (1.0 - edge)) / edge);
      } else if (profileMode === 3) {
        W = 1.0 - 4.0 * Math.abs(u - 0.5);
      } else {
        W = Math.sin(phi);
      }
      return isMatch ? (convexVal + waveAmp * W) : -concaveVal;
    }
    const zFrac = Math.max(0, Math.min(1, (z - (minZ + lay * t)) / t));
    const slope = Math.min(convexVal, t);
    const base = Math.max(0, convexVal - slope);
    return base + zFrac * slope;
  }

  // Determine exposure ratio for the active tool in [0.0, 1.0]
  let exposure = 0.5;
  if (multiColorInfo) {
    const { toolA, toolB, t: tAffinity } = multiColorInfo;
    if (activeTool === toolA) {
      exposure = tAffinity;
    } else if (activeTool === toolB) {
      exposure = 1.0 - tAffinity;
    } else {
      exposure = 0.0;
    }
  } else if (toolIds.length >= 2) {
    const isTool0 = (activeTool === toolIds[0]);
    exposure = isTool0 ? blendWeight : (1.0 - blendWeight);
  } else {
    exposure = (activeTool === targetToolId) ? 1.0 : 0.0;
  }
  exposure = Math.max(0, Math.min(1, exposure));

  // ProfileMode 2 (Sinusoidal), Mode 3 (Zigzag), Mode 4 (Block Pulse)
  if (profileMode === 2 || profileMode === 3 || profileMode === 4) {
    const cx = weaveOptions?.cx ?? 0;
    const cy = weaveOptions?.cy ?? 0;
    const px = weaveOptions?.x ?? 0;
    const py = weaveOptions?.y ?? 0;
    const dx = px - cx, dy = py - cy;
    const theta = Math.atan2(dy, dx);
    const waveCount = weaveOptions?.waveCount ?? Math.max(6, Math.round((2.0 * Math.PI * 20.0) / (weaveOptions?.pitch ?? 1.6)));
    const layerPhase = (lay % 2) * Math.PI;
    const phi = waveCount * theta + layerPhase;
    const u = ((phi / (2.0 * Math.PI)) % 1.0 + 1.0) % 1.0;

    let B = 0.0;
    if (profileMode === 4) {
      // 🧱 Block Pulse (Trapezoidal Rectangular Wave)
      const edge = 0.05;
      if (u < edge) {
        B = u / edge;
      } else if (u < 0.5 - edge) {
        B = 1.0;
      } else if (u < 0.5 + edge) {
        B = 1.0 - (u - (0.5 - edge)) / (2.0 * edge);
      } else {
        B = 0.0;
      }
    } else if (profileMode === 3) {
      // 📐 Triangle wave (Zigzag)
      B = Math.max(0.0, Math.min(1.0, 1.0 - 2.0 * Math.abs(u - 0.25)));
    } else {
      // 〰️ Sinusoidal wave
      B = 0.5 + 0.5 * Math.sin(phi);
    }

    const stroke = Math.max(0.01, (convexVal + concaveVal) > 0 ? (convexVal + concaveVal) : (weaveOptions?.amp ?? 0.60));
    const h_peak = -concaveVal + stroke * Math.min(1.0, 2.0 * exposure);
    const h_trough = -concaveVal + stroke * Math.max(0.0, 2.0 * exposure - 1.0);
    return h_trough + (h_peak - h_trough) * B;
  }

  // Mode 1: Gradient for Profile 0 (Flat Step) and Profile 1 (45° Louver)
  const disp = -concaveVal + (convexVal + concaveVal) * exposure;

  if (profileMode === 0) {
    return disp;
  }

  // ProfileMode 6: 🌊 Modulated Step (Any Mesh / Wave Flow)
  // Maintains 100% watertight sliced topology for arbitrary bifurcated meshes (e.g. 4 legs),
  // while applying horizontal waveform exposure modulation (halftone weave) per layer.
  if (profileMode === 6) {
    const pitch = Math.max(0.2, weaveOptions?.pitch ?? 1.60);
    const stroke = Math.max(0.01, (convexVal + concaveVal) > 0 ? (convexVal + concaveVal) : (weaveOptions?.amp ?? 0.60));
    
    // Check tool mode for the current layer's activeTool:
    // 'weave': Always weave (50% checker wave even at 100% exposure)
    // 'pwm': Duty-cycle weave (proportional pulse width, 100% exposure is flat)
    // 'flat': Completely flat (pure stepped displacement, no horizontal wave)
    let toolMode = weaveOptions?.toolWeaveModes ? weaveOptions.toolWeaveModes[activeTool] : 'weave';
    if (toolMode === true || toolMode === undefined) toolMode = 'weave';
    else if (toolMode === false) toolMode = 'flat';

    // 1. Completely flat mode
    if (toolMode === 'flat') {
      return -concaveVal + stroke * exposure;
    }

    // Wave phase calculation:
    // Uses smooth geometric polar coordinate around the local island center (cx, cy).
    // theta = atan2(y - cy, x - cx) is a smooth, continuous C-inf function of position,
    // completely independent of individual triangle normals, eliminating "missing-tooth gear" tearing!
    const cx = weaveOptions?.cx ?? 0;
    const cy = weaveOptions?.cy ?? 0;
    const px = weaveOptions?.x ?? 0;
    const py = weaveOptions?.y ?? 0;
    const theta = Math.atan2(py - cy, px - cx);
    const waveCount = weaveOptions?.waveCount ?? Math.max(1, Math.round((2.0 * Math.PI * (weaveOptions?.radius ?? 10.0)) / pitch));

    const layerPhase = (lay % 2) * Math.PI;
    const phi = theta * waveCount + layerPhase;

    const uFrac = ((phi / (2.0 * Math.PI)) % 1.0 + 1.0) % 1.0;
    const edge = 0.06;
    let B = 0.0;

    if (toolMode === 'pwm') {
      // 2. 🌊 PWM Mode: Duty cycle scales with exposure.
      // At 100% exposure, pulse width is 100% (flat). At 50%, duty cycle is 50%.
      if (exposure <= 0.001) {
        B = 0.0;
      } else if (exposure >= 0.999) {
        B = 1.0;
      } else {
        const duty = Math.max(edge * 2, Math.min(1.0 - edge * 2, exposure));
        if (uFrac < edge) {
          B = uFrac / edge;
        } else if (uFrac < duty - edge) {
          B = 1.0;
        } else if (uFrac < duty + edge) {
          B = 1.0 - (uFrac - (duty - edge)) / (2.0 * edge);
        } else {
          B = 0.0;
        }
      }
      const h_peak = -concaveVal + stroke * Math.min(1.0, 2.0 * exposure);
      const h_trough = -concaveVal + stroke * Math.max(0.0, 2.0 * exposure - 1.0);
      return h_trough + (h_peak - h_trough) * B;
    } else {
      // 3. 〰️ Always Weave Mode:
      // Even if exposure is 100% (pure color), it maintains a 50% duty cycle checker wave so
      // alternating layers form interlocking woven beads across the entire surface!
      if (exposure <= 0.001) {
        return -concaveVal;
      }
      if (uFrac < edge) {
        B = uFrac / edge;
      } else if (uFrac < 0.5 - edge) {
        B = 1.0;
      } else if (uFrac < 0.5 + edge) {
        B = 1.0 - (uFrac - (0.5 - edge)) / (2.0 * edge);
      } else {
        B = 0.0;
      }
      // Height scales with exposure (100% exposure = full stroke bead)
      return -concaveVal + stroke * exposure * B;
    }
  }

  // ProfileMode 1: 45° Louver
  const effAmp = Math.max(0.0, disp);
  const zFrac = Math.max(0, Math.min(1, (z - (minZ + lay * t)) / t));
  let slope = Math.min(effAmp, t);
  let base = Math.max(0, effAmp - slope);
  // Eliminate micro-steps near layer thickness boundary (base < 1 µm)
  // Guarantees shelf widths cannot degenerate below 3MF welding tolerance (0.2 µm),
  // completely preventing collapsed/degenerate shelf triangles and open edges.
  if (base < 0.001) {
    base = 0.0;
    slope = effAmp;
  }
  return base + zFrac * slope;
}

/**
 * Automatically decompose sliced triangles into connected component islands per layer,
 * computing each island's geometric centroid (cx, cy), mean radius, and exact integer wave count.
 * This guarantees:
 *  1. Smooth, continuous polar coordinates theta = atan2(y - cy, x - cx) around each island.
 *  2. Constant metric physical pitch (e.g. 1.60 mm) across ALL parts of the model (torso, legs, ears).
 *  3. Absolutely zero jagged "missing-tooth gear" tearing since normals are never projected onto positions.
 */
function buildLayerIslands(sliced, actualMaxLay, pitch) {
  const { positions: inPos, layers: inLay } = sliced;
  const count = inLay.length;
  const totalLayers = actualMaxLay + 1;

  const layerTris = Array.from({ length: totalLayers }, () => []);
  for (let i = 0; i < count; i++) {
    layerTris[inLay[i]].push(i);
  }

  const triIslands = new Array(count);
  const layerIslands = Array.from({ length: totalLayers }, () => []);

  for (let lay = 0; lay < totalLayers; lay++) {
    const tris = layerTris[lay];
    const n = tris.length;
    if (n === 0) continue;

    // Group triangles in this layer by topological vertex sharing
    const vertToTris = new Map();
    for (let i = 0; i < n; i++) {
      const tIdx = tris[i];
      const b = tIdx * 9;
      for (let v = 0; v < 3; v++) {
        const qx = Math.round(inPos[b + v * 3] * 100);
        const qy = Math.round(inPos[b + v * 3 + 1] * 100);
        const qz = Math.round(inPos[b + v * 3 + 2] * 100);
        const key = `${qx},${qy},${qz}`;
        let list = vertToTris.get(key);
        if (!list) { list = []; vertToTris.set(key, list); }
        list.push(i);
      }
    }

    const parent = new Int32Array(n).map((_, idx) => idx);
    function find(x) { while (x !== parent[x]) x = parent[x] = parent[parent[x]]; return x; }
    function union(a, b) { parent[find(a)] = find(b); }

    for (const list of vertToTris.values()) {
      const first = list[0];
      for (let k = 1; k < list.length; k++) {
        union(first, list[k]);
      }
    }

    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const root = find(i);
      if (!groups.has(root)) groups.set(root, []);
      groups.get(root).push(tris[i]);
    }

    const currentLayerIslands = layerIslands[lay];
    for (const group of groups.values()) {
      let sumX = 0, sumY = 0, ptCount = 0;
      for (const tIdx of group) {
        const b = tIdx * 9;
        for (let v = 0; v < 3; v++) {
          sumX += inPos[b + v * 3];
          sumY += inPos[b + v * 3 + 1];
          ptCount++;
        }
      }
      const cx = sumX / ptCount;
      const cy = sumY / ptCount;
      let sumR = 0;
      for (const tIdx of group) {
        const b = tIdx * 9;
        for (let v = 0; v < 3; v++) {
          sumR += Math.hypot(inPos[b + v * 3] - cx, inPos[b + v * 3 + 1] - cy);
        }
      }
      const radius = Math.max(0.5, sumR / ptCount);
      const waveCount = Math.max(1, Math.round((2.0 * Math.PI * radius) / pitch));
      const island = { cx, cy, radius, waveCount };
      currentLayerIslands.push(island);

      for (const tIdx of group) {
        triIslands[tIdx] = island;
      }
    }
  }

  return { triIslands, layerIslands };
}

function getNearestIsland(layerIslands, lay, x, y) {
  if (!layerIslands || lay < 0 || lay >= layerIslands.length) return null;
  const islands = layerIslands[lay];
  if (!islands || islands.length === 0) return null;
  if (islands.length === 1) return islands[0];
  let best = islands[0];
  let bestDistSq = (x - best.cx) ** 2 + (y - best.cy) ** 2;
  for (let i = 1; i < islands.length; i++) {
    const isl = islands[i];
    const dSq = (x - isl.cx) ** 2 + (y - isl.cy) ** 2;
    if (dSq < bestDistSq) {
      bestDistSq = dSq;
      best = isl;
    }
  }
  return best;
}

/**
 * Apply layer-aligned displacement to a sliced mesh and insert horizontal shelves.
 * Displaces strictly from pristine base positions, completely eliminating double displacement,
 * periodic long/short moiré stripes, and residual micro-roughness.
 */
export function applyLayerAlignedDisplacement(
  sliced,
  minZ,
  thickness,
  toolIds,
  convexVal,
  concaveVal,
  profileMode,
  shadingMode,
  sampleFn, // (x, y, z, nx, ny, nz) => { targetTool, blendWeight }
  untexturedTool = 1,
  exclusionMode = 0, // 0: OFF/OFF, 1: OFF/ON, 2: ON/OFF, 3: ON/ON
  weaveParams = null
) {
  const { positions: inPos, normals: inNrm, layers: inLay, triExcluded, vertExcluded, cutEdgesPerCut, uniqueVerts, uniqueNorms, zCuts } = sliced;
  const triCount = inLay.length;
  const t = Math.max(0.01, thickness);

  // 1. Displace every base sliced triangle strictly for its layer's active tool
  const outPosList = [new Float32Array(triCount * 9)];
  const outNrmList = [new Float32Array(triCount * 9)];
  const outPos = outPosList[0];
  const outNrm = outNrmList[0];
  const triTools = new Int32Array(triCount);

  // Find the actual highest layer index present in the sliced mesh
  let actualMaxLay = 0;
  for (let i = 0; i < inLay.length; i++) {
    if (inLay[i] > actualMaxLay) actualMaxLay = inLay[i];
  }

  // Precompute topological connected-component islands per layer for Profile 6
  let triIslands = null;
  let layerIslands = null;
  if (profileMode === 6) {
    const pitch = Math.max(0.2, weaveParams?.pitch ?? 1.60);
    const islandData = buildLayerIslands(sliced, actualMaxLay, pitch);
    triIslands = islandData.triIslands;
    layerIslands = islandData.layerIslands;
  }

  // Pristine boundary protection with layer-based fade:
  // 1. Topmost 2 layers and bottommost 1 layer have zero displacement (pristine base mesh).
  //    This guarantees the top rim connects to the flat cap with ZERO shelves, ZERO open edges,
  //    and a 100% strictly vertical cylindrical contour that slicers process flawlessly.
  // 2. All vertices within any single layer share the EXACT same uniform layerFade,
  //    keeping sidewall polygons 100% strictly vertical (zero taper / zero overhang).
  // 3. Smoothstep layer-based fade over 4 transitional layers eliminates any abrupt steps.
  const pristineTopLayers = 2;
  const pristineBotLayers = 1;
  const fadeLayers = 4;

  function getLayerFade(lay) {
    if (lay > actualMaxLay - pristineTopLayers || lay < pristineBotLayers) return 0.0;
    const topTrans = actualMaxLay - pristineTopLayers;
    if (lay > topTrans - fadeLayers) {
      const u = (topTrans - lay) / fadeLayers;
      return u * u * (3 - 2 * u);
    }
    const botTrans = pristineBotLayers;
    if (lay < botTrans + fadeLayers) {
      const u = (lay - botTrans) / fadeLayers;
      return u * u * (3 - 2 * u);
    }
    return 1.0;
  }

  function computeDisplacement(
    activeTool,
    targetTool,
    blendWeight,
    lay,
    z,
    isExcl,
    exclMode,
    multiColorInfo = null,
    x = 0,
    y = 0,
    nx = 0,
    ny = 0,
    u = null,
    v = null,
    island = null
  ) {
    const weaveOptions = weaveParams
      ? { ...weaveParams, x, y, nx, ny, u, v, cx: island?.cx, cy: island?.cy, waveCount: island?.waveCount, radius: island?.radius }
      : { x, y, nx, ny, u, v, cx: island?.cx, cy: island?.cy, waveCount: island?.waveCount, radius: island?.radius };
    if (isExcl) {
      if (exclMode === 1) {
        // Mode 2: OFF, ON - 指定ツールが出っ張り交互積層
        return computeLayerDisplacementByLayer(
          activeTool,
          untexturedTool,
          lay,
          z,
          minZ,
          t,
          toolIds,
          convexVal,
          concaveVal,
          profileMode,
          1.0,
          0,
          null,
          weaveOptions
        );
      } else if (exclMode === 2) {
        // Mode 3: ON, OFF - 凹凸維持、ペイント解除（指定ツール単色立体レリーフ）
        return computeLayerDisplacementByLayer(
          activeTool,
          targetTool,
          lay,
          z,
          minZ,
          t,
          toolIds,
          convexVal,
          concaveVal,
          profileMode,
          blendWeight,
          shadingMode,
          multiColorInfo,
          weaveOptions
        );
      } else {
        // Mode 1 (exclMode 0): OFF, OFF - 完全フラット
        // Mode 4 (exclMode 3): ON, ON - 振り量0 (何も出っ張らないフラット交互積層)
        return 0.0;
      }
    }

    // 通常領域
    return computeLayerDisplacementByLayer(
      activeTool,
      targetTool,
      lay,
      z,
      minZ,
      t,
      toolIds,
      convexVal,
      concaveVal,
      profileMode,
      blendWeight,
      shadingMode,
      multiColorInfo,
      weaveOptions
    );
  }

  for (let i = 0; i < triCount; i++) {
    const lay = inLay[i];
    const activeTool = getInterleavedToolAtLayer(lay, toolIds);
    const b = i * 9;

    // Compute geometric face normal from vertex positions to detect horizontal caps 100% accurately,
    // independent of vertex dedup normal sharing at corner edges
    const x0 = inPos[b],   y0 = inPos[b+1], z0 = inPos[b+2];
    const x1 = inPos[b+3], y1 = inPos[b+4], z1 = inPos[b+5];
    const x2 = inPos[b+6], y2 = inPos[b+7], z2 = inPos[b+8];
    const e1x = x1 - x0, e1y = y1 - y0, e1z = z1 - z0;
    const e2x = x2 - x0, e2y = y2 - y0, e2z = z2 - z0;
    let fnx = e1y * e2z - e1z * e2y;
    let fny = e1z * e2x - e1x * e2z;
    let fnz = e1x * e2y - e1y * e2x;
    const flen = Math.hypot(fnx, fny, fnz) || 1;
    fnx /= flen; fny /= flen; fnz /= flen;
    const isHorizontalCap = Math.hypot(fnx, fny) < 1e-4;
    const isExcluded = triExcluded ? Boolean(triExcluded[i]) : false;

    let assignedTool;
    if (isHorizontalCap) {
      // Horizontal flat cap surfaces (bottom or top of model) use untexturedTool
      assignedTool = untexturedTool;
    } else {
      // Vertical sidewalls in interleaved mode MUST be 100% strictly activeTool.
      // Zero exceptions: never bleed untexturedTool onto vertical layers to guarantee 1-layer-1-color!
      assignedTool = activeTool;
    }
    triTools[i] = assignedTool;

    const layerFade = getLayerFade(lay);

    for (let v = 0; v < 3; v++) {
      const idx = b + v * 3;
      const x = inPos[idx];
      const y = inPos[idx + 1];
      const z = inPos[idx + 2];
      const nx = inNrm ? inNrm[idx] : 0;
      const ny = inNrm ? inNrm[idx + 1] : 0;
      const nz = inNrm ? inNrm[idx + 2] : 1;

      const hlen = Math.hypot(nx, ny);
      const fhlen = Math.hypot(fnx, fny);

      if (isHorizontalCap || layerFade <= 1e-6) {
        // Horizontal surface (top/bottom flat caps, boundary rim): keep pristine base position
        outPos[idx]     = x;
        outPos[idx + 1] = y;
        outPos[idx + 2] = z;
        outNrm[idx]     = nx;
        outNrm[idx + 1] = ny;
        outNrm[idx + 2] = nz;
      } else {
        // Vertical/perimeter sidewall: apply exact displacement
        const unx = hlen >= 1e-4 ? (nx / hlen) : (fhlen > 0 ? fnx / fhlen : 0);
        const uny = hlen >= 1e-4 ? (ny / hlen) : (fhlen > 0 ? fny / fhlen : 0);

        const s = sampleFn(x, y, z, nx, ny, nz);
        const curIsland = triIslands ? triIslands[i] : null;

        let disp = computeDisplacement(
          activeTool,
          s.targetTool,
          s.blendWeight,
          lay,
          z,
          isExcluded,
          exclusionMode,
          s.multiColorInfo,
          x,
          y,
          nx,
          ny,
          s.u,
          s.v,
          curIsland
        );
        disp *= layerFade;

        outPos[idx]     = Math.fround(x + disp * unx);
        outPos[idx + 1] = Math.fround(y + disp * uny);
        outPos[idx + 2] = z;
        outNrm[idx]     = nx;
        outNrm[idx + 1] = ny;
        outNrm[idx + 2] = nz;
      }
    }
  }

  // 2. Generate horizontal shelf triangles at layer boundary steps to maintain 100% watertight manifold
  // Pre-allocated typed chunk store for shelf triangles to eliminate large V8 JSArray allocations
  const CHUNK_TRIS = 65536; // 64K triangles per chunk
  const shelfPosChunks = [];
  const shelfNrmChunks = [];
  const shelfToolChunks = [];

  let curChunkPos = new Float32Array(CHUNK_TRIS * 9);
  let curChunkNrm = new Float32Array(CHUNK_TRIS * 9);
  let curChunkTool = new Int32Array(CHUNK_TRIS);
  let chunkTriCount = 0;
  let totalShelfTris = 0;

  function emitShelfTriangle(x0, y0, z0, x1, y1, z1, x2, y2, z2, nz, tool) {
    if (chunkTriCount >= CHUNK_TRIS) {
      shelfPosChunks.push(curChunkPos);
      shelfNrmChunks.push(curChunkNrm);
      shelfToolChunks.push(curChunkTool);
      curChunkPos = new Float32Array(CHUNK_TRIS * 9);
      curChunkNrm = new Float32Array(CHUNK_TRIS * 9);
      curChunkTool = new Int32Array(CHUNK_TRIS);
      chunkTriCount = 0;
    }
    const b = chunkTriCount * 9;
    curChunkPos[b]   = x0; curChunkPos[b+1] = y0; curChunkPos[b+2] = z0;
    curChunkPos[b+3] = x1; curChunkPos[b+4] = y1; curChunkPos[b+5] = z1;
    curChunkPos[b+6] = x2; curChunkPos[b+7] = y2; curChunkPos[b+8] = z2;

    curChunkNrm[b]   = 0;  curChunkNrm[b+1] = 0;  curChunkNrm[b+2] = nz;
    curChunkNrm[b+3] = 0;  curChunkNrm[b+4] = 0;  curChunkNrm[b+5] = nz;
    curChunkNrm[b+6] = 0;  curChunkNrm[b+7] = 0;  curChunkNrm[b+8] = nz;

    curChunkTool[chunkTriCount] = tool;
    chunkTriCount++;
    totalShelfTris++;
  }

  if (cutEdgesPerCut && uniqueVerts && uniqueNorms) {
    for (let cutIdx = 0; cutIdx < cutEdgesPerCut.length; cutIdx++) {
      const edges = cutEdgesPerCut[cutIdx];
      if (!edges || edges.length === 0) continue;

      const botLay = cutIdx;
      const topLay = cutIdx + 1;
      const botTool = getInterleavedToolAtLayer(botLay, toolIds);
      const topTool = getInterleavedToolAtLayer(topLay, toolIds);
      const zCut = zCuts ? zCuts[cutIdx] : (minZ + (cutIdx + 1) * t);

      const botFade = getLayerFade(botLay);
      const topFade = getLayerFade(topLay);
      if (botFade <= 1e-6 && topFade <= 1e-6) continue; // Boundary rim is pristine cylinder; no shelf needed

      for (const [id0, id1] of edges) {
        const p0 = uniqueVerts[id0];
        const p1 = uniqueVerts[id1];
        const n0 = uniqueNorms[id0];
        const n1 = uniqueNorms[id1];

        const hlen0 = Math.hypot(n0[0], n0[1]);
        const hlen1 = Math.hypot(n1[0], n1[1]);
        if (hlen0 < 1e-4 && hlen1 < 1e-4) continue; // skip horizontal caps

        const unx0 = hlen0 >= 1e-4 ? n0[0] / hlen0 : 0;
        const uny0 = hlen0 >= 1e-4 ? n0[1] / hlen0 : 0;
        const unx1 = hlen1 >= 1e-4 ? n1[0] / hlen1 : 0;
        const uny1 = hlen1 >= 1e-4 ? n1[1] / hlen1 : 0;

        const s0 = sampleFn(p0[0], p0[1], p0[2], n0[0], n0[1], n0[2]);
        const s1 = sampleFn(p1[0], p1[1], p1[2], n1[0], n1[1], n1[2]);

        const isExcl0 = vertExcluded ? Boolean(vertExcluded[id0]) : false;
        const isExcl1 = vertExcluded ? Boolean(vertExcluded[id1]) : false;

        const midX = (p0[0] + p1[0]) * 0.5;
        const midY = (p0[1] + p1[1]) * 0.5;
        const botIsland = layerIslands ? getNearestIsland(layerIslands, botLay, midX, midY) : null;
        const topIsland = layerIslands ? getNearestIsland(layerIslands, topLay, midX, midY) : null;

        const dispBot0 = (hlen0 >= 1e-4) ? computeDisplacement(botTool, s0.targetTool, s0.blendWeight, botLay, zCut, isExcl0, exclusionMode, s0.multiColorInfo, p0[0], p0[1], n0[0], n0[1], s0.u, s0.v, botIsland) * botFade : 0;
        const dispBot1 = (hlen1 >= 1e-4) ? computeDisplacement(botTool, s1.targetTool, s1.blendWeight, botLay, zCut, isExcl1, exclusionMode, s1.multiColorInfo, p1[0], p1[1], n1[0], n1[1], s1.u, s1.v, botIsland) * botFade : 0;
        let dispTop0 = (hlen0 >= 1e-4) ? computeDisplacement(topTool, s0.targetTool, s0.blendWeight, topLay, zCut, isExcl0, exclusionMode, s0.multiColorInfo, p0[0], p0[1], n0[0], n0[1], s0.u, s0.v, topIsland) * topFade : 0;
        let dispTop1 = (hlen1 >= 1e-4) ? computeDisplacement(topTool, s1.targetTool, s1.blendWeight, topLay, zCut, isExcl1, exclusionMode, s1.multiColorInfo, p1[0], p1[1], n1[0], n1[1], s1.u, s1.v, topIsland) * topFade : 0;

        let diff0 = dispBot0 - dispTop0;
        let diff1 = dispBot1 - dispTop1;
        const hasStep0 = Math.abs(diff0) >= 1e-4;
        const hasStep1 = Math.abs(diff1) >= 1e-4;
        if (!hasStep0 && !hasStep1) continue; // coplanar, no shelf needed

        // Synchronize endpoints where step is sub-micron to avoid hairline gaps
        if (!hasStep0) {
          dispTop0 = dispBot0;
          diff0 = 0;
        }
        if (!hasStep1) {
          dispTop1 = dispBot1;
          diff1 = 0;
        }

        const p0_bot_x = Math.fround(p0[0] + dispBot0 * unx0);
        const p0_bot_y = Math.fround(p0[1] + dispBot0 * uny0);
        const p0_bot_z = p0[2];

        const p1_bot_x = Math.fround(p1[0] + dispBot1 * unx1);
        const p1_bot_y = Math.fround(p1[1] + dispBot1 * uny1);
        const p1_bot_z = p1[2];

        const p0_top_x = Math.fround(p0[0] + dispTop0 * unx0);
        const p0_top_y = Math.fround(p0[1] + dispTop0 * uny0);
        const p0_top_z = p0[2];

        const p1_top_x = Math.fround(p1[0] + dispTop1 * unx1);
        const p1_top_y = Math.fround(p1[1] + dispTop1 * uny1);
        const p1_top_z = p1[2];

        const shelfNz = ((dispBot0 + dispBot1) >= (dispTop0 + dispTop1)) ? 1 : -1;

        // Assign tool strictly aligned to the layer containing this surface:
        // - If shelf faces upward (shelfNz > 0), it is the top ceiling of botLay -> botTool.
        // - If shelf faces downward (shelfNz < 0), it is the bottom floor of topLay -> topTool.
        // This guarantees 100% strict single-color per slice layer with zero cross-layer tool bleed!
        const shelfTool = (shelfNz > 0) ? botTool : topTool;

        // Output non-degenerate shelf geometry with mathematically correct manifold winding order:
        // Lower triangle edge is p1_bot -> p0_bot, so shelf must have opposite directed edge p0_bot -> p1_bot.
        // Upper triangle edge is p0_top -> p1_top, so shelf must have opposite directed edge p1_top -> p0_top.
        if (!hasStep0) {
          emitShelfTriangle(p1_bot_x, p1_bot_y, p1_bot_z, p1_top_x, p1_top_y, p1_top_z, p0_bot_x, p0_bot_y, p0_bot_z, shelfNz, shelfTool);
        } else if (!hasStep1) {
          emitShelfTriangle(p1_bot_x, p1_bot_y, p1_bot_z, p0_top_x, p0_top_y, p0_top_z, p0_bot_x, p0_bot_y, p0_bot_z, shelfNz, shelfTool);
        } else {
          emitShelfTriangle(p1_bot_x, p1_bot_y, p1_bot_z, p0_top_x, p0_top_y, p0_top_z, p0_bot_x, p0_bot_y, p0_bot_z, shelfNz, shelfTool);
          emitShelfTriangle(p1_bot_x, p1_bot_y, p1_bot_z, p1_top_x, p1_top_y, p1_top_z, p0_top_x, p0_top_y, p0_top_z, shelfNz, shelfTool);
        }
      }
    }
  }

  if (chunkTriCount > 0) {
    shelfPosChunks.push(curChunkPos.subarray(0, chunkTriCount * 9));
    shelfNrmChunks.push(curChunkNrm.subarray(0, chunkTriCount * 9));
    shelfToolChunks.push(curChunkTool.subarray(0, chunkTriCount));
  }

  const extraTriCount = totalShelfTris;
  if (extraTriCount === 0) {
    return {
      positions: outPos,
      normals: outNrm,
      triTools
    };
  }

  const totalTriCount = triCount + extraTriCount;
  const finalPos = new Float32Array(totalTriCount * 9);
  const finalNrm = new Float32Array(totalTriCount * 9);
  const finalTools = new Int32Array(totalTriCount);

  finalPos.set(outPos, 0);
  finalNrm.set(outNrm, 0);
  finalTools.set(triTools, 0);

  let pOffset = triCount * 9;
  let nOffset = triCount * 9;
  let tOffset = triCount;

  for (let c = 0; c < shelfPosChunks.length; c++) {
    const pC = shelfPosChunks[c];
    const nC = shelfNrmChunks[c];
    const tC = shelfToolChunks[c];

    finalPos.set(pC, pOffset);
    finalNrm.set(nC, nOffset);
    finalTools.set(tC, tOffset);

    pOffset += pC.length;
    nOffset += nC.length;
    tOffset += tC.length;
  }

  return {
    positions: finalPos,
    normals: finalNrm,
    triTools: finalTools
  };
}
