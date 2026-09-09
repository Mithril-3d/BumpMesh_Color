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
  profileMode = 1
) {
  const t = Math.max(0.01, thickness);
  const zRel = Math.max(0, z - minZ);
  const layerIdx = Math.floor(zRel / t);
  const activeTool = getInterleavedToolAtLayer(layerIdx, toolIds);
  const isMatch = (activeTool === targetToolId);

  if (profileMode === 0 || !isMatch) {
    return isMatch ? convexAmp : -concaveAmp;
  }

  // ProfileMode 1: 45° Louver (eaves/shield)
  const zFrac = Math.max(0, Math.min(1, (zRel - layerIdx * t) / t));
  const slope = Math.min(convexAmp, t);
  const base = Math.max(0, convexAmp - slope);
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
