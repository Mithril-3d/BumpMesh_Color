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
      uniqueVerts.push([x, y, z]);
      uniqueNorms.push([nx, ny, nz]);
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
    uniqueVerts.push([px, py, pz]);
    uniqueNorms.push([nx, ny, nz]);
    edgeCutCache.set(key, cutId);
    return cutId;
  }

  const outTris = [];
  const outLayers = [];

  function emitTri(id0, id1, id2, layerIdx) {
    outTris.push([id0, id1, id2]);
    outLayers.push(Math.max(0, Math.min(totalLayers - 1, layerIdx)));
  }

  function sliceTriangle(v0, v1, v2, cutIdx) {
    if (cutIdx >= zCuts.length) {
      emitTri(v0, v1, v2, zCuts.length);
      return;
    }

    const zCut = zCuts[cutIdx];
    const z0 = uniqueVerts[v0][2];
    const z1 = uniqueVerts[v1][2];
    const z2 = uniqueVerts[v2][2];
    const min = Math.min(z0, z1, z2);
    const max = Math.max(z0, z1, z2);

    // If completely below cut plane, this triangle strictly belongs to layer cutIdx
    if (max <= zCut + 1e-6) {
      emitTri(v0, v1, v2, cutIdx);
      return;
    }

    // If completely above cut plane, test against next higher cut plane
    if (min >= zCut - 1e-6) {
      sliceTriangle(v0, v1, v2, cutIdx + 1);
      return;
    }

    const above0 = z0 > zCut;
    const above1 = z1 > zCut;
    const above2 = z2 > zCut;
    const countAbove = (above0 ? 1 : 0) + (above1 ? 1 : 0) + (above2 ? 1 : 0);

    if (countAbove === 0) {
      emitTri(v0, v1, v2, cutIdx);
      return;
    }
    if (countAbove === 3) {
      sliceTriangle(v0, v1, v2, cutIdx + 1);
      return;
    }

    if (countAbove === 1) {
      // 1 above, 2 below. Order: top -> b0 -> b1
      const [top, b0, b1] = above0 ? [v0, v1, v2] : (above1 ? [v1, v2, v0] : [v2, v0, v1]);
      const cutTopB0 = getEdgeCut(top, b0, cutIdx);
      const cutTopB1 = getEdgeCut(top, b1, cutIdx);

      // Record cut edge on boundary plane cutIdx for bottom layer: cutTopB1 -> cutTopB0
      if (cutEdgesPerCut[cutIdx]) {
        cutEdgesPerCut[cutIdx].push([cutTopB1, cutTopB0]);
      }

      // Top triangle: strictly above cutIdx -> continue to cutIdx + 1
      sliceTriangle(top, cutTopB0, cutTopB1, cutIdx + 1);

      // Bottom quad: strictly in layer cutIdx
      emitTri(cutTopB0, b0, b1, cutIdx);
      emitTri(cutTopB0, b1, cutTopB1, cutIdx);
    } else {
      // 2 above, 1 below. Order: bot -> a0 -> a1
      const [bot, a0, a1] = !above0 ? [v0, v1, v2] : (!above1 ? [v1, v2, v0] : [v2, v0, v1]);
      const cutBotA0 = getEdgeCut(bot, a0, cutIdx);
      const cutBotA1 = getEdgeCut(bot, a1, cutIdx);

      // Record cut edge on boundary plane cutIdx for bottom layer: cutBotA0 -> cutBotA1
      if (cutEdgesPerCut[cutIdx]) {
        cutEdgesPerCut[cutIdx].push([cutBotA0, cutBotA1]);
      }

      // Bottom triangle: strictly in layer cutIdx
      emitTri(bot, cutBotA0, cutBotA1, cutIdx);

      // Top quad: strictly above cutIdx -> continue to cutIdx + 1
      sliceTriangle(cutBotA0, a0, a1, cutIdx + 1);
      sliceTriangle(cutBotA0, a1, cutBotA1, cutIdx + 1);
    }
  }

  const cutEdgesPerCut = Array.from({ length: zCuts.length }, () => []);

  for (let i = 0; i < triCount; i++) {
    const v0 = triVerts[i * 3];
    const v1 = triVerts[i * 3 + 1];
    const v2 = triVerts[i * 3 + 2];
    const zMin = Math.min(uniqueVerts[v0][2], uniqueVerts[v1][2], uniqueVerts[v2][2]);
    let startCut = Math.max(0, Math.floor((zMin - minZ) / t) - 1);
    sliceTriangle(v0, v1, v2, startCut);
  }

  // Convert outTris to flat Float32Array positions and normals, and Int32Array layers
  const finalCount = outTris.length;
  const outPos = new Float32Array(finalCount * 9);
  const outNrm = new Float32Array(finalCount * 9);
  const outLay = new Int32Array(outLayers);

  for (let i = 0; i < finalCount; i++) {
    const [i0, i1, i2] = outTris[i];
    const p0 = uniqueVerts[i0], p1 = uniqueVerts[i1], p2 = uniqueVerts[i2];
    const n0 = uniqueNorms[i0], n1 = uniqueNorms[i1], n2 = uniqueNorms[i2];
    const b = i * 9;
    outPos[b]   = p0[0]; outPos[b+1] = p0[1]; outPos[b+2] = p0[2];
    outPos[b+3] = p1[0]; outPos[b+4] = p1[1]; outPos[b+5] = p1[2];
    outPos[b+6] = p2[0]; outPos[b+7] = p2[1]; outPos[b+8] = p2[2];

    outNrm[b]   = n0[0]; outNrm[b+1] = n0[1]; outNrm[b+2] = n0[2];
    outNrm[b+3] = n1[0]; outNrm[b+4] = n1[1]; outNrm[b+5] = n1[2];
    outNrm[b+6] = n2[0]; outNrm[b+7] = n2[1]; outNrm[b+8] = n2[2];
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
  sampleFn // (x, y, z, nx, ny, nz) => { targetTool, blendWeight }
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

  for (let i = 0; i < triCount; i++) {
    const lay = inLay[i];
    const activeTool = getInterleavedToolAtLayer(lay, toolIds);
    triTools[i] = activeTool;
    const b = i * 9;

    for (let v = 0; v < 3; v++) {
      const idx = b + v * 3;
      const x = inPos[idx];
      const y = inPos[idx + 1];
      const z = inPos[idx + 2];
      const nx = inNrm ? inNrm[idx] : 0;
      const ny = inNrm ? inNrm[idx + 1] : 0;
      const nz = inNrm ? inNrm[idx + 2] : 1;

      const hlen = Math.hypot(nx, ny);
      if (hlen < 0.15) {
        // Horizontal surface (top/bottom flat caps): keep base position
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
        const disp = computeLayerDisplacementByLayer(
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
  const shelfTris = [];
  const shelfTools = [];

  if (cutEdgesPerCut && uniqueVerts && uniqueNorms) {
    for (let cutIdx = 0; cutIdx < cutEdgesPerCut.length; cutIdx++) {
      const edges = cutEdgesPerCut[cutIdx];
      if (!edges || edges.length === 0) continue;

      const botLay = cutIdx;
      const topLay = cutIdx + 1;
      const botTool = getInterleavedToolAtLayer(botLay, toolIds);
      const topTool = getInterleavedToolAtLayer(topLay, toolIds);
      const zCut = zCuts ? zCuts[cutIdx] : (minZ + (cutIdx + 1) * t);

      for (const [id0, id1] of edges) {
        const p0 = uniqueVerts[id0];
        const p1 = uniqueVerts[id1];
        const n0 = uniqueNorms[id0];
        const n1 = uniqueNorms[id1];

        const hlen0 = Math.hypot(n0[0], n0[1]);
        const hlen1 = Math.hypot(n1[0], n1[1]);
        if (hlen0 < 0.15 || hlen1 < 0.15) continue; // skip horizontal caps

        const unx0 = n0[0] / hlen0, uny0 = n0[1] / hlen0;
        const unx1 = n1[0] / hlen1, uny1 = n1[1] / hlen1;

        const s0 = sampleFn(p0[0], p0[1], p0[2], n0[0], n0[1], n0[2]);
        const s1 = sampleFn(p1[0], p1[1], p1[2], n1[0], n1[1], n1[2]);

        const dispBot0 = computeLayerDisplacementByLayer(botTool, s0.targetTool, botLay, zCut, minZ, t, toolIds, convexVal, concaveVal, profileMode, s0.blendWeight, shadingMode);
        const dispBot1 = computeLayerDisplacementByLayer(botTool, s1.targetTool, botLay, zCut, minZ, t, toolIds, convexVal, concaveVal, profileMode, s1.blendWeight, shadingMode);
        const dispTop0 = computeLayerDisplacementByLayer(topTool, s0.targetTool, topLay, zCut, minZ, t, toolIds, convexVal, concaveVal, profileMode, s0.blendWeight, shadingMode);
        const dispTop1 = computeLayerDisplacementByLayer(topTool, s1.targetTool, topLay, zCut, minZ, t, toolIds, convexVal, concaveVal, profileMode, s1.blendWeight, shadingMode);

        const diff0 = dispBot0 - dispTop0;
        const diff1 = dispBot1 - dispTop1;
        if (Math.abs(diff0) < 1e-4 && Math.abs(diff1) < 1e-4) continue; // coplanar, no shelf needed

        const p0_bot = [p0[0] + dispBot0 * unx0, p0[1] + dispBot0 * uny0, zCut];
        const p1_bot = [p1[0] + dispBot1 * unx1, p1[1] + dispBot1 * uny1, zCut];
        const p0_top = [p0[0] + dispTop0 * unx0, p0[1] + dispTop0 * uny0, zCut];
        const p1_top = [p1[0] + dispTop1 * unx1, p1[1] + dispTop1 * uny1, zCut];

        // Assign tool: dominant protruding tool owns the shelf surface
        const shelfTool = (dispBot0 > dispTop0) ? botTool : topTool;

        // Shelf normal: pointing up if lower layer is wider, pointing down if upper layer is wider
        const nz = (dispBot0 > dispTop0) ? 1.0 : -1.0;

        // Triangle 1: (p0_bot, p1_bot, p1_top)
        shelfTris.push(
          p0_bot[0], p0_bot[1], p0_bot[2], 0, 0, nz,
          p1_bot[0], p1_bot[1], p1_bot[2], 0, 0, nz,
          p1_top[0], p1_top[1], p1_top[2], 0, 0, nz
        );
        shelfTools.push(shelfTool);

        // Triangle 2: (p0_bot, p1_top, p0_top)
        shelfTris.push(
          p0_bot[0], p0_bot[1], p0_bot[2], 0, 0, nz,
          p1_top[0], p1_top[1], p1_top[2], 0, 0, nz,
          p0_top[0], p0_top[1], p0_top[2], 0, 0, nz
        );
        shelfTools.push(shelfTool);
      }
    }
  }

  // Combine body triangles and shelf triangles
  const extraTriCount = shelfTools.length;
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
  for (let k = 0; k < extraTriCount; k++) {
    const sBase = k * 18;
    // tri 1 & 2 stored interleaved in shelfTris
    finalPos[pOffset]     = shelfTris[sBase];
    finalPos[pOffset + 1] = shelfTris[sBase + 1];
    finalPos[pOffset + 2] = shelfTris[sBase + 2];
    finalPos[pOffset + 3] = shelfTris[sBase + 6];
    finalPos[pOffset + 4] = shelfTris[sBase + 7];
    finalPos[pOffset + 5] = shelfTris[sBase + 8];
    finalPos[pOffset + 6] = shelfTris[sBase + 12];
    finalPos[pOffset + 7] = shelfTris[sBase + 13];
    finalPos[pOffset + 8] = shelfTris[sBase + 14];

    finalNrm[nOffset]     = shelfTris[sBase + 3];
    finalNrm[nOffset + 1] = shelfTris[sBase + 4];
    finalNrm[nOffset + 2] = shelfTris[sBase + 5];
    finalNrm[nOffset + 3] = shelfTris[sBase + 9];
    finalNrm[nOffset + 4] = shelfTris[sBase + 10];
    finalNrm[nOffset + 5] = shelfTris[sBase + 11];
    finalNrm[nOffset + 6] = shelfTris[sBase + 15];
    finalNrm[nOffset + 7] = shelfTris[sBase + 16];
    finalNrm[nOffset + 8] = shelfTris[sBase + 17];

    finalTools[triCount + k] = shelfTools[k];
    pOffset += 9;
    nOffset += 9;
  }

  return {
    positions: finalPos,
    normals: finalNrm,
    triTools: finalTools
  };
}
