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

      // Bottom triangle: strictly in layer cutIdx
      emitTri(bot, cutBotA0, cutBotA1, cutIdx);

      // Top quad: strictly above cutIdx -> continue to cutIdx + 1
      sliceTriangle(cutBotA0, a0, a1, cutIdx + 1);
      sliceTriangle(cutBotA0, a1, cutBotA1, cutIdx + 1);
    }
  }

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

  return { positions: outPos, normals: outNrm, layers: outLay };
}
