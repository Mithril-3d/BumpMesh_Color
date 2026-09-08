/*
 * Copyright (c) 2026 CNCKitchen and contributors
 * Mesh Partitioning by Tool / Color for Multi-Material Export
 */

import { THREE } from './threeCompat.js?v=20260908d';
import { computeUV } from './mapping.js?v=20260908d';
import { getToolAtUV } from './colorQuantization.js?v=20260908d';

/**
 * Partition a displaced BufferGeometry into sub-geometries by assigned tool (Extruder ID).
 *
 * @param {THREE.BufferGeometry} geometry - Non-indexed triangle soup
 * @param {ImageData} imageData           - Texture pixel data
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @param {object} settings               - Mapping settings (scale, offset, rot, etc.)
 * @param {object} bounds                 - { min, max, size, center }
 * @param {Array} palette                 - Quantized color palette with tool assignments
 * @returns {Map<number, THREE.BufferGeometry>} Map of toolId -> sub BufferGeometry
 */
/**
 * Partition a displaced BufferGeometry into sub-geometries by assigned tool (Extruder ID).
 *
 * @param {THREE.BufferGeometry} geometry - Non-indexed triangle soup
 * @param {ImageData} imageData           - Texture pixel data
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @param {object} settings               - Mapping settings (scale, offset, rot, etc.)
 * @param {object} bounds                 - { min, max, size, center }
 * @param {Array} palette                 - Quantized color palette with tool assignments
 * @param {number} [untexturedToolId=4]   - Tool ID to assign to untextured / masked regions
 * @param {Set|object} [excludedFaces=null]- Set of face indices excluded by user
 * @returns {Map<number, THREE.BufferGeometry>} Map of toolId -> sub BufferGeometry
 */
export function partitionMeshByTool(geometry, imageData, imgWidth, imgHeight, settings, bounds, palette, untexturedToolId = 4, excludedFaces = null) {
  const posArr = geometry.attributes.position.array;
  const norArr = geometry.attributes.normal ? geometry.attributes.normal.array : null;
  const faceMaskAttr = geometry.getAttribute('faceMask');
  const triCount = (posArr.length / 9) | 0;

  // Pre-calculate angle limits for masked face detection
  const hasBottomLimit = (settings.bottomAngleLimit ?? 0) > 0;
  const bottomLimitCos = hasBottomLimit ? Math.cos((settings.bottomAngleLimit) * Math.PI / 180) : 1.0;
  const hasTopLimit = (settings.topAngleLimit ?? 0) > 0;
  const topLimitCos = hasTopLimit ? Math.cos((settings.topAngleLimit) * Math.PI / 180) : 1.0;

  // Aspect ratio correction matching displacement.js
  const tmax = Math.max(imgWidth, imgHeight, 1);
  const aspectU = tmax / Math.max(imgWidth, 1);
  const aspectV = tmax / Math.max(imgHeight, 1);
  const settingsWithAspect = { ...settings, textureAspectU: aspectU, textureAspectV: aspectV };

  const tmpCentroid = new THREE.Vector3();
  const tmpNormal = new THREE.Vector3();

  // First pass: determine tool assignment for each triangle
  const triTool = new Int32Array(triCount);
  const toolTriCounts = new Map();

  for (let i = 0; i < triCount; i++) {
    const b = i * 9;
    const ax = posArr[b],   ay = posArr[b+1], az = posArr[b+2];
    const bx = posArr[b+3], by = posArr[b+4], bz = posArr[b+5];
    const cx = posArr[b+6], cy = posArr[b+7], cz = posArr[b+8];

    // Compute centroid
    tmpCentroid.set((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);

    // Compute normal
    if (norArr) {
      tmpNormal.set(norArr[b], norArr[b+1], norArr[b+2]);
    } else {
      const ux = bx - ax, uy = by - ay, uz = bz - az;
      const vx = cx - ax, vy = cy - ay, vz = cz - az;
      tmpNormal.set(uy*vz - uz*vy, uz*vx - ux*vz, ux*vy - uy*vx).normalize();
    }

    // Determine if this triangle is untextured / masked:
    let isMasked = false;

    // 1. Angle limits (bottom / top)
    if (hasBottomLimit && -tmpNormal.z >= bottomLimitCos - 1e-4) {
      isMasked = true;
    } else if (hasTopLimit && tmpNormal.z >= topLimitCos - 1e-4) {
      isMasked = true;
    }

    // 2. User excluded faces
    if (!isMasked && excludedFaces && excludedFaces.has && excludedFaces.has(i)) {
      isMasked = true;
    }

    // 3. faceMask attribute if present (0 = masked, 1 = textured)
    if (!isMasked && faceMaskAttr) {
      const m0 = faceMaskAttr.getX(i * 3);
      const m1 = faceMaskAttr.getX(i * 3 + 1);
      const m2 = faceMaskAttr.getX(i * 3 + 2);
      if ((m0 + m1 + m2) / 3 < 0.5) {
        isMasked = true;
      }
    }

    let toolId;
    if (isMasked) {
      // Assign the designated untextured tool
      toolId = untexturedToolId || 4;
    } else {
      // Compute UV at triangle centroid with correct argument signature
      const mode = settings.mappingMode ?? 5;
      const uvResult = computeUV(tmpCentroid, tmpNormal, mode, settingsWithAspect, bounds);
      let u = 0, v = 0;
      if (uvResult) {
        if (typeof uvResult.u === 'number') {
          u = uvResult.u;
          v = uvResult.v;
        } else if (Array.isArray(uvResult.samples) && uvResult.samples.length > 0) {
          // For triplanar/cubic, pick the dominant sample
          let maxW = -1;
          for (const s of uvResult.samples) {
            if (s.w > maxW) {
              maxW = s.w;
              u = s.u;
              v = s.v;
            }
          }
        }
      }

      // Query tool ID at this UV
      toolId = getToolAtUV(imageData.data, imgWidth, imgHeight, u, v, palette);
    }

    triTool[i] = toolId;
    toolTriCounts.set(toolId, (toolTriCounts.get(toolId) || 0) + 1);
  }

  // Second pass: allocate arrays and copy triangles for each tool
  const subGeometries = new Map();

  for (const [toolId, count] of toolTriCounts.entries()) {
    if (count === 0) continue;
    const subPos = new Float32Array(count * 9);
    const subNor = norArr ? new Float32Array(count * 9) : null;
    let dstIdx = 0;

    for (let i = 0; i < triCount; i++) {
      if (triTool[i] !== toolId) continue;
      const srcIdx = i * 9;
      subPos.set(posArr.subarray(srcIdx, srcIdx + 9), dstIdx);
      if (subNor && norArr) {
        subNor.set(norArr.subarray(srcIdx, srcIdx + 9), dstIdx);
      }
      dstIdx += 9;
    }

    const subGeom = new THREE.BufferGeometry();
    subGeom.setAttribute('position', new THREE.BufferAttribute(subPos, 3));
    if (subNor) {
      subGeom.setAttribute('normal', new THREE.BufferAttribute(subNor, 3));
    } else {
      subGeom.computeVertexNormals();
    }
    subGeom.userData = { toolId };
    subGeometries.set(toolId, subGeom);
  }

  return subGeometries;
}
