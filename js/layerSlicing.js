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

export function sliceMeshWatertight(positions, normals, minZ, thickness, totalLayers) {
  const t = Math.max(0.01, thickness);
  const zCuts = [];
  for (let k = 1; k < totalLayers; k++) {
    zCuts.push(minZ + k * t);
  }
  if (zCuts.length === 0) {
    return { positions, normals };
  }

  const QUANT = 1e5; // 10 um quantization for vertex dedup
  const triCount = (positions.length / 9) | 0;

  // Step 1: Dedup original vertices to integer IDs
  const vertMap = new Map();
  const uniqueVerts = []; // id -> [x, y, z]
  const uniqueNorms = []; // id -> [nx, ny, nz]
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
    edgeCutCache.set(key, cutId);
    return cutId;
  }

  const CHUNK_SIZE = 131072; // 128K triangles per chunk to avoid millions of small Array allocations
  const triChunks = [];
  const layerChunks = [];
  let curTriChunk = new Int32Array(CHUNK_SIZE * 3);
  let curLayerChunk = new Int32Array(CHUNK_SIZE);
  let chunkCount = 0;
  let totalTriangles = 0;

  function emitTri(id0, id1, id2, layerIdx) {
    if (chunkCount >= CHUNK_SIZE) {
      triChunks.push(curTriChunk);
      layerChunks.push(curLayerChunk);
      curTriChunk = new Int32Array(CHUNK_SIZE * 3);
      curLayerChunk = new Int32Array(CHUNK_SIZE);
      chunkCount = 0;
    }
    const b = chunkCount * 3;
    curTriChunk[b]     = id0;
    curTriChunk[b + 1] = id1;
    curTriChunk[b + 2] = id2;
    curLayerChunk[chunkCount] = Math.max(0, Math.min(totalLayers - 1, layerIdx));
    chunkCount++;
    totalTriangles++;
  }

  const cutEdgesPerCut = Array.from({ length: zCuts.length }, () => []);

  // Direct polygon-clipping slicer: clips triangles strictly against layer boundary planes
  // in sequential order. Guarantees O(K) complexity instead of exponential O(2^K) subdivision tree explosion,
  // eliminating millions of redundant slivers while preserving 100% watertight topology with zero open edges.
  for (let tIdx = 0; tIdx < triCount; tIdx++) {
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
      emitTri(v0, v1, v2, startCut);
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

        if (curBelow) below.push(curId);
        else above.push(curId);

        if (curBelow !== nextBelow) {
          const interId = getEdgeCut(curId, nextId, cutIdx);
          below.push(interId);
          above.push(interId);

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
          emitTri(below[0], below[j], below[j + 1], cutIdx);
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
        emitTri(poly[0], poly[j], poly[j + 1], endCut);
      }
    }
  }

  if (chunkCount > 0) {
    triChunks.push(curTriChunk.subarray(0, chunkCount * 3));
    layerChunks.push(curLayerChunk.subarray(0, chunkCount));
  }

  // Convert chunk stores to flat Float32Array positions and normals, and Int32Array layers
  const outPos = new Float32Array(totalTriangles * 9);
  const outNrm = new Float32Array(totalTriangles * 9);
  const outLay = new Int32Array(totalTriangles);

  let triOffset = 0;
  for (let c = 0; c < triChunks.length; c++) {
    const tChunk = triChunks[c];
    const lChunk = layerChunks[c];
    const count = lChunk.length;

    outLay.set(lChunk, triOffset);

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
  shadingMode
) {
  // Mode 0: Step (discrete 0 / 1)
  if (shadingMode === 0) {
    const isMatch = (activeTool === targetToolId);
    if (profileMode === 0 || !isMatch) {
      return isMatch ? convexVal : -concaveVal;
    }
    const zFrac = Math.max(0, Math.min(1, (z - (minZ + lay * t)) / t));
    const slope = Math.min(convexVal, t);
    const base = Math.max(0, convexVal - slope);
    return base + zFrac * slope;
  }

  // Mode 1: Gradient (continuous exposure ratio)
  let ratio = 0.0;
  if (toolIds.length >= 2) {
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

  const effAmp = convexVal * ratio;
  if (profileMode === 0) {
    return effAmp;
  }

  const zFrac = Math.max(0, Math.min(1, (z - (minZ + lay * t)) / t));
  const slope = Math.min(effAmp, t);
  const base = Math.max(0, effAmp - slope);
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
  untexturedTool = 1
) {
  const { positions: inPos, normals: inNrm, layers: inLay, cutEdgesPerCut, uniqueVerts, uniqueNorms, zCuts } = sliced;
  const triCount = inLay.length;
  const t = Math.max(0.01, thickness);

  // 1. Displace every base sliced triangle strictly for its layer's active tool
  const outPosList = [new Float32Array(triCount * 9)];
  const outNrmList = [new Float32Array(triCount * 9)];
  const outPos = outPosList[0];
  const outNrm = outNrmList[0];
  const triTools = new Int32Array(triCount);

  // Determine model vertical bounds to identify pristine top and bottom cap rims
  let modelMinZ = Infinity, modelMaxZ = -Infinity;
  for (let i = 2; i < inPos.length; i += 3) {
    const z = inPos[i];
    if (z < modelMinZ) modelMinZ = z;
    if (z > modelMaxZ) modelMaxZ = z;
  }

  // Smooth fadeout distance near top and bottom caps (approx 4-5 layers)
  // Ensures C1-smooth convergence to original cylinder contour, completely eliminating
  // overhang overhangs, gap-fill infill combs, and boundary rim open edges.
  const fadeDist = Math.max(t * 4, 0.8);

  function getFade(zVal) {
    if (zVal >= modelMaxZ - 1e-4 || zVal <= modelMinZ + 1e-4) return 0;
    let u = 1.0;
    if (zVal > modelMaxZ - fadeDist) {
      u = (modelMaxZ - zVal) / fadeDist;
    } else if (zVal < modelMinZ + fadeDist) {
      u = (zVal - modelMinZ) / fadeDist;
    } else {
      return 1.0;
    }
    u = Math.max(0, Math.min(1, u));
    return u * u * (3 - 2 * u); // Smoothstep for C1-continuous transition
  }

  for (let i = 0; i < triCount; i++) {
    const lay = inLay[i];
    const activeTool = getInterleavedToolAtLayer(lay, toolIds);
    const b = i * 9;

    // Compute average face normal to detect horizontal caps
    let avgNx = (inNrm ? (inNrm[b] + inNrm[b+3] + inNrm[b+6]) : 0) / 3;
    let avgNy = (inNrm ? (inNrm[b+1] + inNrm[b+4] + inNrm[b+7]) : 0) / 3;
    let avgNz = (inNrm ? (inNrm[b+2] + inNrm[b+5] + inNrm[b+8]) : 1) / 3;
    const avgLen = Math.hypot(avgNx, avgNy, avgNz) || 1;
    avgNx /= avgLen; avgNy /= avgLen; avgNz /= avgLen;
    const avgHlen = Math.hypot(avgNx, avgNy);

    // Horizontal surfaces (top/bottom flat caps) receive untexturedTool
    // so no displacement or interleaved color is applied
    const isHorizontalCap = avgHlen < 0.15;
    triTools[i] = isHorizontalCap ? untexturedTool : activeTool;

    for (let v = 0; v < 3; v++) {
      const idx = b + v * 3;
      const x = inPos[idx];
      const y = inPos[idx + 1];
      const z = inPos[idx + 2];
      const nx = inNrm ? inNrm[idx] : 0;
      const ny = inNrm ? inNrm[idx + 1] : 0;
      const nz = inNrm ? inNrm[idx + 2] : 1;

      const hlen = Math.hypot(nx, ny);
      const fade = getFade(z);

      if (hlen < 0.15 || isHorizontalCap || fade <= 1e-6) {
        // Horizontal surface (top/bottom flat caps and boundary rim): keep pristine base position
        outPos[idx]     = x;
        outPos[idx + 1] = y;
        outPos[idx + 2] = z;
        outNrm[idx]     = nx;
        outNrm[idx + 1] = ny;
        outNrm[idx + 2] = nz;
      } else {
        // Vertical/perimeter sidewall: apply exact displacement from base
        const unx = nx / hlen;
        const uny = ny / hlen;

        const { targetTool, blendWeight } = sampleFn(x, y, z, nx, ny, nz);

        // Compute displacement strictly for this layer and its active tool
        let disp = computeLayerDisplacementByLayer(
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
          shadingMode
        );
        disp *= fade;

        outPos[idx]     = x + disp * unx;
        outPos[idx + 1] = y + disp * uny;
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

      const shelfFade = getFade(zCut);
      if (shelfFade <= 1e-6) continue; // Boundary rim is pristine cylinder; no shelf needed

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

        const dispBot0 = (hlen0 >= 0.15) ? computeLayerDisplacementByLayer(botTool, s0.targetTool, botLay, zCut, minZ, t, toolIds, convexVal, concaveVal, profileMode, s0.blendWeight, shadingMode) * shelfFade : 0;
        const dispBot1 = (hlen1 >= 0.15) ? computeLayerDisplacementByLayer(botTool, s1.targetTool, botLay, zCut, minZ, t, toolIds, convexVal, concaveVal, profileMode, s1.blendWeight, shadingMode) * shelfFade : 0;
        const dispTop0 = (hlen0 >= 0.15) ? computeLayerDisplacementByLayer(topTool, s0.targetTool, topLay, zCut, minZ, t, toolIds, convexVal, concaveVal, profileMode, s0.blendWeight, shadingMode) * shelfFade : 0;
        const dispTop1 = (hlen1 >= 0.15) ? computeLayerDisplacementByLayer(topTool, s1.targetTool, topLay, zCut, minZ, t, toolIds, convexVal, concaveVal, profileMode, s1.blendWeight, shadingMode) * shelfFade : 0;

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

        // Assign tool: dominant protruding tool owns the shelf surface
        const shelfTool = ((dispBot0 + dispBot1) > (dispTop0 + dispTop1)) ? botTool : topTool;
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
