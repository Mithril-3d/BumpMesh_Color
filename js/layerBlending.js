/*
 * Copyright (c) 2026 CNCKitchen and contributors
 * Interleaved Layer Blending (交互積層マルチツール振り重ね)
 *
 * Each layer of thickness `t` alternates tools (e.g. Tool 1 -> Tool 2 -> Tool 1...).
 * On regions matching the layer's tool, the layer is convex (+amp).
 * On non-matching regions, the layer is concave (-amp or 0).
 */

/**
 * Get layer index from Z height
 * @param {number} z - current Z coordinate (mm)
 * @param {number} minZ - base/bottom Z of model (mm)
 * @param {number} thickness - layer thickness (e.g. 0.2 mm)
 * @returns {number} 0-based layer index
 */
export function getLayerIndex(z, minZ = 0, thickness = 0.2) {
  const t = Math.max(0.01, thickness);
  return Math.max(0, Math.floor((z - minZ) / t));
}

/**
 * Get active tool for a given layer index
 * @param {number} layerIndex - 0-based layer index
 * @param {Array<number>} toolIds - list of tool IDs (e.g. [1, 2])
 * @returns {number} active toolId
 */
export function getInterleavedToolAtLayer(layerIndex, toolIds = [1, 2]) {
  if (!toolIds || toolIds.length === 0) return 1;
  const idx = Math.abs(layerIndex) % toolIds.length;
  return toolIds[idx];
}

/**
 * Compute displacement for a point on an interleaved layer
 *
 * @param {number} targetToolId - the target tool desired by the texture at this point
 * @param {number} layerIndex - current slice layer
 * @param {Array<number>} toolIds - all participating tool IDs
 * @param {number} convexAmp - displacement when matching target (positive, e.g. 0.3)
 * @param {number} concaveAmp - displacement when non-matching (negative or 0, e.g. -0.1)
 * @returns {{ displacement: number, isConvex: boolean, activeTool: number }}
 */
export function computeInterleavedDisplacement(
  targetToolId,
  layerIndex,
  toolIds = [1, 2],
  convexAmp = 0.3,
  concaveAmp = 0.0
) {
  const activeTool = getInterleavedToolAtLayer(layerIndex, toolIds);
  const isMatch = (activeTool === targetToolId);
  return {
    displacement: isMatch ? convexAmp : -concaveAmp,
    isConvex: isMatch,
    activeTool: activeTool
  };
}

/**
 * Compute continuous blend weight (0.0 to 1.0) of a color along the line between colorA and colorB in RGB space.
 * 1.0 means 100% colorA, 0.0 means 100% colorB.
 *
 * @param {Array<number>} rgb - [r, g, b] (0..255)
 * @param {Array<number>} colorA - [r, g, b] (0..255)
 * @param {Array<number>} colorB - [r, g, b] (0..255)
 * @returns {number} weight of colorA (0.0..1.0)
 */
export function computeColorBlendWeight(rgb, colorA = [255, 255, 255], colorB = [0, 0, 0]) {
  const dr = colorB[0] - colorA[0];
  const dg = colorB[1] - colorA[1];
  const db = colorB[2] - colorA[2];
  const lenSq = dr * dr + dg * dg + db * db;

  if (lenSq < 1e-4) {
    const lum = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255;
    return Math.max(0, Math.min(1, lum));
  }

  const pr = rgb[0] - colorA[0];
  const pg = rgb[1] - colorA[1];
  const pb = rgb[2] - colorA[2];
  const t = (pr * dr + pg * dg + pb * db) / lenSq;

  return Math.max(0, Math.min(1, 1.0 - t));
}

/**
 * Compute louver (shingle/eaves) displacement with 45-degree overhang shield
 *
 * @param {number} targetToolId - target tool from texture UV
 * @param {number} z - absolute Z height (mm)
 * @param {number} minZ - base Z (mm)
 * @param {number} thickness - layer thickness (mm, e.g. 0.2)
 * @param {Array<number>} toolIds - list of participating tool IDs
 * @param {number} convexAmp - maximum protrusion (mm, e.g. 0.35)
 * @param {number} concaveAmp - retraction for non-matching (mm, e.g. 0.0)
 * @param {number} profileMode - 0 = Flat, 1 = Louver 45°
 * @param {number} blendWeight - 0.0..1.0 ratio (1.0 = 100% Tool 1, 0.0 = 100% Tool 2)
 * @param {number} shadingMode - 0 = Step (discrete), 1 = Gradient (continuous)
 * @returns {number} displacement (mm)
 */
export function computeLouverDisplacement(
  targetToolId,
  z,
  minZ = 0,
  thickness = 0.2,
  toolIds = [1, 2],
  convexAmp = 0.35,
  concaveAmp = 0.0,
  profileMode = 1,
  blendWeight = 1.0,
  shadingMode = 0
) {
  const t = Math.max(0.01, thickness);
  const zRel = Math.max(0, z - minZ);
  const layerIdx = Math.floor(zRel / t);
  const activeTool = getInterleavedToolAtLayer(layerIdx, toolIds);

  // Mode 0: Step (discrete 0 / 1)
  if (shadingMode === 0) {
    const isMatch = (activeTool === targetToolId);
    if (profileMode === 0 || !isMatch) {
      return isMatch ? convexAmp : -concaveAmp;
    }
    const zFrac = Math.max(0, Math.min(1, (zRel - layerIdx * t) / t));
    const slope = Math.min(convexAmp, t);
    const base = Math.max(0, convexAmp - slope);
    return base + zFrac * slope;
  }

  // Mode 1: Gradient (continuous exposure ratio)
  // In 2-color interleaved mode, at any gradient level, only the dominant color protrudes
  // (凸), while the non-dominant color stays recessed (凹: -concaveAmp).
  // BlendWeight 1.0 = 100% Tool 0 (Tool 0 max convex, Tool 1 recessed)
  // BlendWeight 0.5 = 50/50 balance (both at -concaveAmp, equal striped exposure)
  // BlendWeight 0.0 = 100% Tool 1 (Tool 1 max convex, Tool 0 recessed)
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
    return -concaveAmp;
  }

  const effAmp = convexAmp * ratio;

  if (profileMode === 0) {
    return effAmp;
  }

  // ProfileMode 1: 45° Louver (eaves shield with scaled protrusion)
  const zFrac = Math.max(0, Math.min(1, (zRel - layerIdx * t) / t));
  const slope = Math.min(effAmp, t);
  const base = Math.max(0, effAmp - slope);
  return base + zFrac * slope;
}

/**
 * Generate slicing layer table for display
 */
export function generateInterleavedTable(minZ, maxZ, thickness, toolIds, palette) {
  const t = Math.max(0.01, thickness);
  const totalLayers = Math.max(1, Math.ceil((maxZ - minZ) / t));
  const table = [];

  for (let i = 0; i < Math.min(totalLayers, 100); i++) {
    const activeTool = getInterleavedToolAtLayer(i, toolIds);
    const palItem = palette.find(p => p.toolId === activeTool);
    table.push({
      layerIndex: i + 1,
      heightMm: Math.round((minZ + (i + 1) * t) * 100) / 100,
      toolId: activeTool,
      hex: palItem ? palItem.hex : '#ffffff'
    });
  }
  return { table, totalLayers };
}
