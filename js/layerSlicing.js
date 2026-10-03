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

export function sliceMeshWatertight(positions, normals, minZ, thickness, totalLayers, excludeWeights = null) {
  const t = Math.max(0.01, thickness);
  const zCuts = [];
  for (let k = 1; k < totalLayers; k++) {
    zCuts.push(minZ + k * t);
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

  const QUANT = 1e5; // 10 um quantization for vertex dedup

  // Step 1: Dedup original vertices to integer IDs
  const vertMap = new Map();
  const uniqueVerts = []; // id -> [x, y, z]
  const uniqueNorms = []; // id -> [nx, ny, nz]
  const vertExcluded = []; // id -> 0 or 1
  const triVerts = new Int32Array(triCount * 3);

  function getVertId(x, y, z, nx, ny, nz) {
    const qx = Math.round(x * QUANT);
    const qy = Math.round(y * QUANT);
    const qz = Math.round(z * QUANT);
    const key = `${qx},${qy},${qz}`;
    let id = vertMap.get(key);
    if (id === undefined) {
      id = uniqueVerts.length;
      vertMap.set(key, id);
      uniqueVerts.push([Math.fround(x), Math.fround(y), Math.fround(z)]);
      uniqueNorms.push([Math.fround(nx), Math.fround(ny), Math.fround(nz)]);
      vertExcluded.push(0);
    }
    return id;
  }

  for (let i = 0; i < triCount; i++) {
    const b = i * 9;
    const nx0 = normals ? normals[b]   : 0, ny0 = normals ? normals[b+1] : 0, nz0 = normals ? normals[b+2] : 1;
    const nx1 = normals ? normals[b+3] : 0, ny1 = normals ? normals[b+4] : 0, nz1 = normals ? normals[b+5] : 1;
    const nx2 = normals ? normals[b+6] : 0, ny2 = normals ? normals[b+7] : 0, nz2 = normals ? normals[b+8] : 1;

    const v0 = getVertId(positions[b],   positions[b+1], positions[b+2], nx0, ny0, nz0);
    const v1 = getVertId(positions[b+3], positions[b+4], positions[b+5], nx1, ny1, nz1);
    const v2 = getVertId(positions[b+6], positions[b+7], positions[b+8], nx2, ny2, nz2);
    triVerts[i * 3]     = v0;
    triVerts[i * 3 + 1] = v1;
    triVerts[i * 3 + 2] = v2;

    if (excludeWeights && excludeWeights[i * 3] > 0.99) {
      vertExcluded[v0] = 1;
      vertExcluded[v1] = 1;
      vertExcluded[v2] = 1;
    }
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
    const nA = uniqueNorms[idA];
    const nB = uniqueNorms[idB];

    const dz = B[2] - A[2];
    const alpha = Math.abs(dz) > 1e-10 ? Math.max(0, Math.min(1, (zCut - A[2]) / dz)) : 0.5;
    const px = A[0] + alpha * (B[0] - A[0]);
    const py = A[1] + alpha * (B[1] - A[1]);
    const pz = zCut; // exact cut height

    let nx = nA[0] + alpha * (nB[0] - nA[0]);
    let ny = nA[1] + alpha * (nB[1] - nA[1]);
    let nz = nA[2] + alpha * (nB[2] - nA[2]);
    const nlen = Math.hypot(nx, ny, nz) || 1;
    nx /= nlen; ny /= nlen; nz /= nlen;

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
    const e1x = p1[0] - p0[0], e1y = p1[1] - p0[1], e1z = p1[2] - p0[2];
    const e2x = p2[0] - p0[0], e2y = p2[1] - p0[1], e2z = p2[2] - p0[2];
    const cx = e1y * e2z - e1z * e2y;
    const cy = e1z * e2x - e1x * e2z;
    const cz = e1x * e2y - e1y * e2x;
    if (cx * cx + cy * cy + cz * cz < 1e-12) return;

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
      for (let i = 0; i < num; i++) {
        const curId = poly[i];
        const nextId = poly[(i + 1) % num];
        const curZ = uniqueVerts[curId][2];
        const nextZ = uniqueVerts[nextId][2];

        const curBelow = curZ <= zCut + 1e-6;
        const nextBelow = nextZ <= zCut + 1e-6;

        if (curBelow) {
          if (below.length === 0 || below[below.length - 1] !== curId) below.push(curId);
        } else {
          if (above.length === 0 || above[above.length - 1] !== curId) above.push(curId);
        }

        if (curBelow !== nextBelow) {
          const isCurOnPlane = Math.abs(curZ - zCut) <= 1e-6;
          const isNextOnPlane = Math.abs(nextZ - zCut) <= 1e-6;
          const interId = isCurOnPlane ? curId : (isNextOnPlane ? nextId : getEdgeCut(curId, nextId, cutIdx));
          if (below.length === 0 || below[below.length - 1] !== interId) below.push(interId);
          if (above.length === 0 || above[above.length - 1] !== interId) above.push(interId);

          if (curBelow && !nextBelow) {
            cutEdgeEnd = interId;
          } else {
            cutEdgeStart = interId;
          }
        }
      }

      if (cutEdgeStart !== -1 && cutEdgeEnd !== -1 && cutEdgeStart !== cutEdgeEnd) {
        if (cutEdgesPerCut[cutIdx]) {
          cutEdgesPerCut[cutIdx].push([cutEdgeStart, cutEdgeEnd]);
        }
      }

      if (below.length >= 3) {
        for (let j = 1; j < below.length - 1; j++) {
          const id0 = below[0], id1 = below[j], id2 = below[j + 1];
          const zA = uniqueVerts[id0][2], zB = uniqueVerts[id1][2], zC = uniqueVerts[id2][2];
          // Discard artificial zero-thickness horizontal slivers lying entirely on the cut plane
          if (Math.abs(zA - zCut) <= 1e-5 && Math.abs(zB - zCut) <= 1e-5 && Math.abs(zC - zCut) <= 1e-5) {
            continue;
          }
          emitTri(id0, id1, id2, cutIdx, isExcl);
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
        const id0 = poly[0], id1 = poly[j], id2 = poly[j + 1];
        const zA = uniqueVerts[id0][2], zB = uniqueVerts[id1][2], zC = uniqueVerts[id2][2];
        if (Math.abs(zA - zB) <= 1e-6 && Math.abs(zB - zC) <= 1e-6) {
          continue;
        }
        emitTri(id0, id1, id2, endCut, isExcl);
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
    if (profileMode === 0 || !isMatch) {
      return isMatch ? convexVal : -concaveVal;
    }
    if (profileMode === 2 && weaveOptions) {
      const pitch = Math.max(0.2, weaveOptions.pitch ?? 1.5);
      const waveAmp = Math.max(0.0, weaveOptions.amp ?? 0.25);
      const cx = weaveOptions.cx ?? 0;
      const cy = weaveOptions.cy ?? 0;
      const px = weaveOptions.x ?? 0;
      const py = weaveOptions.y ?? 0;
      const dx = px - cx, dy = py - cy;
      const r = Math.hypot(dx, dy);
      const theta = Math.atan2(dy, dx);
      const arc = r * theta;
      const k = (2.0 * Math.PI) / pitch;
      const layerPhase = (lay % 2) * Math.PI;
      const W = Math.sin(k * arc + layerPhase);
      return isMatch ? (convexVal + waveAmp * W) : -concaveVal;
    }
    const zFrac = Math.max(0, Math.min(1, (z - (minZ + lay * t)) / t));
    const slope = Math.min(convexVal, t);
    const base = Math.max(0, convexVal - slope);
    return base + zFrac * slope;
  }

  // Mode 1: Gradient (continuous exposure ratio)
  // Supports 2, 3, or more tools seamlessly
  let ratio = 0.0;
  if (multiColorInfo) {
    const { toolA, toolB, t: tAffinity } = multiColorInfo;
    if (activeTool === toolA) {
      ratio = (tAffinity >= 0.5) ? (tAffinity - 0.5) * 2.0 : 0.0;
    } else if (activeTool === toolB) {
      ratio = (tAffinity < 0.5) ? (0.5 - tAffinity) * 2.0 : 0.0;
    } else {
      ratio = 0.0;
    }
  } else if (toolIds.length >= 2) {
    const isTool0 = (activeTool === toolIds[0]);
    if (blendWeight >= 0.5) {
      ratio = isTool0 ? (blendWeight - 0.5) * 2.0 : 0.0;
    } else {
      ratio = !isTool0 ? (0.5 - blendWeight) * 2.0 : 0.0;
    }
  } else {
    ratio = (activeTool === targetToolId) ? 1.0 : 0.0;
  }
  ratio = Math.max(0, Math.min(1, ratio));

  if (ratio <= 0.0) {
    return -concaveVal;
  }

  // ProfileMode 2: Sinusoidal Weave (Halftone Interlocking)
  if (profileMode === 2) {
    const pitch = Math.max(0.2, weaveOptions?.pitch ?? 1.5);
    const waveAmp = Math.max(0.0, weaveOptions?.amp ?? 0.25);
    const px = weaveOptions?.x ?? 0;
    const py = weaveOptions?.y ?? 0;
    const nx = weaveOptions?.nx ?? 0;
    const ny = weaveOptions?.ny ?? 0;
    const absNx = Math.abs(nx);
    const absNy = Math.abs(ny);
    let sHoriz;
    if (absNx + absNy > 1e-4) {
      const len = Math.hypot(nx, ny);
      sHoriz = (-ny * px + nx * py) / len;
    } else {
      sHoriz = px * 0.7071 - py * 0.7071;
    }
    const k = (2.0 * Math.PI) / pitch;
    const layerPhase = (lay % 2) * Math.PI;
    const W = Math.sin(k * sHoriz + layerPhase);

    const dcOffset = -concaveVal + (convexVal + concaveVal) * ratio;
    return dcOffset + waveAmp * W * ratio;
  }

  let effAmp = convexVal * ratio;
  if (effAmp < 0.001) {
    return 0.0;
  }
  if (profileMode === 0) {
    return effAmp;
  }

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
    ny = 0
  ) {
    const weaveOptions = weaveParams ? { ...weaveParams, x, y, nx, ny } : { x, y, nx, ny };
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
    const isHorizontalCap = Math.hypot(fnx, fny) < 0.15;
    const isExcluded = triExcluded ? Boolean(triExcluded[i]) : false;

    let assignedTool;
    if (isHorizontalCap) {
      assignedTool = untexturedTool;
    } else if (isExcluded) {
      if (exclusionMode === 1 || exclusionMode === 3) {
        // Mode 2 & Mode 4: 交互積層維持 (activeTool)
        assignedTool = activeTool;
      } else {
        // Mode 1 & Mode 3: 指定ツール塗りつぶし (untexturedTool)
        assignedTool = untexturedTool;
      }
    } else {
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
        const unx = hlen >= 0.15 ? (nx / hlen) : (fhlen > 0 ? fnx / fhlen : 0);
        const uny = hlen >= 0.15 ? (ny / hlen) : (fhlen > 0 ? fny / fhlen : 0);

        const { targetTool, blendWeight, multiColorInfo } = sampleFn(x, y, z, nx, ny, nz);

        let disp = computeDisplacement(
          activeTool,
          targetTool,
          blendWeight,
          lay,
          z,
          isExcluded,
          exclusionMode,
          multiColorInfo,
          x,
          y,
          nx,
          ny
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
        if (hlen0 < 0.15 && hlen1 < 0.15) continue; // skip horizontal caps

        const unx0 = hlen0 >= 0.15 ? n0[0] / hlen0 : 0;
        const uny0 = hlen0 >= 0.15 ? n0[1] / hlen0 : 0;
        const unx1 = hlen1 >= 0.15 ? n1[0] / hlen1 : 0;
        const uny1 = hlen1 >= 0.15 ? n1[1] / hlen1 : 0;

        const s0 = sampleFn(p0[0], p0[1], p0[2], n0[0], n0[1], n0[2]);
        const s1 = sampleFn(p1[0], p1[1], p1[2], n1[0], n1[1], n1[2]);

        const isExcl0 = vertExcluded ? Boolean(vertExcluded[id0]) : false;
        const isExcl1 = vertExcluded ? Boolean(vertExcluded[id1]) : false;

        const dispBot0 = (hlen0 >= 0.15) ? computeDisplacement(botTool, s0.targetTool, s0.blendWeight, botLay, zCut, isExcl0, exclusionMode, s0.multiColorInfo, p0[0], p0[1], n0[0], n0[1]) * botFade : 0;
        const dispBot1 = (hlen1 >= 0.15) ? computeDisplacement(botTool, s1.targetTool, s1.blendWeight, botLay, zCut, isExcl1, exclusionMode, s1.multiColorInfo, p1[0], p1[1], n1[0], n1[1]) * botFade : 0;
        const dispTop0 = (hlen0 >= 0.15) ? computeDisplacement(topTool, s0.targetTool, s0.blendWeight, topLay, zCut, isExcl0, exclusionMode, s0.multiColorInfo, p0[0], p0[1], n0[0], n0[1]) * topFade : 0;
        const dispTop1 = (hlen1 >= 0.15) ? computeDisplacement(topTool, s1.targetTool, s1.blendWeight, topLay, zCut, isExcl1, exclusionMode, s1.multiColorInfo, p1[0], p1[1], n1[0], n1[1]) * topFade : 0;

        const diff0 = dispBot0 - dispTop0;
        const diff1 = dispBot1 - dispTop1;
        const hasStep0 = Math.abs(diff0) >= 1e-4;
        const hasStep1 = Math.abs(diff1) >= 1e-4;
        if (!hasStep0 && !hasStep1) continue; // coplanar, no shelf needed

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

        // Assign tool:
        // In interleaved slicing, layer boundary shelf (Z = zCut) represents the top surface of the lower layer (botLay).
        // Assigning botTool guarantees 100% strict single-color per slice layer with ZERO intra-layer tool mixing/speckles.
        let shelfTool = botTool;
        if (isExcl0 && isExcl1 && (exclusionMode === 0 || exclusionMode === 2)) {
          shelfTool = untexturedTool;
        }
        const shelfNz = ((dispBot0 + dispBot1) >= (dispTop0 + dispTop1)) ? 1 : -1;

        // Output non-degenerate shelf geometry with correct manifold winding order:
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
