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
 * Compute continuous blend weight (0.0 to 1.0) using full-range Rec.709 luminance with optional gamma.
 * 1.0 means pure white (Tool 1 dominant), 0.0 means pure black (Tool 2 dominant).
 *
 * @param {Array<number>} rgb - [r, g, b] (0..255)
 * @param {number} gamma - gamma exponent (default 1.0, <1 brightens darks, >1 deepens blacks)
 * @returns {number} blend weight (0.0..1.0)
 */
export function computeLuminanceBlendWeight(rgb, gamma = 1.0) {
  const lum = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255.0;
  const clamped = Math.max(0.0, Math.min(1.0, lum));
  if (Math.abs(gamma - 1.0) < 1e-4) {
    return clamped;
  }
  return Math.pow(clamped, Math.max(0.1, gamma));
}

/**
 * Legacy Color Blend Weight along line between colorA and colorB in RGB space.
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
 * Compute multi-color blend affinity for palettes with 2, 3, or more colors.
 * Identifies the top 2 closest palette colors (toolA = closest, toolB = second closest)
 * and calculates continuous affinity `t` in [0.0, 1.0] where 1.0 = pure toolA, 0.0 = pure toolB.
 *
 * @param {Array<number>} rgb - [r, g, b] (0..255)
 * @param {Array<object>} palette - [{ toolId, color: [r, g, b] }, ...]
 * @returns {{ toolA: number, toolB: number, t: number }}
 */
export function computeMultiColorBlend(rgb, palette, gamma = 1.0, invert = false) {
  if (!palette || palette.length === 0) {
    return { toolA: 1, toolB: 1, t: 1.0 };
  }
  if (palette.length === 1) {
    return { toolA: palette[0].toolId, toolB: palette[0].toolId, t: 1.0 };
  }

  // 2-color palette: precise normalized linear distance interpolation in [0.0, 1.0]
  if (palette.length === 2) {
    const col0 = palette[0].color || [255, 255, 255];
    const col1 = palette[1].color || [0, 0, 0];
    const dr0 = rgb[0] - col0[0], dg0 = rgb[1] - col0[1], db0 = rgb[2] - col0[2];
    const dr1 = rgb[0] - col1[0], dg1 = rgb[1] - col1[1], db1 = rgb[2] - col1[2];
    const d0 = Math.sqrt(dr0 * dr0 + dg0 * dg0 + db0 * db0);
    const d1 = Math.sqrt(dr1 * dr1 + dg1 * dg1 + db1 * db1);
    const sumD = d0 + d1;
    let w = (sumD > 1e-6) ? (d1 / sumD) : 0.5; // 1.0 = 100% Tool 1 (col0), 0.0 = 100% Tool 2 (col1)

    if (gamma !== 1.0 && gamma > 0.01) {
      w = Math.pow(w, gamma);
    }
    if (invert) {
      w = 1.0 - w;
    }
    w = Math.max(0.0, Math.min(1.0, w));

    return {
      toolA: palette[0].toolId,
      toolB: palette[1].toolId,
      t: w // True continuous exposure for Tool 1 in [0.0, 1.0]
    };
  }

  let bestK = 0;
  let bestDistSq = Infinity;
  let secondK = 1;
  let secondDistSq = Infinity;

  for (let k = 0; k < palette.length; k++) {
    const col = palette[k].color || [0, 0, 0];
    const dr = rgb[0] - col[0];
    const dg = rgb[1] - col[1];
    const db = rgb[2] - col[2];
    const dSq = dr * dr + dg * dg + db * db;

    if (dSq < bestDistSq) {
      secondDistSq = bestDistSq;
      secondK = bestK;
      bestDistSq = dSq;
      bestK = k;
    } else if (dSq < secondDistSq) {
      secondDistSq = dSq;
      secondK = k;
    }
  }

  const dA = Math.sqrt(bestDistSq);
  const dB = Math.sqrt(secondDistSq);
  const sumD = dA + dB;
  let t = (sumD > 1e-6) ? (dB / sumD) : 1.0;
  if (gamma !== 1.0 && gamma > 0.01) {
    t = Math.pow(t, gamma);
  }

  return {
    toolA: palette[bestK].toolId,
    toolB: palette[secondK].toolId,
    t: t
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
 * @param {number} profileMode - 0 = Flat, 1 = Louver 45°, 2 = Sinusoidal Weave (Halftone)
 * @param {number} blendWeight - 0.0..1.0 ratio (1.0 = 100% Tool 1, 0.0 = 100% Tool 2)
 * @param {number} shadingMode - 0 = Step (discrete), 1 = Gradient (continuous)
 * @param {object} [multiColorInfo] - optional { toolA, toolB, t } from computeMultiColorBlend
 * @param {object} [weaveOptions] - optional { x, y, cx, cy, pitch, amp, phaseOffset }
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
  profileMode = 0,
  blendWeight = 1.0,
  shadingMode = 1,
  multiColorInfo = null,
  weaveOptions = null
) {
  const t = Math.max(0.01, thickness);
  const zRel = Math.max(0, z - minZ);
  const layerIdx = Math.floor(zRel / t);
  const activeTool = getInterleavedToolAtLayer(layerIdx, toolIds);

  // Determine continuous exposure ratio for activeTool in [0.0, 1.0]
  let exposure = 0.5;
  if (multiColorInfo) {
    const { toolA, toolB, t: tAffinity } = multiColorInfo;
    if (activeTool === toolA) {
      exposure = tAffinity;
    } else if (activeTool === toolB) {
      exposure = 1.0 - tAffinity;
    } else {
      exposure = 0.0;
    }
  } else if (toolIds.length >= 2) {
    const isTool0 = (activeTool === toolIds[0]);
    exposure = isTool0 ? blendWeight : (1.0 - blendWeight);
  } else {
    exposure = (activeTool === targetToolId) ? 1.0 : 0.0;
  }
  exposure = Math.max(0, Math.min(1, exposure));

  // Mode 0: Step (discrete 0 / 1)
  if (shadingMode === 0) {
    const isMatch = (activeTool === targetToolId);
    if ((profileMode !== 2 && profileMode !== 3 && profileMode !== 4) || !isMatch) {
      return isMatch ? convexAmp : -concaveAmp;
    }
    if ((profileMode === 2 || profileMode === 3 || profileMode === 4) && weaveOptions) {
      const pitch = Math.max(0.2, weaveOptions.pitch ?? 1.5);
      const waveAmp = Math.max(0.0, weaveOptions.amp ?? 0.25);
      const px = weaveOptions.x ?? 0;
      const py = weaveOptions.y ?? 0;
      const nx = weaveOptions.nx ?? 0;
      const ny = weaveOptions.ny ?? 0;
      const absNx = Math.abs(nx);
      const absNy = Math.abs(ny);
      let sHoriz;
      if (absNx + absNy > 1e-4) {
        // Tangent perpendicular to horizontal surface normal in XY
        const len = Math.hypot(nx, ny);
        sHoriz = (-ny * px + nx * py) / len;
      } else {
        sHoriz = px * 0.7071 - py * 0.7071;
      }
      const k = (2.0 * Math.PI) / pitch;
      const layerPhase = (layerIdx % 2) * Math.PI;
      const phi = k * sHoriz + layerPhase;
      const u = ((phi / (2.0 * Math.PI)) % 1.0 + 1.0) % 1.0;
      let W;
      if (profileMode === 4) {
        // 🧱 Block Pulse (Trapezoidal Rectangular Wave)
        const edge = 0.05;
        if (u < edge) W = -1.0 + 2.0 * (u / edge);
        else if (u < 0.5 - edge) W = 1.0;
        else if (u < 0.5 + edge) W = 1.0 - 2.0 * ((u - (0.5 - edge)) / (2.0 * edge));
        else if (u < 1.0 - edge) W = -1.0;
        else W = -1.0 + 2.0 * ((u - (1.0 - edge)) / edge);
      } else if (profileMode === 3) {
        W = 1.0 - 4.0 * Math.abs(u - 0.5);
      } else {
        W = Math.sin(phi);
      }
      return isMatch ? (convexAmp + waveAmp * W) : -concaveAmp;
    }
    const zFrac = Math.max(0, Math.min(1, (zRel - layerIdx * t) / t));
    const slope = Math.min(convexAmp, t);
    const base = Math.max(0, convexAmp - slope);
    return base + zFrac * slope;
  }

  // ProfileMode 2 (Sinusoidal), Mode 3 (Zigzag), Mode 4 (Block Pulse)
  if (profileMode === 2 || profileMode === 3 || profileMode === 4) {
    const pitch = Math.max(0.2, weaveOptions?.pitch ?? 1.6);
    const waveAmp = Math.max(0.0, weaveOptions?.amp ?? 0.60);
    const px = weaveOptions?.x ?? 0;
    const py = weaveOptions?.y ?? 0;
    const nx = weaveOptions?.nx ?? 0;
    const ny = weaveOptions?.ny ?? 0;
    const absNx = Math.abs(nx);
    const absNy = Math.abs(ny);
    let sHoriz;
    if (absNx + absNy > 1e-4) {
      const len = Math.hypot(nx, ny);
      sHoriz = (-ny * px + nx * py) / len;
    } else {
      sHoriz = px * 0.7071 - py * 0.7071;
    }

    const k = (2.0 * Math.PI) / pitch;
    const layerPhase = (layerIdx % 2) * Math.PI;
    const phi = k * sHoriz + layerPhase;
    const u = ((phi / (2.0 * Math.PI)) % 1.0 + 1.0) % 1.0;

    let W;
    if (profileMode === 4) {
      // 🧱 Block Pulse (Trapezoidal Rectangular Wave)
      const edge = 0.05;
      if (u < edge) W = -1.0 + 2.0 * (u / edge);
      else if (u < 0.5 - edge) W = 1.0;
      else if (u < 0.5 + edge) W = 1.0 - 2.0 * ((u - (0.5 - edge)) / (2.0 * edge));
      else if (u < 1.0 - edge) W = -1.0;
      else W = -1.0 + 2.0 * ((u - (1.0 - edge)) / edge);
    } else if (profileMode === 3) {
      // Triangle wave (Zigzag) normalized in [-1, 1]
      W = 1.0 - 4.0 * Math.abs(u - 0.5);
    } else {
      // Sinusoidal wave
      W = Math.sin(phi);
    }

    const dcOffset = -concaveAmp + (convexAmp + concaveAmp) * exposure;
    // Keep healthy weave modulation across all exposure levels (never drop to 0)
    // so both alternating layers continuously weave together without creating vertical cliff-drops.
    const modFactor = 0.5 + 0.5 * (2.0 * Math.min(exposure, 1.0 - exposure));
    return dcOffset + waveAmp * W * modFactor;
  }

  // Mode 1: Gradient for Profile 0 (Flat Step) and Profile 1 (45° Louver)
  const disp = -concaveAmp + (convexAmp + concaveAmp) * exposure;

  if (profileMode === 0) {
    return disp;
  }

  // ProfileMode 1: 45° Louver (eaves shield with scaled protrusion)
  const effAmp = Math.max(0, disp);
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
