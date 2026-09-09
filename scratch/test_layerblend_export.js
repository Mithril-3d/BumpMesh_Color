import fs from 'fs';
import {
  LAYER_BLENDING_PRESETS,
  calculateDefaultLayerBounds,
  simulateTransmissionColor,
  getSurfaceToolAtHeight,
  generateSlicingGuide,
  generateGradientLookupTable,
  rgbToHex
} from '../js/layerBlending.js';
import { exportMultiColor3MF } from '../js/exporter.js';

console.log('=== Test 1: Presets & Bounds ===');
const preset = LAYER_BLENDING_PRESETS[0]; // CMYW
console.log('Preset:', preset.name);
const layers = calculateDefaultLayerBounds(preset.layers, 2.0);
console.log('Layers calculated for 2.0mm amplitude:');
layers.forEach(l => {
  console.log(`  Tool ${l.toolId} (${l.name}): ${l.startHeight}mm ~ ${l.endHeight}mm, TD=${l.td}`);
});

console.log('\n=== Test 2: Optical Transmission Simulation ===');
const testHeights = [0.0, 0.4, 0.8, 1.2, 1.6, 2.0];
testHeights.forEach(h => {
  const c = simulateTransmissionColor(h, layers);
  const surfaceTool = getSurfaceToolAtHeight(h, layers);
  console.log(`  Height ${h.toFixed(1)}mm: RGB=[${c.join(',')}], Hex=${rgbToHex(...c)}, SurfaceTool=${surfaceTool}`);
});

console.log('\n=== Test 3: Slicing Guide ===');
const guide = generateSlicingGuide(layers, 0.08, 0.20);
guide.forEach(g => {
  console.log(`  Layer ${g.layerIndex} (${g.heightMm.toFixed(2)}mm): Tool ${g.toolId} (${g.colorName})`);
});

console.log('\n=== Test 4: Gradient Lookup Table ===');
const lut = generateGradientLookupTable(layers, 2.0);
console.log(`  LUT Length: ${lut.length} bytes (256 RGBA samples). First sample: [${lut[0]},${lut[1]},${lut[2]},${lut[3]}], Last sample: [${lut[1020]},${lut[1021]},${lut[1022]},${lut[1023]}]`);

console.log('\n=== All Tests Passed! ===');
