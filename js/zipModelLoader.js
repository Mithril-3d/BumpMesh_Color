/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 */

import * as THREE from 'three';
import { unzipSync, strFromU8 } from 'fflate';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { setupGeometry, computeBounds, mergeGroupGeometries, parse3MF } from './stlLoader.js';

const objLoader = new OBJLoader();
const stlLoader = new STLLoader();

/**
 * Parses a zipped 3D model archive (.zip) containing model files (OBJ, DAE, 3MF, STL)
 * and associated texture images (PNG, JPG, WebP).
 *
 * @param {File|Blob} file
 * @param {Object} [opts]
 * @returns {Promise<{geometry: THREE.BufferGeometry, bounds: Object, nanCount: number, degenerateCount: number, originOffset: THREE.Vector3, textureEntry: Object|null, modelName: string}>}
 */
export async function loadZipModelFile(file, opts = {}) {
  const arrayBuffer = await file.arrayBuffer();
  const unzipped = unzipSync(new Uint8Array(arrayBuffer));
  const fileNames = Object.keys(unzipped).filter(k => !k.endsWith('/'));

  if (fileNames.length === 0) {
    throw new Error('Zip archive is empty or contains only directories');
  }

  // 1. Identify 3D model candidates and images
  const modelCandidates = fileNames.filter(f => /\.(obj|dae|3mf|stl|gltf|glb)$/i.test(f));
  if (modelCandidates.length === 0) {
    throw new Error('No 3D model found in zip archive (supported: OBJ, DAE, 3MF, STL)');
  }

  // Model selection priority: OBJ is most stable & standard; otherwise largest model file
  const objs = modelCandidates.filter(f => /\.obj$/i.test(f));
  let selectedModel;
  if (objs.length > 0 && (unzipped[objs[0]].length > 10000 || modelCandidates.length === 1)) {
    // Pick largest OBJ if multiple
    objs.sort((a, b) => unzipped[b].length - unzipped[a].length);
    selectedModel = objs[0];
  } else {
    // Pick largest model among all formats (e.g. main character DAE vs tiny accessory DAE)
    modelCandidates.sort((a, b) => unzipped[b].length - unzipped[a].length);
    selectedModel = modelCandidates[0];
  }

  const imgFiles = fileNames.filter(f => /\.(png|jpe?g|webp|bmp)$/i.test(f));
  const mtlFiles = fileNames.filter(f => /\.mtl$/i.test(f));

  // 2. Identify diffuse/color texture
  let matchedTexFile = null;

  // Strategy A: Parse MTL map_Kd
  for (const mtlPath of mtlFiles) {
    try {
      const mtlText = strFromU8(unzipped[mtlPath]);
      const m = mtlText.match(/map_Kd\s+([^\r\n]+)/i);
      if (m) {
        const texName = m[1].trim().replace(/^.*[\\\/]/, '').toLowerCase();
        const found = imgFiles.find(f => f.replace(/^.*[\\\/]/, '').toLowerCase() === texName);
        if (found) {
          matchedTexFile = found;
          break;
        }
      }
    } catch { /* ignore mtl decode error */ }
  }

  // Strategy B: Name heuristics & file size ranking
  if (!matchedTexFile && imgFiles.length > 0) {
    const scoreImage = (path) => {
      const lower = path.toLowerCase();
      let s = 0;
      if (lower.includes('diffuse') || lower.includes('_diff_') || lower.includes('_diff.') || lower.includes('_tex') || lower.includes('_co.') || lower.includes('_co_') || lower.includes('_d.') || lower.includes('_d_')) s += 60;
      if (lower.includes('body') || lower.includes('main') || lower.includes('color') || lower.includes('colour') || lower.includes('albedo')) s += 30;
      if (lower.includes('ao') || lower.includes('alpha') || lower.includes('normal') || lower.includes('norm') || lower.includes('spm') || lower.includes('spec') || lower.includes('metal') || lower.includes('rough') || lower.includes('lightmap') || lower.includes('shadow') || lower.includes('ramp')) s -= 50;
      // Bonus for file size (main high-res texture is usually largest)
      s += unzipped[path].length / 100000;
      return s;
    };
    imgFiles.sort((a, b) => scoreImage(b) - scoreImage(a));
    matchedTexFile = imgFiles[0];
  }

  // 3. Parse model geometry
  const modelBytes = unzipped[selectedModel];
  const modelExt = selectedModel.split('.').pop().toLowerCase();
  let geometry = null;

  if (modelExt === 'obj') {
    const objText = strFromU8(modelBytes);
    const group = objLoader.parse(objText);
    geometry = mergeGroupGeometries(group);
  } else if (modelExt === 'dae') {
    // Dynamic import Three.js ColladaLoader
    const { ColladaLoader } = await import('three/addons/loaders/ColladaLoader.js');
    const daeLoader = new ColladaLoader();
    const daeText = strFromU8(modelBytes);
    const collada = daeLoader.parse(daeText);
    geometry = mergeGroupGeometries(collada.scene);
  } else if (modelExt === '3mf') {
    geometry = parse3MF(modelBytes);
  } else if (modelExt === 'stl') {
    const ab = modelBytes.buffer.slice(modelBytes.byteOffset, modelBytes.byteOffset + modelBytes.byteLength);
    geometry = stlLoader.parse(ab);
  } else {
    throw new Error(`Unsupported model format inside zip: .${modelExt}`);
  }

  if (!geometry) {
    throw new Error('Failed to extract valid mesh geometry from model file in zip');
  }

  const { nanCount, degenerateCount, originOffset } = setupGeometry(geometry);
  const bounds = computeBounds(geometry);

  // 4. Build texture entry if image was matched
  let textureEntry = null;
  if (matchedTexFile) {
    try {
      const imgBytes = unzipped[matchedTexFile];
      const imgExt = matchedTexFile.split('.').pop().toLowerCase();
      const mime = (imgExt === 'jpg' || imgExt === 'jpeg') ? 'image/jpeg' : (imgExt === 'webp' ? 'image/webp' : 'image/png');
      const blob = new Blob([imgBytes], { type: mime });
      const imgUrl = URL.createObjectURL(blob);

      const img = new Image();
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('Failed to decode image from zip'));
        img.src = imgUrl;
      });
      URL.revokeObjectURL(imgUrl);

      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imgData = ctx.getImageData(0, 0, img.width, img.height);

      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = THREE.RepeatWrapping;
      texture.wrapT = THREE.RepeatWrapping;
      const baseTexName = matchedTexFile.replace(/^.*[\\\/]/, '');
      texture.name = baseTexName;

      textureEntry = {
        name: baseTexName,
        fullCanvas: canvas,
        texture,
        imageData: imgData,
        width: img.width,
        height: img.height,
        isCustom: true
      };
    } catch (err) {
      console.warn('Failed to load matched texture from zip:', err);
      textureEntry = null;
    }
  }

  const cleanModelName = selectedModel.replace(/^.*[\\\/]/, '').replace(/\.[^.]+$/, '');

  return {
    geometry,
    bounds,
    nanCount,
    degenerateCount,
    originOffset,
    textureEntry,
    modelName: cleanModelName
  };
}
