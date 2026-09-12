/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import { zipSync, strToU8 } from 'fflate';
import { QuantizedPointMap } from './meshIndex.js';

/**
 * Trigger a browser download for a binary buffer.
 * @param {ArrayBuffer|Uint8Array} buffer
 * @param {string} filename
 * @param {string} [mime]
 */
function triggerDownload(buffer, filename, mime = 'application/octet-stream') {
  if (typeof document === 'undefined') return buffer;
  const blob = new Blob([buffer], { type: mime });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return buffer;
}

/**
 * Decode thumbnail base64 data URL to Uint8Array, with fallback minimal PNG
 * to ensure 3MF files always carry a valid thumbnail.
 */
function decodeThumbnail(dataUrl) {
  if (dataUrl && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/png;base64,')) {
    try {
      const b64 = dataUrl.slice('data:image/png;base64,'.length);
      const binStr = atob(b64);
      const bytes = new Uint8Array(binStr.length);
      for (let i = 0; i < binStr.length; i++) bytes[i] = binStr.charCodeAt(i);
      if (bytes.length > 0) return bytes;
    } catch (e) {
      console.warn('[decodeThumbnail] Failed to decode dataUrl:', e);
    }
  }

  // Fallback: 1x1 pixel valid PNG byte array
  // PNG signature + IHDR (1x1 RGBA) + IDAT + IEND
  return new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
    0x89, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x44, 0x41,
    0x54, 0x78, 0x9c, 0x63, 0x60, 0x60, 0x60, 0x00,
    0x00, 0x00, 0x04, 0x00, 0x01, 0x27, 0x34, 0x50,
    0x78, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
    0x44, 0xae, 0x42, 0x60, 0x82
  ]);
}

/**
 * Fast binary STL exporter — writes directly from BufferGeometry arrays.
 *
 * Eliminates Three.js STLExporter overhead:
 * - No Mesh/Material creation
 * - No identity matrix multiplication per vertex
 * - No redundant normal recomputation
 * - Bulk Uint8Array.set() instead of per-float DataView calls
 *
 * @param {THREE.BufferGeometry} geometry  – non-indexed with position + normal
 * @param {string} [filename]
 */
export function exportSTL(geometry, filename = 'textured.stl') {
  const posArr = geometry.attributes.position.array;
  const norArr = geometry.attributes.normal
    ? geometry.attributes.normal.array
    : null;
  const triCount = (posArr.length / 9) | 0;

  // Binary STL: 80-byte header + 4-byte tri count + 50 bytes per triangle
  const bufLen = 84 + 50 * triCount;
  const buffer = new ArrayBuffer(bufLen);
  const bytes  = new Uint8Array(buffer);
  const view   = new DataView(buffer);

  // Header: 80 bytes (already zero-filled)
  view.setUint32(80, triCount, true);

  // Reinterpret source arrays as raw bytes for bulk copy
  const posSrc = new Uint8Array(posArr.buffer, posArr.byteOffset, posArr.byteLength);
  const norSrc = norArr
    ? new Uint8Array(norArr.buffer, norArr.byteOffset, norArr.byteLength)
    : null;

  for (let i = 0; i < triCount; i++) {
    const dst    = 84 + i * 50;
    const srcOff = i * 36; // 9 floats * 4 bytes

    if (norSrc) {
      // Normal: copy first vertex normal (12 bytes) — flat shading, all 3 identical
      bytes.set(norSrc.subarray(srcOff, srcOff + 12), dst);
    } else {
      // Compute face normal from cross product
      const b = i * 9;
      const ux = posArr[b+3]-posArr[b], uy = posArr[b+4]-posArr[b+1], uz = posArr[b+5]-posArr[b+2];
      const vx = posArr[b+6]-posArr[b], vy = posArr[b+7]-posArr[b+1], vz = posArr[b+8]-posArr[b+2];
      const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz) || 1;
      view.setFloat32(dst,     nx/len, true);
      view.setFloat32(dst + 4, ny/len, true);
      view.setFloat32(dst + 8, nz/len, true);
    }

    // Vertices: 36 bytes (3 vertices * 3 floats * 4 bytes)
    bytes.set(posSrc.subarray(srcOff, srcOff + 36), dst + 12);

    // Attribute byte count: 0 (already zero-filled)
  }

  triggerDownload(buffer, filename);
}

/**
 * 3MF exporter — builds a ZIP-packaged XML mesh in the Microsoft 3D
 * Manufacturing core format (2015/02).
 *
 * Vertices are deduplicated (positions quantized to 4 decimals, i.e. 0.0001 mm
 * tolerance) so the output is both smaller than binary STL and round-trippable
 * by this project's own 3MF loader.
 *
 * @param {THREE.BufferGeometry} geometry  – non-indexed with position attribute
 * @param {string} [filename]
 */
export function export3MF(geometry, filename = 'textured.3mf', thumbnailDataUrl = null) {
  const posArr = geometry.attributes.position.array;
  const triCount = (posArr.length / 9) | 0;

  // ── Deduplicate vertices ─────────────────────────────────────────────────
  // Weld on the 1e4 grid (0.0001 mm cells), matching the 4-decimal precision
  // the coordinates are written with below — safely below the resolution of
  // any FDM/SLA printer and far tighter than float32 rounding noise from the
  // displacement pipeline. The pipeline snaps coordinates onto this exact
  // grid in resolveTJunctions before export, so welding here only merges
  // bit-identical (or grid-identical) points.
  const indexMap  = new QuantizedPointMap(1e4, Math.min(triCount * 3, 1 << 22));
  const uniqueXYZ = [];   // flat [x,y,z,x,y,z,...]
  const triIdx    = new Uint32Array(triCount * 3);

  for (let i = 0; i < triCount; i++) {
    for (let j = 0; j < 3; j++) {
      const b = i * 9 + j * 3;
      const x = Math.round(posArr[b] * 1e4) / 1e4;
      const y = Math.round(posArr[b + 1] * 1e4) / 1e4;
      const z = Math.round(posArr[b + 2] * 1e4) / 1e4;
      const idx = indexMap.getOrSet(x, y, z, uniqueXYZ.length / 3);
      if (indexMap.inserted) uniqueXYZ.push(x, y, z);
      triIdx[i * 3 + j] = idx;
    }
  }

  const vertCount = uniqueXYZ.length / 3;

  // ── Build 3dmodel.model XML as Uint8Array chunks ─────────────────────────
  // A single concatenated string would exceed V8's max-string-length limit
  // (~512 MiB) for meshes around 10M+ triangles, throwing "Invalid string
  // length".  Encode chunks to UTF-8 bytes as we go, flushing the small
  // staging string every ~1 MiB so it never grows large enough to trip the
  // limit.  Final concat is byte-wise (no string-length cap).
  const thumbBytes = decodeThumbnail(thumbnailDataUrl);
  const enc = new TextEncoder();
  const byteChunks = [];
  let totalBytes = 0;
  let pending = '';
  const FLUSH_THRESHOLD = 1 << 20; // 1 MiB

  function flush() {
    if (!pending) return;
    const b = enc.encode(pending);
    byteChunks.push(b);
    totalBytes += b.length;
    pending = '';
  }
  function emit(s) {
    pending += s;
    if (pending.length >= FLUSH_THRESHOLD) flush();
  }

  emit(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="en-US" ' +
    'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n' +
    '<metadata name="Application">BumpMesh Color</metadata>\n' +
    (thumbBytes ? '<metadata name="Thumbnail">/Metadata/thumbnail.png</metadata>\n' : '') +
    '<resources>\n' +
    '<object id="1" type="model">\n' +
    '<mesh>\n' +
    '<vertices>\n'
  );

  // Vertices: trim trailing zeros to keep the file compact.
  const fmt = (n) => {
    // 4 decimals matches the dedup precision; strip trailing zeros and ".".
    let s = n.toFixed(4);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  };
  for (let i = 0; i < vertCount; i++) {
    const b = i * 3;
    emit(
      '<vertex x="' + fmt(uniqueXYZ[b]) +
      '" y="'       + fmt(uniqueXYZ[b + 1]) +
      '" z="'       + fmt(uniqueXYZ[b + 2]) +
      '"/>\n'
    );
  }

  emit('</vertices>\n<triangles>\n');

  const seenFaces3mf = new Set();
  for (let i = 0; i < triCount; i++) {
    const b = i * 3;
    const v1 = triIdx[b], v2 = triIdx[b + 1], v3 = triIdx[b + 2];
    if (v1 === v2 || v2 === v3 || v1 === v3) continue;
    let lo = v1, mid = v2, hi = v3;
    if (lo > mid) { const t = lo; lo = mid; mid = t; }
    if (mid > hi) { const t = mid; mid = hi; hi = t; }
    if (lo > mid) { const t = lo; lo = mid; mid = t; }
    const faceKey = `${lo},${mid},${hi}`;
    if (seenFaces3mf.has(faceKey)) continue;
    seenFaces3mf.add(faceKey);

    emit(
      '<triangle v1="' + v1 +
      '" v2="'         + v2 +
      '" v3="'         + v3 +
      '"/>\n'
    );
  }

  emit(
    '</triangles>\n' +
    '</mesh>\n' +
    '</object>\n' +
    '</resources>\n' +
    '<build>\n<item objectid="1"/>\n</build>\n' +
    '</model>\n'
  );
  flush();

  const modelBytes = new Uint8Array(totalBytes);
  {
    let off = 0;
    for (const b of byteChunks) { modelBytes.set(b, off); off += b.length; }
  }

  // ── Static package files ─────────────────────────────────────────────────
  let contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n';
  if (thumbBytes) {
    contentTypesXml += '<Default Extension="png" ContentType="image/png"/>\n';
  }
  contentTypesXml += '</Types>\n';

  let relsXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '<Relationship Id="rel-1" Target="/3D/3dmodel.model" ' +
    'Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n';
  if (thumbBytes) {
    relsXml +=
      '<Relationship Id="rel-2" Target="/Metadata/plate_1.png" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n' +
      '<Relationship Id="rel-4" Target="/Metadata/plate_1.png" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>\n' +
      '<Relationship Id="rel-5" Target="/Metadata/plate_1_small.png" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>\n';
  }
  relsXml += '</Relationships>\n';

  // ── Zip and download ─────────────────────────────────────────────────────
  const zipFiles = {
    '[Content_Types].xml': strToU8(contentTypesXml),
    '_rels/.rels':         strToU8(relsXml),
    '3D/3dmodel.model':    modelBytes,
  };
  if (thumbBytes) {
    zipFiles['Metadata/thumbnail.png']     = thumbBytes;
    zipFiles['Metadata/plate_1.png']       = thumbBytes;
    zipFiles['Metadata/plate_1_small.png'] = thumbBytes;
  }

  const zipped = zipSync(zipFiles, { level: 6 });

  triggerDownload(
    zipped,
    filename,
    'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
  );
}

/**
 * Encode toolhead ID into the TriangleSelector nibble-packed serialization
 * required by PrusaSlicer (slic3rpe:mmu_segmentation) and Bambu Studio (paint_color).
 *
 * Leaf encoding for unsplit triangle (split = 0):
 *   Tool 1 -> '4'
 *   Tool 2 -> '8'
 *   Tool 3 -> '0C'
 *   Tool 4 -> '1C'
 *   Tool K -> (K - 3).toString(16).toUpperCase() + 'C'
 */
export function encodeTrianglePaint(toolId) {
  if (toolId <= 0) return '0';
  if (toolId === 1) return '4';
  if (toolId === 2) return '8';
  return (toolId - 3).toString(16).toUpperCase() + 'C';
}

/**
 * Multi-material 3MF exporter — builds a single watertight solid mesh with
 * per-triangle tool/color attributes (facet painting) compatible with PrusaSlicer,
 * Bambu Studio, and OrcaSlicer.
 *
 * Slicing a single watertight manifold guarantees:
 * - No "multipart object detected" prompt
 * - 0 open edges, 0 non-manifold warnings (1 unified solid shell)
 * - Perfect 1st-layer bed contact (no "nothing to extrude on first layer" error)
 * - Automatic tool changes and multi-color perimeters/infill
 *
 * @param {THREE.BufferGeometry} geometry - Displaced watertight solid mesh
 * @param {Int32Array|Array<number>} triTools - Tool ID (1..K) for each triangle
 * @param {Array<{ id: number, color: number[], hex: string, toolId: number }>} palette
 * @param {string} [filename]
 * @param {string} [thumbnailDataUrl]
 */
export function exportMultiColor3MF(geometry, triTools, palette, filename = 'textured_multicolor.3mf', thumbnailDataUrl = null) {
  const thumbBytes = decodeThumbnail(thumbnailDataUrl);
  const enc = new TextEncoder();
  const byteChunks = [];
  let totalBytes = 0;
  let pending = '';
  const FLUSH_THRESHOLD = 1 << 20;

  function flush() {
    if (!pending) return;
    const b = enc.encode(pending);
    byteChunks.push(b);
    totalBytes += b.length;
    pending = '';
  }
  function emit(s) {
    pending += s;
    if (pending.length >= FLUSH_THRESHOLD) flush();
  }

  const fmt = (n) => {
    let s = n.toFixed(4);
    if (s.indexOf('.') !== -1) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s;
  };

  const posArr = geometry.attributes.position.array;
  const triCount = (posArr.length / 9) | 0;

  // Build tool -> palette index mapping
  const toolToPalIndex = new Map();
  palette.forEach((p, idx) => {
    if (!toolToPalIndex.has(p.toolId)) {
      toolToPalIndex.set(p.toolId, idx);
    }
  });

  // Deduplicate vertices on a 1e4 grid (0.0001 mm) to form a continuous manifold
  const indexMap = new QuantizedPointMap(1e4, Math.min(triCount * 3, 1 << 22));
  const uniqueXYZ = [];
  const triIdx = new Uint32Array(triCount * 3);

  for (let i = 0; i < triCount; i++) {
    for (let j = 0; j < 3; j++) {
      const b = i * 9 + j * 3;
      const x = Math.round(posArr[b] * 1e4) / 1e4;
      const y = Math.round(posArr[b + 1] * 1e4) / 1e4;
      const z = Math.round(posArr[b + 2] * 1e4) / 1e4;
      const idx = indexMap.getOrSet(x, y, z, uniqueXYZ.length / 3);
      if (indexMap.inserted) uniqueXYZ.push(x, y, z);
      triIdx[i * 3 + j] = idx;
    }
  }

  const vertCount = uniqueXYZ.length / 3;

  emit(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<model unit="millimeter" xml:lang="en-US" ' +
    'xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" ' +
    'xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" ' +
    'xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">\n' +
    '<metadata name="Application">BumpMesh Color</metadata>\n' +
    (thumbBytes ? '<metadata name="Thumbnail">/Metadata/thumbnail.png</metadata>\n' : '') +
    '<resources>\n'
  );

  // 1. Color group (standard 3MF Material Extension with 8-char RGBA hex)
  emit('  <m:colorgroup id="1">\n');
  for (const item of palette) {
    const raw = item.hex.startsWith('#') ? item.hex.slice(1) : item.hex;
    const hex8 = '#' + raw.toUpperCase() + (raw.length === 6 ? 'FF' : '');
    emit(`    <m:color color="${hex8}"/>\n`);
  }
  emit('  </m:colorgroup>\n');

  // 2. Single watertight solid object with triangle material properties
  const rootObjectId = 1;
  emit(`  <object id="${rootObjectId}" type="model" name="BumpMesh_Color" pid="1" p1="0">\n`);
  emit('    <mesh>\n      <vertices>\n');

  for (let i = 0; i < vertCount; i++) {
    const b = i * 3;
    emit(`        <vertex x="${fmt(uniqueXYZ[b])}" y="${fmt(uniqueXYZ[b+1])}" z="${fmt(uniqueXYZ[b+2])}"/>\n`);
  }

  emit('      </vertices>\n      <triangles>\n');

  // Multi-material triangle classification with deduplication:
  const seenFacesMulti = new Set();
  for (let i = 0; i < triCount; i++) {
    const v1 = triIdx[i * 3];
    const v2 = triIdx[i * 3 + 1];
    const v3 = triIdx[i * 3 + 2];
    if (v1 === v2 || v2 === v3 || v3 === v1) continue;

    let lo = Math.min(v1, v2, v3);
    let hi = Math.max(v1, v2, v3);
    let mid = v1 + v2 + v3 - lo - hi;
    if (mid > hi) { const t = mid; mid = hi; hi = t; }
    if (lo > mid) { const t = lo; lo = mid; mid = t; }
    const faceKey = `${lo},${mid},${hi}`;
    if (seenFacesMulti.has(faceKey)) continue;
    seenFacesMulti.add(faceKey);

    const toolId = (triTools && triTools[i]) ? triTools[i] : 1;
    const palIdx = toolToPalIndex.get(toolId) ?? 0;
    const paintCode = encodeTrianglePaint(toolId);
    emit(
      `        <triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="1" p1="${palIdx}" slic3rpe:mmu_segmentation="${paintCode}" paint_color="${paintCode}"/>\n`
    );
  }

  emit('      </triangles>\n    </mesh>\n  </object>\n');

  emit(
    '</resources>\n' +
    '<build>\n' +
    `  <item objectid="${rootObjectId}"/>\n` +
    '</build>\n' +
    '</model>\n'
  );
  flush();

  const modelBytes = new Uint8Array(totalBytes);
  {
    let off = 0;
    for (const b of byteChunks) { modelBytes.set(b, off); off += b.length; }
  }

  // Bambu Studio & OrcaSlicer config
  const bambuConfigXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<config>\n' +
    `  <object id="${rootObjectId}">\n` +
    '    <metadata key="name" value="BumpMesh_Color"/>\n' +
    '  </object>\n' +
    '</config>\n';

  // PrusaSlicer config
  const prusaConfigXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<config>\n' +
    `  <object id="${rootObjectId}">\n` +
    '    <metadata key="name" value="BumpMesh_Color"/>\n' +
    '  </object>\n' +
    '</config>\n';

  // Static package files
  let contentTypesXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    '<Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
    '<Default Extension="config" ContentType="text/xml"/>\n';
  if (thumbBytes) {
    contentTypesXml += '<Default Extension="png" ContentType="image/png"/>\n';
  }
  contentTypesXml += '</Types>\n';

  let relsXml =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '<Relationship Id="rel-1" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' +
    '<Relationship Id="rel-2" Target="/Metadata/model_settings.config" Type="http://schemas.bambulab.com/package/2021/model_settings"/>\n' +
    '<Relationship Id="rel-3" Target="/Metadata/Slic3r_PE.config" Type="http://schemas.prusa3d.com/package/2020/model_settings"/>\n';
  if (thumbBytes) {
    relsXml +=
      '<Relationship Id="rel-4" Target="/Metadata/plate_1.png" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/thumbnail"/>\n' +
      '<Relationship Id="rel-5" Target="/Metadata/plate_1.png" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-middle"/>\n' +
      '<Relationship Id="rel-6" Target="/Metadata/plate_1_small.png" Type="http://schemas.bambulab.com/package/2021/cover-thumbnail-small"/>\n';
  }
  relsXml += '</Relationships>\n';

  const zipFiles = {
    '[Content_Types].xml':           strToU8(contentTypesXml),
    '_rels/.rels':                   strToU8(relsXml),
    '3D/3dmodel.model':              modelBytes,
    'Metadata/model_settings.config': strToU8(bambuConfigXml),
    'Metadata/Slic3r_PE.config':     strToU8(prusaConfigXml),
  };

  if (thumbBytes) {
    zipFiles['Metadata/thumbnail.png']     = thumbBytes;
    zipFiles['Metadata/plate_1.png']       = thumbBytes;
    zipFiles['Metadata/plate_1_small.png'] = thumbBytes;
  }

  const zipped = zipSync(zipFiles, { level: 6 });

  return triggerDownload(
    zipped,
    filename,
    'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
  );
}

