/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Procedural 3-Color Pattern & Texture Generator
 */

// ── Color Utilities ──────────────────────────────────────────────────────────

/** Parse hex color string (#rrggbb or #rgb) to RGB [0-255] */
export function hexToRgb(hex) {
  let c = hex.replace('#', '').trim();
  if (c.length === 3) {
    c = c.split('').map(x => x + x).join('');
  }
  const num = parseInt(c, 16);
  if (isNaN(num)) return { r: 0, g: 0, b: 0 };
  return {
    r: (num >> 16) & 255,
    g: (num >> 8) & 255,
    b: num & 255,
  };
}

/** Convert RGB [0-255] to hex string */
export function rgbToHex(r, g, b) {
  const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
  const toH = v => clamp(v).toString(16).padStart(2, '0');
  return `#${toH(r)}${toH(g)}${toH(b)}`;
}

/** Linear color interpolation with gamma correction for smooth natural blends */
export function lerpColor(c1, c2, t, gamma = 2.2) {
  const clampT = Math.max(0, Math.min(1, t));
  // Convert sRGB to linear RGB
  const r1 = Math.pow(c1.r / 255, gamma);
  const g1 = Math.pow(c1.g / 255, gamma);
  const b1 = Math.pow(c1.b / 255, gamma);

  const r2 = Math.pow(c2.r / 255, gamma);
  const g2 = Math.pow(c2.g / 255, gamma);
  const b2 = Math.pow(c2.b / 255, gamma);

  const rLin = r1 + (r2 - r1) * clampT;
  const gLin = g1 + (g2 - g1) * clampT;
  const bLin = b1 + (b2 - b1) * clampT;

  // Convert back to sRGB
  const invGamma = 1 / gamma;
  const r = Math.round(Math.pow(rLin, invGamma) * 255);
  const g = Math.round(Math.pow(gLin, invGamma) * 255);
  const b = Math.round(Math.pow(bLin, invGamma) * 255);

  return `rgb(${r},${g},${b})`;
}

// ── Preset Palettes ──────────────────────────────────────────────────────────

export const PRESET_PALETTES = [
  {
    name: 'Sunset Halftone (Default)',
    colors: ['#ffffff', '#ff6600', '#000000'], // Grad B, Grad A, Background
    bgIndex: 2,
  },
  {
    name: 'Cyberpunk Neon',
    colors: ['#00f0ff', '#ff007f', '#0d0d1a'],
    bgIndex: 2,
  },
  {
    name: 'Solar Flare',
    colors: ['#fff275', '#ff3c00', '#110500'],
    bgIndex: 2,
  },
  {
    name: 'Emerald Forest',
    colors: ['#e0f8d0', '#10b981', '#062817'],
    bgIndex: 2,
  },
  {
    name: 'Royal Purple & Gold',
    colors: ['#ffd700', '#8b5cf6', '#120a24'],
    bgIndex: 2,
  },
  {
    name: 'Nordic Frost',
    colors: ['#ffffff', '#38bdf8', '#0f172a'],
    bgIndex: 2,
  },
  {
    name: 'Monochrome Slate',
    colors: ['#ffffff', '#888899', '#141419'],
    bgIndex: 2,
  },
  {
    name: 'Sakura Petal',
    colors: ['#ffffff', '#f472b6', '#4a044e'],
    bgIndex: 2,
  },
  {
    name: 'Inverted High Contrast',
    colors: ['#000000', '#f97316', '#ffffff'],
    bgIndex: 2, // White background
  },
];

// ── Shape Drawing Helpers ───────────────────────────────────────────────────

/** Draw regular polygon on 2D context */
export function drawPolygon(ctx, cx, cy, radius, sides, rotation = 0) {
  if (sides < 3) {
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    return;
  }
  const step = (Math.PI * 2) / sides;
  const startAngle = rotation - Math.PI / 2;
  ctx.moveTo(cx + radius * Math.cos(startAngle), cy + radius * Math.sin(startAngle));
  for (let i = 1; i < sides; i++) {
    const angle = startAngle + i * step;
    ctx.lineTo(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle));
  }
  ctx.closePath();
}

/** Draw star shape on 2D context */
export function drawStar(ctx, cx, cy, outerRadius, points = 5, innerRatio = 0.5, rotation = 0) {
  const step = Math.PI / points;
  const startAngle = rotation - Math.PI / 2;
  const innerRadius = outerRadius * innerRatio;
  ctx.moveTo(cx + outerRadius * Math.cos(startAngle), cy + outerRadius * Math.sin(startAngle));
  for (let i = 1; i < points * 2; i++) {
    const r = (i % 2 === 1) ? innerRadius : outerRadius;
    const angle = startAngle + i * step;
    ctx.lineTo(cx + r * Math.cos(angle), cy + r * Math.sin(angle));
  }
  ctx.closePath();
}

/** Draw diamond (rhombus) */
export function drawDiamond(ctx, cx, cy, radius, rotation = 0) {
  drawPolygon(ctx, cx, cy, radius, 4, rotation + Math.PI / 4);
}

/** Draw cross / plus */
export function drawCross(ctx, cx, cy, radius, barThicknessRatio = 0.38, rotation = 0) {
  const r = radius;
  const w = radius * barThicknessRatio;
  ctx.save();
  ctx.translate(cx, cy);
  if (rotation !== 0) ctx.rotate(rotation);
  ctx.beginPath();
  ctx.rect(-w / 2, -r, w, r * 2);
  ctx.rect(-r, -w / 2, r * 2, w);
  ctx.restore();
}

/** Draw ring / donut */
export function drawRing(ctx, cx, cy, outerRadius, innerRatio = 0.5) {
  const innerRadius = outerRadius * innerRatio;
  ctx.beginPath();
  ctx.arc(cx, cy, outerRadius, 0, Math.PI * 2, false);
  ctx.arc(cx, cy, innerRadius, 0, Math.PI * 2, true);
  ctx.closePath();
}

// ── Default Generator Settings ───────────────────────────────────────────────

export const DEFAULT_TEXTURE_GENERATOR_PARAMS = {
  width: 2513,          // Default for Ø80 x 100 mm cylinder (80 * PI ≈ 251.3 mm)
  height: 1000,
  colors: ['#ffffff', '#ff6600', '#000000'],
  bgIndex: 2,           // Index 2 (#000000) is background, 0 (#ffffff) and 1 (#ff6600) are gradient
  shape: 'circle',      // 'circle' | 'triangle' | 'square' | 'diamond' | 'pentagon' | 'hexagon' | 'octagon' | 'star' | 'ring' | 'cross'
  layout: 'vertical',   // 'vertical' | 'horizontal_blend' | 'wave' | 'radial' | 'diagonal' | 'double_edge' | 'noise'
  gridType: 'staggered',// 'staggered' (hexagonal/brick) | 'grid' (orthogonal)
  columns: 60,          // Number of horizontal cells across width
  minSize: 0.05,        // 0.0 - 1.0 (relative to cell radius)
  maxSize: 0.95,        // 0.0 - 1.0
  curve: 1.2,           // Falloff curve gamma (1.0 = linear, >1 = slower falloff at top)
  spread: 1.0,          // Gradient spread / range (0.2 - 2.0)
  offset: 0.0,          // Gradient position offset (-1.0 to 1.0)
  invert: false,        // Invert direction
  rotation: 0,          // Element rotation in degrees
  seamlessWrap: true,   // Ensure left and right edges match seamlessly
  waveFrequency: 2,     // Waves across the width for wave layout
  waveAmplitude: 0.25,  // Wave amplitude relative to height
};

// ── Procedural Pattern Renderer ──────────────────────────────────────────────

/**
 * Render procedural pattern onto any HTMLCanvasElement or OffscreenCanvas
 * @param {HTMLCanvasElement|OffscreenCanvas} canvas
 * @param {Object} params
 */
export function renderProceduralPattern(canvas, params = {}) {
  const p = { ...DEFAULT_TEXTURE_GENERATOR_PARAMS, ...params };
  const W = Math.max(32, Math.round(Number(p.width) || 2513));
  const H = Math.max(32, Math.round(Number(p.height) || 1000));

  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // 1. Identify Background Color and Gradient Colors
  const bgIdx = (p.bgIndex >= 0 && p.bgIndex <= 2) ? p.bgIndex : 2;
  const gradIndices = [0, 1, 2].filter(idx => idx !== bgIdx);
  const colorB_hex = p.colors[gradIndices[0]] || '#ffffff'; // Color at t = 1.0 (e.g. top white)
  const colorA_hex = p.colors[gradIndices[1]] || '#ff6600'; // Color at t = 0.0 (e.g. bottom orange)
  const bgColor_hex = p.colors[bgIdx] || '#000000';

  const rgbA = hexToRgb(colorA_hex);
  const rgbB = hexToRgb(colorB_hex);

  // 2. Fill Background
  ctx.fillStyle = bgColor_hex;
  ctx.fillRect(0, 0, W, H);

  // 3. Calculate Grid Geometry
  let cols = Math.max(4, Math.round(Number(p.columns) || 60));
  // If seamlessWrap and staggered grid, make cols even so staggered rows repeat seamlessly across W
  if (p.seamlessWrap && p.gridType === 'staggered' && cols % 2 !== 0) {
    cols += 1;
  }

  const cellW = W / cols;
  // For equilateral triangular / hexagonal staggered packing:
  // vertical row step = cellW * sqrt(3) / 2 ≈ 0.866025 * cellW
  const isStaggered = p.gridType === 'staggered';
  const rowStep = isStaggered ? cellW * (Math.sqrt(3) / 2) : cellW;
  const rows = Math.ceil(H / rowStep) + 2;

  // Pre-calculate common parameters
  const minS = Math.max(0, Math.min(1.5, Number(p.minSize) ?? 0.05));
  const maxS = Math.max(0, Math.min(1.5, Number(p.maxSize) ?? 0.95));
  const rotRad = ((Number(p.rotation) || 0) * Math.PI) / 180;
  const curve = Math.max(0.1, Math.min(5.0, Number(p.curve) || 1.2));
  const spread = Math.max(0.1, Math.min(3.0, Number(p.spread) || 1.0));
  const offset = Math.max(-2.0, Math.min(2.0, Number(p.offset) || 0.0));
  const invert = !!p.invert;
  const waveFreq = Math.max(1, Math.round(Number(p.waveFrequency) || 2));
  const waveAmp = Math.max(0, Math.min(1, Number(p.waveAmplitude) ?? 0.25));

  const baseRadius = cellW * 0.5;

  // Simple deterministic 2D pseudo-random / hash for organic layout
  function hash2d(x, y) {
    const dot = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123;
    return dot - Math.floor(dot);
  }

  // 4. Iterate Over Grid Elements
  for (let r = 0; r < rows; r++) {
    const isOdd = r % 2 === 1;
    const xOffset = (isStaggered && isOdd) ? cellW * 0.5 : 0;
    const cy = r * rowStep;

    // Loop through columns + 1 extra if staggered to cover the right edge smoothly
    const colCount = isStaggered ? cols + 1 : cols;

    for (let c = 0; c < colCount; c++) {
      let cx = c * cellW + xOffset;

      // Wrap coordinate for seamless boundary if cx exceeds W
      if (cx > W + cellW * 0.5) continue;

      // Normalized coordinates [0, 1]
      const u = (cx % W) / W;
      const v = Math.min(1, Math.max(0, cy / H));

      // Calculate Gradient Factor `t` (0.0 to 1.0) based on Layout Mode
      let t = 0;

      switch (p.layout) {
        case 'vertical': {
          // Bottom (v=1.0) -> t = 0.0 (Color A, Max Size)
          // Top    (v=0.0) -> t = 1.0 (Color B, Min Size)
          // Matches the user's reference image!
          t = 1.0 - v;
          break;
        }

        case 'horizontal_blend': {
          // Left to right color fusion and exchange
          t = u;
          break;
        }

        case 'wave': {
          // Sine wave modulation across width
          const wavePhase = Math.sin(u * Math.PI * 2 * waveFreq);
          const vMod = v + wavePhase * waveAmp;
          t = 1.0 - Math.max(0, Math.min(1, vMod));
          break;
        }

        case 'radial': {
          // Center outward radial burst
          const dx = (u - 0.5) * (W / H);
          const dy = v - 0.5;
          const dist = Math.sqrt(dx * dx + dy * dy) * 2; // ~0 at center, ~1+ at corners
          t = Math.max(0, Math.min(1, dist));
          break;
        }

        case 'diagonal': {
          // Diagonal 45-degree gradient
          t = (u + (1.0 - v)) * 0.5;
          break;
        }

        case 'double_edge': {
          // Large at both top and bottom edges, small in center
          const distFromEdge = Math.abs(v - 0.5) * 2; // 1 at edges, 0 at center
          t = 1.0 - distFromEdge;
          break;
        }

        case 'noise': {
          // Organic modulated halftone
          const baseV = 1.0 - v;
          const n = hash2d(c * 0.31, r * 0.31);
          t = Math.max(0, Math.min(1, baseV * 0.75 + n * 0.25));
          break;
        }

        default:
          t = 1.0 - v;
      }

      // Apply Invert
      if (invert) {
        t = 1.0 - t;
      }

      // Apply Offset & Spread
      // t_scaled = (t - 0.5 - offset) / spread + 0.5
      let gradProgress = (t - 0.5 - offset) / spread + 0.5;
      gradProgress = Math.max(0, Math.min(1, gradProgress));

      // Apply Non-linear Curve
      const curvedProgress = Math.pow(gradProgress, curve);

      // Calculate Dot Scale Factor:
      // When curvedProgress = 0.0 -> maxSize
      // When curvedProgress = 1.0 -> minSize
      const currentScale = maxS - curvedProgress * (maxS - minS);
      const dotRadius = baseRadius * currentScale;

      // Skip drawing if size is negligible (< 0.25 px)
      if (dotRadius <= 0.25) continue;

      // Calculate Interpolated Color:
      // curvedProgress = 0.0 -> Color A (e.g. orange)
      // curvedProgress = 1.0 -> Color B (e.g. white)
      const dotColor = lerpColor(rgbA, rgbB, curvedProgress);

      // Draw the shape
      ctx.fillStyle = dotColor;
      ctx.beginPath();

      switch (p.shape) {
        case 'circle':
          ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
          break;

        case 'triangle':
          drawPolygon(ctx, cx, cy, dotRadius, 3, rotRad);
          break;

        case 'square':
          drawPolygon(ctx, cx, cy, dotRadius, 4, rotRad + Math.PI / 4);
          break;

        case 'diamond':
          drawDiamond(ctx, cx, cy, dotRadius, rotRad);
          break;

        case 'pentagon':
          drawPolygon(ctx, cx, cy, dotRadius, 5, rotRad);
          break;

        case 'hexagon':
          drawPolygon(ctx, cx, cy, dotRadius, 6, rotRad);
          break;

        case 'octagon':
          drawPolygon(ctx, cx, cy, dotRadius, 8, rotRad);
          break;

        case 'star':
          drawStar(ctx, cx, cy, dotRadius, 5, 0.48, rotRad);
          break;

        case 'ring':
          drawRing(ctx, cx, cy, dotRadius, 0.55);
          break;

        case 'cross':
          drawCross(ctx, cx, cy, dotRadius, 0.36, rotRad);
          break;

        default:
          ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
      }

      ctx.fill();

      // For seamless 360 wrap: if this element crosses the left or right seam, duplicate it on the other side
      if (p.seamlessWrap) {
        if (cx - dotRadius < 0) {
          // Duplicate on right edge
          drawDuplicateShape(ctx, cx + W, cy, dotRadius, p.shape, rotRad, dotColor);
        } else if (cx + dotRadius > W) {
          // Duplicate on left edge
          drawDuplicateShape(ctx, cx - W, cy, dotRadius, p.shape, rotRad, dotColor);
        }
      }
    }
  }
}

/** Helper to draw wrapped shape at duplicate coordinate */
function drawDuplicateShape(ctx, cx, cy, dotRadius, shape, rotRad, color) {
  ctx.fillStyle = color;
  ctx.beginPath();
  switch (shape) {
    case 'circle':
      ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
      break;
    case 'triangle':
      drawPolygon(ctx, cx, cy, dotRadius, 3, rotRad);
      break;
    case 'square':
      drawPolygon(ctx, cx, cy, dotRadius, 4, rotRad + Math.PI / 4);
      break;
    case 'diamond':
      drawDiamond(ctx, cx, cy, dotRadius, rotRad);
      break;
    case 'pentagon':
      drawPolygon(ctx, cx, cy, dotRadius, 5, rotRad);
      break;
    case 'hexagon':
      drawPolygon(ctx, cx, cy, dotRadius, 6, rotRad);
      break;
    case 'octagon':
      drawPolygon(ctx, cx, cy, dotRadius, 8, rotRad);
      break;
    case 'star':
      drawStar(ctx, cx, cy, dotRadius, 5, 0.48, rotRad);
      break;
    case 'ring':
      drawRing(ctx, cx, cy, dotRadius, 0.55);
      break;
    case 'cross':
      drawCross(ctx, cx, cy, dotRadius, 0.36, rotRad);
      break;
    default:
      ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
  }
  ctx.fill();
}
