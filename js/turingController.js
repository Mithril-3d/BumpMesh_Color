/*
 * Copyright (c) 2026 CNCKitchen (Stefan Hermann) and contributors
 * BumpMesh_Color by @Mithril_MEX
 * SPDX-License-Identifier: AGPL-3.0-only
 */

/**
 * turingController.js — Controller for 3D Mesh Turing Pattern Generator (Approach B)
 *
 * Handles uniform remeshing, surface reaction-diffusion simulation loop,
 * interactive 3D click-seeding via raycasting, and displacement baking.
 */

import { THREE } from './threeCompat.js';
import { buildMeshGraph, MeshTuringSimulator, TURING_PRESETS } from './meshTuring.js?v=20260929_130';
import { t } from './i18n.js?v=20260929_130';

export function initTuringController({
  getGeometry,
  setGeometry,
  getMesh,
  getCamera,
  getRendererCanvas,
  requestRender,
  subdivide,
  regularizeMesh,
  getRegularizeOpts,
  getExcludedFaces,
  getInvertMask,
  buildFaceWeights,
}) {
  // DOM Elements
  const secretTrigger = document.getElementById('secret-turing-trigger');
  const openBtn       = document.getElementById('open-turing-btn');
  const panel         = document.getElementById('turing-panel');
  const closeBtn      = document.getElementById('turing-close-btn');
  const cancelBtn     = document.getElementById('turing-cancel-btn');
  const applyBtn      = document.getElementById('turing-apply-btn');

  const vertCountBadge = document.getElementById('turing-vert-count');
  const edgeSlider     = document.getElementById('turing-edge-slider');
  const edgeVal        = document.getElementById('turing-edge-val');
  const remeshBtn      = document.getElementById('turing-remesh-btn');

  const presetBtns     = document.querySelectorAll('.turing-preset-btn');
  const seedRadiusSlider = document.getElementById('turing-seed-radius-slider');
  const seedRadiusVal    = document.getElementById('turing-seed-radius-val');
  const clickSeedBtn   = document.getElementById('turing-click-seed-btn');
  const randomSeedBtn  = document.getElementById('turing-random-seed-btn');
  const resetBtn       = document.getElementById('turing-reset-btn');
  const seedHint       = document.getElementById('turing-seed-hint');

  const playBtn        = document.getElementById('turing-play-btn');
  const playIcon       = document.getElementById('turing-play-icon');
  const playText       = document.getElementById('turing-play-text');
  const stepBtn        = document.getElementById('turing-step-btn');
  const stepCounter    = document.getElementById('turing-step-counter');
  const speedSlider    = document.getElementById('turing-speed-slider');
  const speedVal       = document.getElementById('turing-speed-val');

  const heightSlider   = document.getElementById('turing-height-slider');
  const heightVal      = document.getElementById('turing-height-val');
  const feedSlider     = document.getElementById('turing-feed-slider');
  const feedVal        = document.getElementById('turing-feed-val');
  const killSlider     = document.getElementById('turing-kill-slider');
  const killVal        = document.getElementById('turing-kill-val');

  // State
  let isOpen = false;
  let isPlaying = false;
  let clickSeedActive = true;
  let simulator = null;
  let baseGeometry = null;
  let workingGeometry = null;
  let originalBasePositions = null;
  let originalMeshGeometry = null;
  let animFrameId = null;

  const raycaster = new THREE.Raycaster();
  const mouseNDC = new THREE.Vector2();

  // ── Secret Trigger / URL Param ──────────────────────────────────────────────
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('turing') === '1' || urlParams.get('secret') === '2') {
    if (openBtn) openBtn.classList.remove('hidden');
  }

  if (secretTrigger) {
    secretTrigger.addEventListener('click', () => {
      if (openBtn) {
        openBtn.classList.toggle('hidden');
        if (!openBtn.classList.contains('hidden')) {
          openPanel();
        }
      } else {
        openPanel();
      }
    });
  }

  if (openBtn) {
    openBtn.addEventListener('click', () => openPanel());
  }

  if (closeBtn) closeBtn.addEventListener('click', () => closePanel(false));
  if (cancelBtn) cancelBtn.addEventListener('click', () => closePanel(false));

  // ── Panel Open / Close ──────────────────────────────────────────────────────
  async function openPanel() {
    if (isOpen) return;
    isOpen = true;
    panel.classList.remove('hidden');

    // Save current geometry so user can cancel without destruction
    originalMeshGeometry = getGeometry();

    // Perform initial remesh and graph build
    await prepareMesh();
  }

  function closePanel(applied = false) {
    if (!isOpen) return;
    pause();
    isOpen = false;
    panel.classList.add('hidden');

    if (!applied && originalMeshGeometry) {
      // Revert mesh
      setGeometry(originalMeshGeometry);
      const mesh = getMesh();
      if (mesh) {
        mesh.geometry = originalMeshGeometry;
      }
      requestRender();
    }
  }

  // ── Remesh & Simulator Preparation ──────────────────────────────────────────
  async function prepareMesh() {
    pause();
    let sourceGeo = originalMeshGeometry ?? getGeometry();
    if (!sourceGeo) {
      for (let w = 0; w < 10; w++) {
        await new Promise(r => setTimeout(r, 100));
        sourceGeo = originalMeshGeometry ?? getGeometry();
        if (sourceGeo) break;
      }
    }
    if (!sourceGeo) return;
    originalMeshGeometry = sourceGeo;

    const targetEdge = parseFloat(edgeSlider.value) || 1.2;
    remeshBtn.disabled = true;
    remeshBtn.textContent = '⏳ ' + (t('turing.remeshing') || '均一リメッシュ中…');

    try {
      console.log('[Turing] Starting prepareMesh with targetEdge:', targetEdge, 'sourceGeo vertices:', sourceGeo.attributes.position.count);
      
      // Check exclusion paint mask
      const excludedFaces = getExcludedFaces?.();
      const invertMask = getInvertMask?.() ?? false;
      let faceWeights = null;
      if (excludedFaces && excludedFaces.size > 0 && typeof buildFaceWeights === 'function') {
        faceWeights = buildFaceWeights(sourceGeo, excludedFaces, invertMask);
        console.log('[Turing] Applied faceWeights from excludedFaces, count:', excludedFaces.size);
      }

      // 1. Subdivide to targetEdge
      const { geometry: subGeo, faceParentId } = await subdivide(
        sourceGeo, targetEdge, null, faceWeights, { fast: true }
      );
      console.log('[Turing] Subdivide done, subGeo vertices:', subGeo.attributes.position.count);

      // 2. Regularize slivers
      let regGeo = subGeo;
      if (typeof regularizeMesh === 'function') {
        const regResult = regularizeMesh(subGeo, faceParentId, targetEdge, getRegularizeOpts?.() ?? {});
        subGeo.dispose();
        regGeo = regResult.geometry;
        console.log('[Turing] Regularize done, regGeo vertices:', regGeo.attributes.position.count);
      }

      baseGeometry = regGeo;
      workingGeometry = regGeo.clone();
      originalBasePositions = new Float32Array(baseGeometry.attributes.position.array);

      // 3. Build cotangent graph
      const graph = buildMeshGraph(workingGeometry);
      console.log('[Turing] Graph built, unique vertices:', graph.uniqueCount);
      vertCountBadge.textContent = `${graph.uniqueCount.toLocaleString()} vertices`;

      // 4. Create Simulator with active preset
      const activeBtn = panel.querySelector('.turing-preset-btn.active');
      const activePresetId = activeBtn?.dataset?.preset || 'maze';
      simulator = new MeshTuringSimulator(graph, {
        height: parseFloat(heightSlider.value),
        feed: parseFloat(feedSlider.value),
        kill: parseFloat(killSlider.value),
        subSteps: parseInt(speedSlider.value, 10),
      });
      simulator.setPreset(activePresetId);
      // Synchronize slider values if custom wasn't tweaked
      const p = TURING_PRESETS[activePresetId];
      if (p) {
        simulator.feed = parseFloat(feedSlider.value) || p.feed;
        simulator.kill = parseFloat(killSlider.value) || p.kill;
      }

      // 4b. Map excluded vertices into simulator
      const exclAttr = workingGeometry.attributes.excludeWeight;
      if (exclAttr) {
        const exclArr = exclAttr.array;
        const excludedMask = new Uint8Array(graph.uniqueCount);
        let exclCount = 0;
        for (let i = 0; i < graph.vertexCount; i++) {
          if (exclArr[i] > 0.5) {
            const uIdx = graph.vertexToUnique[i];
            if (!excludedMask[uIdx]) {
              excludedMask[uIdx] = 1;
              exclCount++;
            }
          }
        }
        if (exclCount > 0) {
          console.log(`[Turing] Protected ${exclCount} unique excluded vertices from pattern propagation`);
          simulator.setExcludedVertices(excludedMask);
        }
      }

      // Update mesh in viewer
      const mesh = getMesh();
      if (mesh) {
        mesh.geometry = workingGeometry;
      }

      updateStepDisplay();
      requestRender();
    } catch (err) {
      console.error('[Turing] Failed to prepare mesh:', err);
    } finally {
      remeshBtn.disabled = false;
      remeshBtn.innerHTML = '<span>⚡</span> <span>' + (t('turing.remeshBtn') || 'メッシュを均一化して準備') + '</span>';
    }
  }

  remeshBtn.addEventListener('click', () => prepareMesh());

  edgeSlider.addEventListener('input', () => {
    edgeVal.textContent = `${parseFloat(edgeSlider.value).toFixed(1)} mm`;
  });

  // ── Presets ─────────────────────────────────────────────────────────────────
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      const presetId = btn.dataset.preset;
      const p = TURING_PRESETS[presetId];
      if (p && simulator) {
        simulator.setPreset(presetId);
        feedSlider.value = p.feed;
        feedVal.textContent = p.feed.toFixed(3);
        killSlider.value = p.kill;
        killVal.textContent = p.kill.toFixed(3);
        heightSlider.value = p.defaultHeight;
        heightVal.textContent = `${p.defaultHeight.toFixed(1)} mm`;
        simulator.height = p.defaultHeight;
      }
    });
  });

  // ── Sliders ─────────────────────────────────────────────────────────────────
  heightSlider.addEventListener('input', () => {
    const h = parseFloat(heightSlider.value);
    heightVal.textContent = `${h.toFixed(1)} mm`;
    if (simulator) {
      simulator.height = h;
      if (!isPlaying) {
        updateDisplacementPreview();
      }
    }
  });

  feedSlider.addEventListener('input', () => {
    const f = parseFloat(feedSlider.value);
    feedVal.textContent = f.toFixed(3);
    if (simulator) simulator.feed = f;
  });

  killSlider.addEventListener('input', () => {
    const k = parseFloat(killSlider.value);
    killVal.textContent = k.toFixed(3);
    if (simulator) simulator.kill = k;
  });

  speedSlider.addEventListener('input', () => {
    const s = parseInt(speedSlider.value, 10);
    speedVal.textContent = `${s}x`;
    if (simulator) simulator.subSteps = s;
  });

  // ── Seeding ─────────────────────────────────────────────────────────────────
  if (seedRadiusSlider) {
    seedRadiusSlider.addEventListener('input', () => {
      const r = parseFloat(seedRadiusSlider.value);
      if (seedRadiusVal) seedRadiusVal.textContent = `${r.toFixed(1)} mm`;
    });
  }

  clickSeedBtn.addEventListener('click', () => {
    clickSeedActive = !clickSeedActive;
    clickSeedBtn.classList.toggle('active', clickSeedActive);
    seedHint.style.display = clickSeedActive ? 'block' : 'none';
  });

  randomSeedBtn.addEventListener('click', () => {
    if (!simulator) return;
    const radius = parseFloat(seedRadiusSlider?.value) || 3.0;
    simulator.seedRandom(5, radius);
    updateDisplacementPreview();
  });

  resetBtn.addEventListener('click', () => {
    if (!simulator) return;
    pause();
    simulator.reset();
    updateDisplacementPreview();
    updateStepDisplay();
  });

  // Raycasting for interactive click-seeding on model
  const canvas = getRendererCanvas();
  if (canvas) {
    canvas.addEventListener('pointerdown', onCanvasPointerDown);
  }

  function onCanvasPointerDown(e) {
    if (!isOpen || !clickSeedActive || !simulator || isPlaying) return;
    // Only left click without modifier keys
    if (e.button !== 0 || e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return;

    const rect = canvas.getBoundingClientRect();
    mouseNDC.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    mouseNDC.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

    const camera = getCamera();
    const mesh = getMesh();
    if (!camera || !mesh) return;

    raycaster.setFromCamera(mouseNDC, camera);
    const hits = raycaster.intersectObject(mesh);
    if (hits.length > 0) {
      // Find front-most hit
      const hit = hits[0];
      const localPt = mesh.worldToLocal(hit.point.clone());

      // Inject seed around click point with user-selected radius
      const radius = parseFloat(seedRadiusSlider?.value) || 3.0;
      const count = simulator.seedAtPoint(localPt, radius, 1.0);
      if (count > 0) {
        updateDisplacementPreview();
        // Give subtle pulse feedback
        stepCounter.textContent = `Seeded: ${count} pts`;
      }
    }
  }

  // ── Simulation Loop ─────────────────────────────────────────────────────────
  playBtn.addEventListener('click', () => {
    if (isPlaying) {
      pause();
    } else {
      play();
    }
  });

  stepBtn.addEventListener('click', () => {
    if (isPlaying) pause();
    stepOnce();
  });

  function play() {
    if (isPlaying || !simulator) return;
    isPlaying = true;
    playBtn.classList.add('playing');
    playIcon.textContent = '⏸';
    playText.textContent = t('turing.pause') || '一時停止';
    loop();
  }

  function pause() {
    if (!isPlaying) return;
    isPlaying = false;
    if (animFrameId) cancelAnimationFrame(animFrameId);
    animFrameId = null;
    playBtn.classList.remove('playing');
    playIcon.textContent = '▶';
    playText.textContent = t('turing.play') || '成長を開始';
  }

  function stepOnce() {
    if (!simulator) return;
    simulator.step(1);
    updateDisplacementPreview();
    updateStepDisplay();
  }

  function loop() {
    if (!isPlaying || !simulator) return;

    simulator.step(simulator.subSteps);

    // Update positions and normals
    updateDisplacementPreview();
    updateStepDisplay();

    animFrameId = requestAnimationFrame(loop);
  }

  let normalRecalcCounter = 0;
  function updateDisplacementPreview() {
    if (!simulator || !workingGeometry || !originalBasePositions) return;

    const posAttr = workingGeometry.attributes.position;
    simulator.updateDisplacement(originalBasePositions, posAttr, simulator.height);

    // Recalculate normals every 2 frames for smooth lighting and high performance
    if (++normalRecalcCounter % 2 === 0) {
      workingGeometry.computeVertexNormals();
    }
    requestRender();
  }

  function updateStepDisplay() {
    if (simulator && stepCounter) {
      stepCounter.textContent = `Step: ${simulator.stepCount.toLocaleString()}`;
    }
  }

  // ── Apply to Model ──────────────────────────────────────────────────────────
  applyBtn.addEventListener('click', () => {
    if (!workingGeometry || !simulator) return;
    pause();

    // Finalize displaced geometry with recomputed normals
    const finalGeo = simulator.createDisplacedGeometry(baseGeometry, simulator.height);

    // Bake into main BumpMesh model
    setGeometry(finalGeo);
    const mesh = getMesh();
    if (mesh) {
      mesh.geometry = finalGeo;
    }

    originalMeshGeometry = finalGeo;
    closePanel(true);
    requestRender();
  });
}
