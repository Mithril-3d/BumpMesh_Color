/*
 * Copyright (c) 2026 CNCKitchen and contributors
 * Mesh Tool Assignment & Partitioning for Multi-Material Export
 */

import { THREE } from './threeCompat.js?v=20260908d';
import { computeUV } from './mapping.js?v=20260908d';
import { getToolAtUV } from './colorQuantization.js?v=20260908d';
import { getLayerIndex, getInterleavedToolAtLayer } from './layerBlending.js?v=20260908d';

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
 * Assign a tool ID to every triangle in the geometry (without slicing/splitting the mesh).
 * Returns Int32Array of length triCount where each element is toolId (1..K).
 * This guarantees the exported 3MF remains a 100% watertight, single-solid manifold.
 */
export function assignToolsToTriangles(
  geometry,
  imageData,
  imgWidth,
  imgHeight,
  settings,
  bounds,
  palette,
  untexturedToolId = 4,
  excludedTriangles = null,
  layerBlendLayers = null
) {
  const posArr = geometry.attributes.position.array;
  const faceMaskAttr = geometry.getAttribute('faceMask');
  const triCount = (posArr.length / 9) | 0;

  const tmax = Math.max(imgWidth, imgHeight, 1);
  const aspectU = tmax / Math.max(imgWidth, 1);
  const aspectV = tmax / Math.max(imgHeight, 1);
  const settingsWithAspect = { ...settings, textureAspectU: aspectU, textureAspectV: aspectV };

  const tmpCentroid = new THREE.Vector3();
  const tmpNormal = new THREE.Vector3();
  const tmpEdge1 = new THREE.Vector3();
  const tmpEdge2 = new THREE.Vector3();

  const triTool = new Int32Array(triCount);
  const botLimit = settings.bottomAngleLimit ?? 0;
  const topLimit = settings.topAngleLimit ?? 0;
  const isLayerBlend = (settings.colorSubMode === 1);
  const amplitude = settings.amplitude ?? 1.0;

  for (let i = 0; i < triCount; i++) {
    const b = i * 9;
    const ax = posArr[b],   ay = posArr[b+1], az = posArr[b+2];
    const bx = posArr[b+3], by = posArr[b+4], bz = posArr[b+5];
    const cx = posArr[b+6], cy = posArr[b+7], cz = posArr[b+8];

    tmpCentroid.set((ax + bx + cx) / 3, (ay + by + cy) / 3, (az + bz + cz) / 3);
    tmpEdge1.set(bx - ax, by - ay, bz - az);
    tmpEdge2.set(cx - ax, cy - ay, cz - az);
    tmpNormal.crossVectors(tmpEdge1, tmpEdge2).normalize();

    let isMasked = false;

    // 1. Angle limits
    const faceNzNorm = tmpNormal.z;
    const faceAngle = Math.acos(Math.min(Math.max(Math.abs(faceNzNorm), 0), 1)) * (180 / Math.PI);
    if (faceNzNorm < 0) {
      if (botLimit >= 1.0 && faceAngle <= botLimit + 0.1) isMasked = true;
    } else {
      if (topLimit >= 1.0 && faceAngle <= topLimit + 0.1) isMasked = true;
    }

    // 2. User excluded faces
    if (!isMasked && excludedTriangles && excludedTriangles.length > 0) {
      const px = tmpCentroid.x, py = tmpCentroid.y, pz = tmpCentroid.z;
      for (let k = 0; k < excludedTriangles.length; k++) {
        const t = excludedTriangles[k];
        if (px < t.minX || px > t.maxX || py < t.minY || py > t.maxY || pz < t.minZ || pz > t.maxZ) continue;
        if (tmpNormal.dot(t.n) < 0.85) continue;
        if (Math.abs(tmpNormal.dot(tmpCentroid) - t.planeD) > 0.4) continue;
        if (isPointInTri(tmpCentroid, t.a, t.b, t.c, t.n)) {
          isMasked = true;
          break;
        }
      }
    }

    // 3. faceMask attribute
    if (!isMasked && faceMaskAttr) {
      const m0 = faceMaskAttr.getX(i * 3);
      const m1 = faceMaskAttr.getX(i * 3 + 1);
      const m2 = faceMaskAttr.getX(i * 3 + 2);
      if ((m0 + m1 + m2) / 3 < 0.5) isMasked = true;
    }

    let toolId;
    if (isMasked) {
      toolId = untexturedToolId || 4;
    } else {
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

      if (isLayerBlend) {
        const minZ = bounds ? bounds.min.z : 0;
        const thickness = settings.interleavedThickness || 0.20;
        const toolIds = settings.interleavedToolIds || (palette && palette.length > 0 ? palette.map(p => p.toolId) : [1, 2]);
        const layerIdx = getLayerIndex(tmpCentroid.z, minZ, thickness);
        toolId = getInterleavedToolAtLayer(layerIdx, toolIds);
      } else {
        toolId = getToolAtUV(imageData.data, imgWidth, imgHeight, u, v, palette);
      }
    }
    triTool[i] = toolId;
  }
  return triTool;
}
