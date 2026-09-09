import fs from 'fs';
import { zipSync, strToU8 } from 'fflate';
import {
  LAYER_BLENDING_PRESETS,
  calculateDefaultLayerBounds,
  getSurfaceToolAtHeight,
  rgbToHex
} from '../js/layerBlending.js';
import { encodeTrianglePaint } from '../js/exporter.js';

// Create a small multi-layer cube with faceted tools
const preset = LAYER_BLENDING_PRESETS[0];
const layers = calculateDefaultLayerBounds(preset.layers, 2.0);

// A simple box (12 triangles, 8 vertices) from z=0 to z=2.0
const vertices = [
  [0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0], // bottom (z=0)
  [0, 0, 2], [10, 0, 2], [10, 10, 2], [0, 10, 2]  // top (z=2)
];

const triangles = [
  // Bottom (z=0) -> tool 1
  [0, 2, 1], [0, 3, 2],
  // Top (z=2) -> tool 4
  [4, 5, 6], [4, 6, 7],
  // Front (y=0) -> layered
  [0, 1, 5], [0, 5, 4],
  // Back (y=10) -> layered
  [2, 3, 7], [2, 7, 6],
  // Left (x=0) -> layered
  [3, 0, 4], [3, 4, 7],
  // Right (x=10) -> layered
  [1, 2, 6], [1, 6, 5]
];

// Determine tool for each triangle based on its centroid Z
const triTools = triangles.map(tri => {
  const zAvg = (vertices[tri[0]][2] + vertices[tri[1]][2] + vertices[tri[2]][2]) / 3;
  return getSurfaceToolAtHeight(zAvg, layers);
});

console.log('Triangle tools assigned:', triTools);

// Build 3MF model XML
let xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:m="http://schemas.microsoft.com/3dmanufacturing/material/2015/02" xmlns:slic3rpe="http://schemas.slic3r.org/3mf/2017/06">
  <metadata name="Application">BumpMesh Layer Blending</metadata>
  <resources>
    <m:colorgroup id="1">
`;

layers.forEach(l => {
  xml += `      <m:color color="${l.hex}"/>\n`;
});

xml += `    </m:colorgroup>
    <object id="2" type="model">
      <mesh>
        <vertices>
`;

vertices.forEach(v => {
  xml += `          <vertex x="${v[0]}" y="${v[1]}" z="${v[2]}"/>\n`;
});

xml += `        </vertices>
        <triangles>
`;

triangles.forEach((tri, i) => {
  const tool = triTools[i];
  const paintCode = encodeTrianglePaint(tool);
  const palIdx = tool - 1;
  xml += `          <triangle v1="${tri[0]}" v2="${tri[1]}" v3="${tri[2]}" pid="1" p1="${palIdx}" slic3rpe:mmu_segmentation="${paintCode}" paint_color="${paintCode}"/>\n`;
});

xml += `        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="2"/>
  </build>
</model>
`;

const zipEntries = {
  '_rels/.rels': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>`),
  '[Content_Types].xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>`),
  '3D/3dmodel.model': strToU8(xml)
};

const zipBuf = zipSync(zipEntries, { level: 4 });
fs.writeFileSync('scratch/test_layerblend.3mf', zipBuf);
console.log('Saved scratch/test_layerblend.3mf (bytes:', zipBuf.length, ')');
