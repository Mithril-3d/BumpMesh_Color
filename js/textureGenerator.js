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
  {
    name: 'Electric Lime (Wrapping)',
    colors: ['#ffffff', '#84cc16', '#0f172a'],
    bgIndex: 2, // Dark slate background
  },
];

// ── Shape Drawing Helpers ───────────────────────────────────────────────────

/** Draw rounded rectangle on 2D context */
export function drawRoundedRect(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

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

/**
 * Schlick's bias function.
 * Maps [0, 1] -> [0, 1].
 * bias = 0.5 is linear.
 * bias < 0.5 pushes curve toward 0 (shifts midpoint left/down).
 * bias > 0.5 pushes curve toward 1 (shifts midpoint right/up).
 */
export function schlickBias(t, bias = 0.5) {
  const clampT = Math.max(0, Math.min(1, t));
  const b = Math.max(0.01, Math.min(0.99, bias));
  return clampT / ((1 / b - 2) * (1 - clampT) + 1);
}

/** Apply curvature profile */
export function applyProfile(t, profile = 'linear') {
  const clampT = Math.max(0, Math.min(1, t));
  switch (profile) {
    case 'linear':
      return clampT;
    case 'smoothstep':
      return clampT * clampT * (3 - 2 * clampT);
    case 'ease_in':
      return clampT * clampT;
    case 'ease_out':
      return 1 - (1 - clampT) * (1 - clampT);
    default:
      return clampT;
  }
}

// ── Default Generator Settings ───────────────────────────────────────────────

export const DEFAULT_TEXTURE_GENERATOR_PARAMS = {
  width: 2513,          // Default for Ø80 x 100 mm cylinder (80 * PI ≈ 251.3 mm)
  height: 1000,
  colors: ['#ffffff', '#ff6600', '#000000'],
  bgIndex: 2,           // Index 2 (#000000) is background, 0 (#ffffff) and 1 (#ff6600) are gradient
  shape: 'circle',      // 'circle' | 'triangle' | 'square' | 'rounded_square' | 'diamond' | 'pentagon' | 'hexagon' | 'octagon' | 'star' | 'ring' | 'cross' | 'truchet'
  layout: 'vertical',   // 'vertical' | 'horizontal_blend' | 'wave' | 'radial' | 'diagonal' | 'double_edge' | 'noise' | 'inversion'
  gridType: 'staggered',// 'staggered' (hexagonal/brick) | 'grid' (orthogonal)
  columns: 60,          // Number of horizontal cells across width
  minSize: 0.05,        // 0.0 - 1.0 (relative to cell radius)
  maxSize: 0.95,        // 0.0 - 1.0
  bias: 0.5,            // 0.05 - 0.95 (0.5 = balanced center, <0.5 = shift to Color A, >0.5 = shift to Color B)
  sizeBias: 0.5,        // Independent size falloff bias
  linkSizeAndColor: true,// Keep color and size bias linked together
  profile: 'linear',    // 'linear' | 'smoothstep' | 'ease_in' | 'ease_out'
  curve: 1.0,           // Falloff exponent (1.0 = normal)
  spread: 1.0,          // Gradient spread / range (0.2 - 2.0)
  offset: 0.0,          // Gradient position offset (-1.0 to 1.0)
  invert: false,        // Invert direction
  rotation: 0,          // Element rotation in degrees
  seamlessWrap: true,   // Ensure left and right edges match seamlessly
  waveFrequency: 2,     // Waves across the width for wave layout
  waveAmplitude: 0.25,  // Wave amplitude relative to height
  seed: 42,             // Seed for procedural variations (Truchet maze, organic noise)
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

  // 4. Special Shape: Truchet Tile (Filled Bicolor Smith Truchet)
  if (p.shape === 'truchet') {
    let truchetCols = Math.max(4, Math.round(Number(p.columns) || 40));
    // Enforce even number of columns for seamless 360 checkerboard parity wrap
    if (p.seamlessWrap && truchetCols % 2 !== 0) {
      truchetCols += 1;
    }
    const size = W / truchetCols;
    const truchetRows = Math.ceil(H / size);
    const r = size * 0.5;
    const seedVal = Number(p.seed) || 42;

    function tileHash(c, row) {
      const wrappedC = ((c % truchetCols) + truchetCols) % truchetCols;
      const dot = Math.sin((wrappedC + seedVal * 17.13) * 12.9898 + (row + seedVal * 31.41) * 78.233) * 43758.5453123;
      return dot - Math.floor(dot);
    }

    for (let row = 0; row < truchetRows; row++) {
      const y0 = row * size;
      const cy = (row + 0.5) * size;
      const v = Math.min(1, Math.max(0, cy / H));

      for (let col = 0; col < truchetCols; col++) {
        const x0 = col * size;
        const cx = (col + 0.5) * size;
        const u = (cx % W) / W;

        let t = 0;
        switch (p.layout) {
          case 'vertical':
            t = 1.0 - v;
            break;
          case 'horizontal_blend':
            t = u;
            break;
          case 'wave': {
            const wavePhase = Math.sin(u * Math.PI * 2 * waveFreq);
            const vMod = v + wavePhase * waveAmp;
            t = 1.0 - Math.max(0, Math.min(1, vMod));
            break;
          }
          case 'radial': {
            const dx = (u - 0.5) * (W / H);
            const dy = v - 0.5;
            const dist = Math.sqrt(dx * dx + dy * dy) * 2;
            t = Math.max(0, Math.min(1, dist));
            break;
          }
          case 'diagonal':
            t = (u + (1.0 - v)) * 0.5;
            break;
          case 'double_edge': {
            const distFromEdge = Math.abs(v - 0.5) * 2;
            t = 1.0 - distFromEdge;
            break;
          }
          case 'noise': {
            const baseV = 1.0 - v;
            const n = hash2d(col * 0.31, row * 0.31);
            t = Math.max(0, Math.min(1, baseV * 0.75 + n * 0.25));
            break;
          }
          default:
            t = 1.0 - v;
        }

        if (invert) t = 1.0 - t;

        let normT = (t - 0.5 - offset) / spread + 0.5;
        normT = Math.max(0, Math.min(1, normT));

        const colorBiasVal = (p.bias !== undefined) ? p.bias : 0.5;
        const profiledT = applyProfile(normT, p.profile || 'linear');
        const colorProgress = schlickBias(profiledT, colorBiasVal);
        const finalColorT = (curve !== 1.0) ? Math.pow(colorProgress, curve) : colorProgress;

        const tileColor = lerpColor(rgbA, rgbB, finalColorT);

        // Deterministic orientation: 0 (TL & BR) or 1 (TR & BL)
        const orient = tileHash(col, row) > 0.5 ? 1 : 0;
        const parity = (col + row) % 2;

        // Checkerboard parity coloring:
        // parity 0: ribbon is tileColor, corners are bgColor_hex
        // parity 1: ribbon is bgColor_hex, corners are tileColor
        const ribbonCol = (parity === 0) ? tileColor : bgColor_hex;
        const cornerCol = (parity === 0) ? bgColor_hex : tileColor;

        // Base cell rectangle (slightly expand by 0.25px to prevent antialiasing seams)
        ctx.fillStyle = ribbonCol;
        ctx.fillRect(x0 - 0.25, y0 - 0.25, size + 0.5, size + 0.5);

        // Draw the 2 quarter-circle arcs
        ctx.fillStyle = cornerCol;
        if (orient === 0) {
          // Top-Left (x0, y0)
          ctx.beginPath();
          ctx.moveTo(x0, y0);
          ctx.arc(x0, y0, r, 0, Math.PI * 0.5);
          ctx.closePath();
          ctx.fill();

          // Bottom-Right (x0 + size, y0 + size)
          ctx.beginPath();
          ctx.moveTo(x0 + size, y0 + size);
          ctx.arc(x0 + size, y0 + size, r, Math.PI, Math.PI * 1.5);
          ctx.closePath();
          ctx.fill();
        } else {
          // Top-Right (x0 + size, y0)
          ctx.beginPath();
          ctx.moveTo(x0 + size, y0);
          ctx.arc(x0 + size, y0, r, Math.PI * 0.5, Math.PI);
          ctx.closePath();
          ctx.fill();

          // Bottom-Left (x0, y0 + size)
          ctx.beginPath();
          ctx.moveTo(x0, y0 + size);
          ctx.arc(x0, y0 + size, r, Math.PI * 1.5, Math.PI * 2);
          ctx.closePath();
          ctx.fill();
        }
      }
    }
    return;
  }

  // 5. Special Layout: Figure-Ground Inversion (主導権反転 / 図地反転)
  if (p.layout === 'inversion') {
    let invCols = Math.max(4, Math.round(Number(p.columns) || 48));
    // Enforce even number of columns for seamless 360 wrap
    if (p.seamlessWrap && invCols % 2 !== 0) {
      invCols += 1;
    }
    const size = W / invCols;
    const invRows = Math.ceil(H / size);

    // Transition boundary Y (0.0 to 1.0)
    const midV = Math.max(0.05, Math.min(0.95, 0.5 + offset));
    const midY = midV * H;

    const colorBiasVal = (p.bias !== undefined) ? p.bias : 0.5;
    const topIsBg = !invert;

    // Continuous background fill without individual cell rectangles (completely eliminates grid borders!)
    if (topIsBg) {
      // Bottom half is filled with continuous linear gradient
      const grad = ctx.createLinearGradient(0, midY, 0, H);
      const colorProgressMid = schlickBias(applyProfile(0.5, p.profile || 'linear'), colorBiasVal);
      const finalMidT = (curve !== 1.0) ? Math.pow(colorProgressMid, curve) : colorProgressMid;
      const colorProgressBot = schlickBias(applyProfile(1.0, p.profile || 'linear'), colorBiasVal);
      const finalBotT = (curve !== 1.0) ? Math.pow(colorProgressBot, curve) : colorProgressBot;
      grad.addColorStop(0, lerpColor(rgbA, rgbB, finalMidT));
      grad.addColorStop(1, lerpColor(rgbA, rgbB, finalBotT));
      ctx.fillStyle = grad;
      ctx.fillRect(0, midY, W, H - midY);
    } else {
      // Top half is filled with continuous linear gradient
      const grad = ctx.createLinearGradient(0, 0, 0, midY);
      const colorProgressTop = schlickBias(applyProfile(1.0, p.profile || 'linear'), colorBiasVal);
      const finalTopT = (curve !== 1.0) ? Math.pow(colorProgressTop, curve) : colorProgressTop;
      const colorProgressMid = schlickBias(applyProfile(0.5, p.profile || 'linear'), colorBiasVal);
      const finalMidT = (curve !== 1.0) ? Math.pow(colorProgressMid, curve) : colorProgressMid;
      grad.addColorStop(0, lerpColor(rgbA, rgbB, finalTopT));
      grad.addColorStop(1, lerpColor(rgbA, rgbB, finalMidT));
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, W, midY);
    }

    for (let row = 0; row < invRows; row++) {
      const cy = (row + 0.5) * size;
      const v = Math.min(1, Math.max(0, cy / H));

      let t = v;
      if (invert) t = 1.0 - t;

      let normT = (t - 0.5 - offset) / spread + 0.5;
      normT = Math.max(0, Math.min(1, normT));

      const profiledT = applyProfile(normT, p.profile || 'linear');
      const colorProgress = schlickBias(profiledT, colorBiasVal);
      const finalColorT = (curve !== 1.0) ? Math.pow(colorProgress, curve) : colorProgress;

      const isTop = topIsBg ? (cy < midY) : (cy >= midY);

      // Distance from transition boundary (0 at midY, 1 at boundaries)
      const distFromBoundary = Math.abs(cy - midY) / Math.max(midY, H - midY);

      // Scale reaches 1.01 at boundary for 100% gapless tessellation
      const scale = Math.min(1.015, 0.08 + 0.935 * Math.cos(distFromBoundary * Math.PI * 0.5));

      // Morph corner radius towards 0 at the boundary (smoothstep)
      // This eliminates the corner gaps where underlying background would otherwise show through!
      const tMorph = distFromBoundary * distFromBoundary * (3 - 2 * distFromBoundary);

      const sqSize = size * scale;
      const halfSq = sqSize * 0.5;

      const tileColor = lerpColor(rgbA, rgbB, finalColorT);
      const shapeCol = isTop ? tileColor : bgColor_hex;

      for (let col = 0; col < invCols; col++) {
        const parity = (col + row) % 2;
        const shouldDrawShape = isTop ? (parity === 0) : (parity === 1);
        if (!shouldDrawShape) continue;

        const cx = (col + 0.5) * size;
        ctx.fillStyle = shapeCol;

        const renderAtX = (xCenter) => {
          switch (p.shape) {
            case 'square':
              ctx.fillRect(xCenter - halfSq, cy - halfSq, sqSize, sqSize);
              break;

            case 'circle': {
              if (tMorph < 0.25) {
                // Smoothly morph to square towards boundary to maintain 100% tessellation
                const rx = halfSq * (0.8 * tMorph);
                drawRoundedRect(ctx, xCenter - halfSq, cy - halfSq, sqSize, sqSize, rx);
                ctx.fill();
              } else {
                ctx.beginPath();
                ctx.arc(xCenter, cy, halfSq, 0, Math.PI * 2);
                ctx.fill();
              }
              break;
            }

            case 'diamond':
              drawDiamond(ctx, xCenter, cy, halfSq, rotRad);
              ctx.fill();
              break;

            case 'triangle':
              drawPolygon(ctx, xCenter, cy, halfSq, 3, rotRad);
              ctx.fill();
              break;

            case 'hexagon':
              drawPolygon(ctx, xCenter, cy, halfSq, 6, rotRad);
              ctx.fill();
              break;

            case 'star':
              drawStar(ctx, xCenter, cy, halfSq, 5, 0.48, rotRad);
              ctx.fill();
              break;

            case 'rounded_square':
            default: {
              const rx = sqSize * 0.30 * tMorph;
              drawRoundedRect(ctx, xCenter - halfSq, cy - halfSq, sqSize, sqSize, rx);
              ctx.fill();
              break;
            }
          }
        };

        renderAtX(cx);
        // Seamless horizontal wrap duplicate
        if (p.seamlessWrap) {
          if (cx - halfSq < 0) renderAtX(cx + W);
          else if (cx + halfSq > W) renderAtX(cx - W);
        }
      }
    }
    return;
  }

  // 6. Iterate Over Regular Dot Grid Elements
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
      let normT = (t - 0.5 - offset) / spread + 0.5;
      normT = Math.max(0, Math.min(1, normT));

      // Dot Size Factor:
      // Keep dot sizing purely uniform and independent from color gradient bias!
      const currentScale = maxS - normT * (maxS - minS);
      const dotRadius = baseRadius * currentScale;

      // Skip drawing if size is negligible (< 0.25 px)
      if (dotRadius <= 0.25) continue;

      // Color Gradient Factor:
      // Only the COLOR transition is affected by Curvature Profile and Bias (片側に寄せる)
      const colorBiasVal = (p.bias !== undefined) ? p.bias : 0.5;
      const profiledT = applyProfile(normT, p.profile || 'linear');
      const colorProgress = schlickBias(profiledT, colorBiasVal);
      const finalColorT = (curve !== 1.0) ? Math.pow(colorProgress, curve) : colorProgress;

      // Calculate Interpolated Color:
      // finalColorT = 0.0 -> Color A (e.g. orange)
      // finalColorT = 1.0 -> Color B (e.g. white)
      const dotColor = lerpColor(rgbA, rgbB, finalColorT);

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

        case 'rounded_square':
          drawRoundedRect(ctx, cx - dotRadius, cy - dotRadius, dotRadius * 2, dotRadius * 2, dotRadius * 0.56);
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
    case 'rounded_square':
      drawRoundedRect(ctx, cx - dotRadius, cy - dotRadius, dotRadius * 2, dotRadius * 2, dotRadius * 0.56);
      break;
    default:
      ctx.arc(cx, cy, dotRadius, 0, Math.PI * 2);
  }
  ctx.fill();
}
