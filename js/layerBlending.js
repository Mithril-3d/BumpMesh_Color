/*
 * Copyright (c) 2026 CNCKitchen and contributors
 * Layer Blending / HueForge-style Multi-Tool Color Mixing
 */

/**
 * Standard Presets for Layer Blending
 */
export const LAYER_BLENDING_PRESETS = [
  {
    id: 'cmyw',
    name: 'CMYW 4-Color (Black, Cyan, Yellow, White)',
    layers: [
      { toolId: 1, name: 'Black', hex: '#111111', color: [17, 17, 17], td: 0.6 },
      { toolId: 2, name: 'Cyan / Blue', hex: '#0077b6', color: [0, 119, 182], td: 2.2 },
      { toolId: 3, name: 'Yellow', hex: '#ffb703', color: [255, 183, 3], td: 4.5 },
      { toolId: 4, name: 'White', hex: '#fdfdfd', color: [253, 253, 253], td: 6.0 }
    ]
  },
  {
    id: 'warm_fire',
    name: 'Sunset / Warm (Black, Red, Orange, White)',
    layers: [
      { toolId: 1, name: 'Black', hex: '#151515', color: [21, 21, 21], td: 0.5 },
      { toolId: 2, name: 'Dark Red', hex: '#9b2226', color: [155, 34, 38], td: 2.0 },
      { toolId: 3, name: 'Orange', hex: '#ca6702', color: [202, 103, 2], td: 4.0 },
      { toolId: 4, name: 'Warm White', hex: '#fefae0', color: [254, 250, 224], td: 6.0 }
    ]
  },
  {
    id: 'forest_green',
    name: 'Forest Nature (Black, Navy, Green, Light Ivory)',
    layers: [
      { toolId: 1, name: 'Deep Black', hex: '#101419', color: [16, 20, 25], td: 0.5 },
      { toolId: 2, name: 'Forest Green', hex: '#2d6a4f', color: [45, 106, 79], td: 2.5 },
      { toolId: 3, name: 'Light Green', hex: '#95d5b2', color: [149, 213, 178], td: 4.5 },
      { toolId: 4, name: 'Ivory White', hex: '#f8f9fa', color: [248, 249, 250], td: 6.5 }
    ]
  },
  {
    id: 'monochrome',
    name: 'Monochrome Grayscale (Black, Dark Gray, Light Gray, White)',
    layers: [
      { toolId: 1, name: 'Black', hex: '#121212', color: [18, 18, 18], td: 0.5 },
      { toolId: 2, name: 'Dark Gray', hex: '#495057', color: [73, 80, 87], td: 2.0 },
      { toolId: 3, name: 'Light Gray', hex: '#ced4da', color: [206, 212, 218], td: 4.0 },
      { toolId: 4, name: 'Pure White', hex: '#ffffff', color: [255, 255, 255], td: 6.0 }
    ]
  }
];

/**
 * Helper: parse hex color "#rrggbb" to [r, g, b] (0..255)
 */
export function hexToRgb(hex) {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16) || 0;
  const g = parseInt(clean.substring(2, 4), 16) || 0;
  const b = parseInt(clean.substring(4, 6), 16) || 0;
  return [r, g, b];
}

/**
 * Helper: convert [r, g, b] (0..255) to hex string "#rrggbb"
 */
export function rgbToHex(r, g, b) {
  const toHex = (c) => Math.round(Math.max(0, Math.min(255, c))).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Initialize default layer bounds based on current amplitude
 *
 * @param {Array<object>} layers
 * @param {number} totalAmplitude (in mm, e.g. 1.0 or 2.0)
 * @returns {Array<object>} updated layers with startHeight, endHeight
 */
export function calculateDefaultLayerBounds(layers, totalAmplitude = 2.0) {
  const count = layers.length;
  if (count === 0) return [];

  // Step height allocation
  // First layer gets roughly 25-30% base, then evenly distributed
  const result = [];
  for (let i = 0; i < count; i++) {
    const startFrac = i / count;
    const endFrac = (i + 1) / count;
    result.push({
      ...layers[i],
      startHeight: Math.round(startFrac * totalAmplitude * 100) / 100,
      endHeight: Math.round(endFrac * totalAmplitude * 100) / 100,
      td: layers[i].td ?? (1.0 + i * 1.8)
    });
  }
  // Ensure strict bounding
  result[0].startHeight = 0;
  result[count - 1].endHeight = totalAmplitude;

  return result;
}

/**
 * Simulate the transmitted color at a given physical height (mm)
 * using Beer-Lambert optical transmission through stacked filament layers.
 *
 * @param {number} height - physical height/displacement in mm (0 <= height <= max)
 * @param {Array<object>} layers - sorted list of layers with startHeight, endHeight, color, td
 * @returns {[number, number, number]} RGB color [0..255]
 */
export function simulateTransmissionColor(height, layers) {
  if (!layers || layers.length === 0) return [128, 128, 128];
  if (height <= 0) return [...layers[0].color];

  // Base starts with bottom-most layer
  let curR = layers[0].color[0];
  let curG = layers[0].color[1];
  let curB = layers[0].color[2];

  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i];
    if (height <= layer.startHeight) break;

    // Local thickness of this layer at this height
    const localThickness = Math.min(height, layer.endHeight) - layer.startHeight;
    const span = Math.max(0.01, layer.endHeight - layer.startHeight);
    if (localThickness <= 0) continue;

    // Normalized progress in this layer (0..1)
    const t = Math.min(1.0, Math.max(0.0, localThickness / span));

    // Optical transmission & coverage curve (Beer-Lambert / HueForge model):
    // Standard filament reaches ~80-95% coverage across its layer span.
    // Lower TD (e.g. 0.5-1.0) = opaque, rapidly covers the layer below.
    // Higher TD (e.g. 4.0-6.0) = translucent, allows base layers to blend through.
    const td = Math.max(0.2, layer.td || 2.0);
    const alpha = 1.0 - Math.exp(-2.8 * t / (td / 2.0));

    curR = curR * (1.0 - alpha) + layer.color[0] * alpha;
    curG = curG * (1.0 - alpha) + layer.color[1] * alpha;
    curB = curB * (1.0 - alpha) + layer.color[2] * alpha;
  }

  return [
    Math.round(Math.max(0, Math.min(255, curR))),
    Math.round(Math.max(0, Math.min(255, curG))),
    Math.round(Math.max(0, Math.min(255, curB)))
  ];
}

/**
 * Determine which tool is on the outermost surface at a given physical height
 *
 * @param {number} height - height in mm
 * @param {Array<object>} layers - sorted layers
 * @returns {number} toolId (1..K)
 */
export function getSurfaceToolAtHeight(height, layers) {
  if (!layers || layers.length === 0) return 1;

  for (let i = layers.length - 1; i >= 0; i--) {
    if (height >= layers[i].startHeight) {
      return layers[i].toolId;
    }
  }
  return layers[0].toolId;
}

/**
 * Generate Slicing Instructions for Slicer (M600 or Multi-Tool change table)
 *
 * @param {Array<object>} layers
 * @param {number} layerHeight (e.g. 0.08 or 0.16)
 * @param {number} firstLayerHeight (e.g. 0.20)
 * @returns {Array<{ layerIndex: number, heightMm: number, toolId: number, colorName: string, hex: string }>}
 */
export function generateSlicingGuide(layers, layerHeight = 0.08, firstLayerHeight = 0.20) {
  if (!layers || layers.length === 0) return [];

  const guide = [];
  
  // Layer 1 is always base layer
  guide.push({
    layerIndex: 1,
    heightMm: firstLayerHeight,
    toolId: layers[0].toolId,
    colorName: layers[0].name || `Tool ${layers[0].toolId}`,
    hex: layers[0].hex || rgbToHex(...layers[0].color),
    isStart: true
  });

  for (let i = 1; i < layers.length; i++) {
    const layer = layers[i];
    const thresholdMm = layer.startHeight;

    // Calculate slicer layer index at or immediately after this threshold
    let targetLayer = 1;
    let cumHeight = firstLayerHeight;

    if (thresholdMm > firstLayerHeight) {
      const remainingMm = thresholdMm - firstLayerHeight;
      const stepLayers = Math.ceil(remainingMm / layerHeight);
      targetLayer = 1 + stepLayers;
      cumHeight = firstLayerHeight + stepLayers * layerHeight;
    }

    guide.push({
      layerIndex: targetLayer,
      heightMm: Math.round(cumHeight * 100) / 100,
      toolId: layer.toolId,
      colorName: layer.name || `Tool ${layer.toolId}`,
      hex: layer.hex || rgbToHex(...layer.color),
      isStart: false
    });
  }

  return guide;
}

/**
 * Build a 256-entry gradient color table (RGBA Uint8Array)
 * for fast WebGL shader uniform or canvas lookup.
 *
 * @param {Array<object>} layers
 * @param {number} totalAmplitude
 * @returns {Uint8Array} length 256 * 4
 */
export function generateGradientLookupTable(layers, totalAmplitude = 2.0) {
  const table = new Uint8Array(256 * 4);
  const maxHeight = (layers && layers.length > 0)
    ? Math.max(layers[layers.length - 1].endHeight || 0, totalAmplitude, 0.05)
    : Math.max(totalAmplitude, 0.05);

  for (let i = 0; i < 256; i++) {
    const h = (i / 255.0) * maxHeight;
    const [r, g, b] = simulateTransmissionColor(h, layers);
    const idx = i * 4;
    table[idx] = r;
    table[idx + 1] = g;
    table[idx + 2] = b;
    table[idx + 3] = 255;
  }
  return table;
}
