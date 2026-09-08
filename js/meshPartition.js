/*
 * Copyright (c) 2026 CNCKitchen and contributors
 * Mesh Partitioning by Tool / Color for Multi-Material Export
 */

import { THREE } from './threeCompat.js?v=20260908d';
import { computeUV } from './mapping.js?v=20260908d';
import { getToolAtUV } from './colorQuantization.js?v=20260908d';

/**
 * Check if 3D point p is within triangle abc (projected along normal n)
 */
function isPointInTri(p, a, b, c, n) {
  // Edge 0
  const ab = b.clone().sub(a);
  const ap = p.clone().sub(a);
  if (ab.cross(ap).dot(n) < -1e-2) return false;

  // Edge 1
  const bc = c.clone().sub(b);
  const bp = p.clone().sub(b);
  if (bc.cross(bp).dot(n) < -1e-2) return false;

  // Edge 2
  const ca = a.clone().sub(c);
  const cp = p.clone().sub(c);
  if (ca.cross(cp).dot(n) < -1e-2) return false;

  return true;
}

/**
 * Partition a displaced BufferGeometry into sub-geometries by assigned tool (Extruder ID).
 *
 * @param {THREE.BufferGeometry} geometry - Non-indexed triangle soup in WORKING SPACE
 * @param {ImageData} imageData           - Texture pixel data
 * @param {number} imgWidth
 * @param {number} imgHeight
 * @param {object} settings               - Mapping settings (scale, offset, rot, etc.)
 * @param {object} bounds                 - { min, max, size, center } in working space
 * @param {Array} palette                 - Quantized color palette with tool assignments
 * @param {number} [untexturedToolId=4]   - Tool ID to assign to untextured / masked regions
 * @param {Array} [excludedTriangles=null]- Array of {a, b, c, n, minX, maxX, ...} from original excluded faces
 * @returns {Map<number, THREE.BufferGeometry>} Map of toolId -> sub BufferGeometry
 */
export function partitionMeshByTool(geometry, imageData, imgWidth, imgHeight, settings, bounds, palette, untexturedToolId = 4, excludedTriangles = null) {
  const posArr = geometry.attributes.position.array;
  const norArr = geometry.attributes.normal ? geometry.attributes.normal.array : null;
  const faceMaskAttr = geometry.getAttribute('faceMask');
  const triCount = (posArr.length / 9) | 0;

  // Aspect ratio correction matching displacement.js
  const tmax = Math.max(imgWidth, imgHeight, 1);
  const aspectU = tmax / Math.max(imgWidth, 1);
  const aspectV = tmax / Math.max(imgHeight, 1);
  const settingsWithAspect = { ...settings, textureAspectU: aspectU, textureAspectV: aspectV };

  const tmpCentroid = new THREE.Vector3();
  const tmpNormal = new THREE.Vector3();
  const tmpEdge1 = new THREE.Vector3();
  const tmpEdge2 = new THREE.Vector3();

  // First pass: determine tool assignment for each triangle
  const triTool = new Int32Array(triCount);
  const toolTriCounts = new Map();

  const botLimit = settings.bottomAngleLimit ?? 0;
  const topLimit = settings.topAngleLimit ?? 0;

  for (let i = 0; i < triCount; i++) {
    const b = i * 9;
    const ax = posArr[b],   ay = posArr[b+1], az = posArr[b+2];
    const bx = posArr[b+3], by = posArr[b+4], bz = posArr[b+5];
    const cx = posArr[b+6], cy = posArr[b+7], cz = posArr[b+8];

    // Compute centroid
    tmpCentroid.set((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);

    // Compute face normal
    tmpEdge1.set(bx - ax, by - ay, bz - az);
    tmpEdge2.set(cx - ax, cy - ay, cz - az);
    tmpNormal.crossVectors(tmpEdge1, tmpEdge2).normalize();

    // Determine if this triangle is untextured / masked:
    let isMasked = false;

    // 1. Angle limits (matching shader and buildCombinedFaceWeights)
    // Surface angle is degree from vertical Z: 0 = flat horizontal facing up/down
    const faceNzNorm = tmpNormal.z;
    const faceAngle = Math.acos(Math.min(Math.max(Math.abs(faceNzNorm), 0), 1)) * (180 / Math.PI);
    if (faceNzNorm < 0) {
      if (botLimit >= 1.0 && faceAngle <= botLimit + 0.1) {
        isMasked = true;
      }
    } else {
      if (topLimit >= 1.0 && faceAngle <= topLimit + 0.1) {
        isMasked = true;
      }
    }

    // 2. User excluded faces check against original excluded triangles
    if (!isMasked && excludedTriangles && excludedTriangles.length > 0) {
      const px = tmpCentroid.x, py = tmpCentroid.y, pz = tmpCentroid.z;
      for (let k = 0; k < excludedTriangles.length; k++) {
        const t = excludedTriangles[k];
        if (px < t.minX || px > t.maxX || py < t.minY || py > t.maxY || pz < t.minZ || pz > t.maxZ) {
          continue;
        }
        // Check normal alignment
        if (tmpNormal.dot(t.n) < 0.85) continue;

        // Check distance to plane
        const distToPlane = Math.abs(tmpNormal.dot(tmpCentroid) - t.planeD);
        if (distToPlane > 0.4) continue;

        // Check if centroid is within triangle
        if (isPointInTri(tmpCentroid, t.a, t.b, t.c, t.n)) {
          isMasked = true;
          break;
        }
      }
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
      // Compute UV at triangle centroid in working space
      const mode = settings.mappingMode ?? 5;
      const uvResult = computeUV(tmpCentroid, tmpNormal, mode, settingsWithAspect, bounds);
      let u = 0, v = 0;
      if (uvResult) {
        if (typeof uvResult.u === 'number') {
          u = uvResult.u;
          v = uvResult.v;
        } else if (Array.isArray(uvResult.samples) && uvResult.samples.length > 0) {
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
  // Sort tools so Map iteration is always in ascending order
  const subGeometries = new Map();
  const sortedToolIds = Array.from(toolTriCounts.keys()).sort((a, b) => a - b);

  for (const toolId of sortedToolIds) {
    const count = toolTriCounts.get(toolId) || 0;
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

    const subGeo = new THREE.BufferGeometry();
    subGeo.setAttribute('position', new THREE.BufferAttribute(subPos, 3));
    if (subNor) {
      subGeo.setAttribute('normal', new THREE.BufferAttribute(subNor, 3));
    }
    subGeometries.set(toolId, subGeo);
  }

  return subGeometries;
}
