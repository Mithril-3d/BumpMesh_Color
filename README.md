# BumpMesh_Color

**Author:** [@Mithril_MEX](https://x.com/Mithril_MEX)  
**GitHub:** https://github.com/Mithril-3d/BumpMesh_Color  
**Forked from:** [BumpMesh (stlTexturizer)](https://github.com/CNCKitchen/stlTexturizer) by Stefan Hermann ([CNC Kitchen](https://bumpmesh.com))  

> [!IMPORTANT]
> **Disclaimer & Support Notice:**  
> **BumpMesh_Color** is an independent community fork and feature extension created by [@Mithril_MEX](https://x.com/Mithril_MEX).  
> **CNC Kitchen (Stefan Hermann) is NOT affiliated with, does NOT maintain, and does NOT provide support for this modified fork.**  
> Please do NOT contact CNC Kitchen regarding any bugs, print issues, or feature requests related to BumpMesh_Color. All issues, feedback, and inquiries should be directed to [@Mithril_MEX](https://x.com/Mithril_MEX) or submitted via [GitHub Issues](https://github.com/Mithril-3d/BumpMesh_Color/issues).

---

A browser-based tool for applying surface displacement textures and **multi-color / multi-tool 3D printing assignments** to meshes — running entirely client-side with no installation required.

Load an STL, OBJ, 3MF, or STEP file, choose a color or displacement texture, tune procedural parameters, slice into alternating tool layers, and export a slicer-ready multi-color 3MF compatible with **PrusaSlicer, OrcaSlicer, and Bambu Studio**.

---

## 🌟 Key Features Added in BumpMesh_Color

### 1. 🎨 Color Quantization & Multi-Tool Mapping
- **Automatic Dominant Color Extraction**: Uses K-means color quantization on texture images to extract representative palettes (2 to 8 extruders/tools).
- **Tool Assignment**: Flexibly assign each quantized color to specific physical extruders/tools (Tool 1 to Tool 8).
- **Untextured Area Tool**: Dedicate a specific extruder/tool for bottom surfaces, untextured sides, or masked areas.
- **3D Color Preview**: Real-time GPU viewport rendering of the quantized tool assignments across model surfaces.

### 2. 🔄 Interleaved Layer Slicing (交互積層マルチツール振り重ね)
- **Layer-by-Layer Tool Alternation**: Slices texture depth into alternating layers based on slicer layer height (0.08 mm – 0.40 mm).
- **Convex & Concave Displacement**:
  - Layers matching the target color extrude outward (Convex offset).
  - Layers of other colors recess inward (Concave offset).
- **Profile Modes**:
  - **Flat Step (Standard / Recommended)**: Produces crisp, perpendicular step edges between color bands.
  - **45° Louver Overhang (Experimental)**: Angled overhangs that shield non-target layers from direct top-down view.
- **Tonal Shading Modes**:
  - **Sharp (Binary / 0-1)**: Solid, distinct color levels.
  - **Gradient (Continuous)**: Smoothly modulates extrusion depth based on image luminance.

### 3. 📦 Seamless Multi-Tool 3MF Export
- **Full Slicer Compatibility**: Generates standard 3MF archives with multi-part objects directly recognized by **PrusaSlicer**, **OrcaSlicer**, and **Bambu Studio** without configuration hassles.
- **Windows Explorer Thumbnail**: Automatically embeds compliant PNG thumbnails so files display high-res preview icons in Windows File Explorer.
- **Non-blocking Progress**: Asynchronous export pipeline with realistic 0%–100% progress reporting that never freezes the browser.

### 4. 🖼️ Rich Library of Color & Traditional Japanese Textures
In addition to the original 24 monochrome displacement patterns, **BumpMesh_Color** includes:
- **Japanese Traditional & Modern Patterns**: Blue Porcelain, Japanese Modern, Japanese Pattern, Ichimatsu (市松), Seigaiha (青海波), Yagasuri (矢絣), Asanoha (麻の葉), Tomoe (巴), Kikko (亀甲), Kagome (籠目).
- **Western Classics**: Houndstooth, Chevron, Herringbone, Argyle, Tartan, Stained Glass.
- **Geometric Mosaics**: Honeycomb, Triangle Mosaic, Isometric Cubes, Octagon Tile, Kaleidoscope.

### 5. 🌐 Comprehensive 14-Language Localization
Fully localized UI with instant language switching:
- English, Japanese (日本語), German (Deutsch), French (Français), Spanish (Español), Italian (Italiano), Portuguese (Português), Chinese (中文), Korean (한국어), Russian (Русский), Ukrainian (Українська), Polish (Polski), Danish (Dansk), Turkish (Türkçe).

---

## 🛠️ Core BumpMesh Features

- **Projection Modes**: Triplanar (default normal blending), Cubic (Box), Cylindrical, Spherical, Planar (XY, XZ, YZ).
- **UV Transform**: Logarithmic Scale U/V, Offset U/V, Rotation, and Seam Blending.
- **Masking Tools**:
  - Angle-based masking (suppress texture on top/bottom faces).
  - Interactive face painting (brush tool and dihedral bucket fill).
  - Smooth transition curves (linear, S-curve, ease-in).
- **File Format Support**:
  - Input: `.stl`, `.obj`, `.3mf`, `.step` / `.stp` (via client-side B-rep tessellation).
  - Output: Binary `.stl`, Standard `.3mf`, Multi-Tool `.3mf`.
- **Privacy First**: 100% client-side WebAssembly and WebGL execution. No 3D files or textures are ever uploaded to any server.

---

## 🚀 Getting Started

### Slicer Workflow (Multi-Color Printing)

1. Open **BumpMesh_Color** in your browser.
2. Drag and drop your 3D model (`.stl`, `.obj`, `.step`, or `.3mf`).
3. Select a color texture preset from the sidebar (or upload your own image).
4. Under **Color & Multi-Tool**, configure:
   - **Extruder Count**: Set the number of colors/tools to extract.
   - **Tool Assignments**: Assign Tool 1..N to your printer's toolheads or AMS/MMU slots.
   - **Mode**: Choose between *Color Quantization* or *Interleaved Layers*.
5. Click **🎨 Export Multi-Tool 3MF**.
6. Drag the downloaded `.3mf` file directly into **PrusaSlicer**, **OrcaSlicer**, or **Bambu Studio**. Select **"Load as a single object with multiple parts"** when prompted.
7. Slice and print!

---

## 💻 Running Locally

Because browsers restrict ES module imports and local image access over `file://` URLs, run a lightweight local static HTTP server:

```bash
# 1. Clone the repository
git clone https://github.com/Mithril-3d/BumpMesh_Color.git
cd BumpMesh_Color

# 2. Start a local server (Python 3)
python -m http.server 8080
```

Open `http://localhost:8080` in Chrome, Edge, Firefox, or Safari.

---

## 📜 License & Credits

- **Original Project:** [BumpMesh (stlTexturizer)](https://github.com/CNCKitchen/stlTexturizer) by Stefan Hermann ([CNC Kitchen](https://bumpmesh.com)).
- **Fork Modifications:** [@Mithril_MEX](https://x.com/Mithril_MEX).
- **License:** Licensed under the [GNU Affero General Public License v3.0 (AGPL-3.0)](LICENSE).
