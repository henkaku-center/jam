const STATE_VERSION = 'manifold-downbeat-hand-v1';
const THREE_URL = '/vendor/three.module.js';
const META_URL = '/assets/manifold/meta.json';
const FACES_URL = '/assets/manifold/faces.bin';
const TRAJ_URL = '/assets/manifold/traj/0.bin';
const TRAJECTORY_ID = 0;

function finite(value, fallback) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

async function fetchArrayBuffer(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} ${response.status}`);
  return response.arrayBuffer();
}

function decodeTrajectory(buffer, meta) {
  const frames = meta.n_frames;
  const verts = meta.n_verts;
  const expected = frames * verts * 3;
  const quantized = new Uint16Array(buffer);
  if (quantized.length < expected) {
    throw new Error(`trajectory has ${quantized.length} values, expected ${expected}`);
  }

  const [min, max] = meta.bboxes[TRAJECTORY_ID];
  const sx = (max[0] - min[0]) / 65535;
  const sy = (max[1] - min[1]) / 65535;
  const sz = (max[2] - min[2]) / 65535;
  const positions = new Float32Array(expected);

  for (let i = 0; i < expected; i += 3) {
    positions[i] = min[0] + quantized[i] * sx;
    positions[i + 1] = min[1] + quantized[i + 1] * sy;
    positions[i + 2] = min[2] + quantized[i + 2] * sz;
  }

  return positions;
}

function fitFrameToUnit(data, verts) {
  const center = [0, 0, 0];
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < verts * 3; i += 3) {
    min[0] = Math.min(min[0], data[i]);
    min[1] = Math.min(min[1], data[i + 1]);
    min[2] = Math.min(min[2], data[i + 2]);
    max[0] = Math.max(max[0], data[i]);
    max[1] = Math.max(max[1], data[i + 1]);
    max[2] = Math.max(max[2], data[i + 2]);
  }

  center[0] = (min[0] + max[0]) * 0.5;
  center[1] = (min[1] + max[1]) * 0.5;
  center[2] = (min[2] + max[2]) * 0.5;
  const scale = 2.9 / Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 0.001);
  return { center, scale };
}

export default async function setup(ctx, prevState) {
  const previousMatches = prevState?.stateVersion === STATE_VERSION;
  const state = {
    stateVersion: STATE_VERSION,
    spin: previousMatches ? clamp(finite(prevState.spin, 0.58), 0, 1) : 0.58,
    glow: previousMatches ? clamp(finite(prevState.glow, 0.86), 0, 1) : 0.86,
    gesture: previousMatches ? clamp(finite(prevState.gesture, 0.94), 0, 1) : 0.94
  };

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }
      .hand-stage {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 300px;
        min-height: 260px;
        overflow: hidden;
        background: transparent;
      }
      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }
      .loading {
        position: absolute;
        inset: 0;
        display: grid;
        place-items: center;
        color: #cdd1e0;
        background: transparent;
        font: 11px/1.3 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }
      .loading.is-hidden {
        display: none;
      }
    </style>
    <div class="hand-stage">
      <canvas id="handCanvas" aria-label="Manifold animated hand synced to the downbeat"></canvas>
      <div id="loading" class="loading">loading hand</div>
    </div>
  `;

  const canvas = ctx.domRoot.querySelector('#handCanvas');
  const loading = ctx.domRoot.querySelector('#loading');
  const frameStyle = document.createElement('style');
  frameStyle.textContent = `
    #wrapper-${ctx.elementId}.active-focus::after {
      display: none !important;
    }
  `;
  document.head.appendChild(frameStyle);
  let renderer = null;
  let geometry = null;
  let material = null;
  let handMesh = null;
  let glowMesh = null;
  let raf = 0;
  let destroyed = false;
  let currentStep = 0;
  let downbeatPulse = 0;
  let gestureStartMs = performance.now();
  let gestureDurationMs = 2000;
  let lastRenderedFrame = -1;
  let lastWidth = 0;
  let lastHeight = 0;
  let lastDpr = 0;
  const disposables = [];

  try {
    const [THREE, meta, facesBuffer, trajBuffer] = await Promise.all([
      import(THREE_URL),
      fetch(META_URL).then((response) => {
        if (!response.ok) throw new Error(`${META_URL} ${response.status}`);
        return response.json();
      }),
      fetchArrayBuffer(FACES_URL),
      fetchArrayBuffer(TRAJ_URL)
    ]);

    if (destroyed) {
      return {
        update() {},
        getState() { return { ...state }; },
        destroy() {
          frameStyle.remove();
        }
      };
    }

    const frames = meta.n_frames;
    const verts = meta.n_verts;
    const stride = verts * 3;
    const allPositions = decodeTrajectory(trajBuffer, meta);
    const fit = fitFrameToUnit(allPositions.subarray(0, stride), verts);
    const positions = new Float32Array(stride);
    const faces = new Uint32Array(facesBuffer);

    const scene = new THREE.Scene();
    scene.background = null;
    scene.fog = new THREE.Fog(0x050612, 5.4, 9.6);

    const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 30);
    camera.position.set(0, -0.18, 6.2);
    camera.lookAt(0, -0.12, 0);

    renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(1);

    scene.add(new THREE.AmbientLight(0x6edcff, 0.62));
    const key = new THREE.DirectionalLight(0xfff0df, 1.35);
    key.position.set(1.4, 1.8, 2.2);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0xff2bc2, 1.05);
    rim.position.set(-1.6, -0.7, 1.4);
    scene.add(rim);

    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setIndex(new THREE.BufferAttribute(faces, 1));

    material = new THREE.MeshPhysicalMaterial({
      color: 0xf7fbff,
      emissive: 0x1eeeff,
      emissiveIntensity: 0.18,
      roughness: 0.42,
      metalness: 0.08,
      transmission: 0,
      clearcoat: 0.62,
      clearcoatRoughness: 0.28,
      side: THREE.DoubleSide
    });

    handMesh = new THREE.Mesh(geometry, material);
    handMesh.rotation.set(-0.28, 0.2, 0.03);
    scene.add(handMesh);

    glowMesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
      color: 0x00f6ff,
      transparent: true,
      opacity: 0.11,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.BackSide
    }));
    glowMesh.rotation.copy(handMesh.rotation);
    glowMesh.scale.setScalar(1.045);
    scene.add(glowMesh);

    disposables.push(geometry, material, glowMesh.material);

    function writeFrame(frameFloat) {
      const frame = clamp(frameFloat, 0, frames - 1);
      const f0 = Math.floor(frame);
      const f1 = Math.min(f0 + 1, frames - 1);
      const amount = frame - f0;
      const inv = 1 - amount;
      const base0 = f0 * stride;
      const base1 = f1 * stride;
      const beatLift = downbeatPulse * 0.045;

      for (let i = 0; i < stride; i += 3) {
        const x = allPositions[base0 + i] * inv + allPositions[base1 + i] * amount;
        const y = allPositions[base0 + i + 1] * inv + allPositions[base1 + i + 1] * amount;
        const z = allPositions[base0 + i + 2] * inv + allPositions[base1 + i + 2] * amount;
        positions[i] = (x - fit.center[0]) * fit.scale;
        positions[i + 1] = (z - fit.center[2]) * fit.scale - 0.08 + beatLift;
        positions[i + 2] = -(y - fit.center[1]) * fit.scale;
      }

      geometry.attributes.position.needsUpdate = true;
      geometry.computeVertexNormals();
      geometry.computeBoundingSphere();
    }

    function resize() {
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const dpr = Math.max(1, Math.min(1.5, window.devicePixelRatio || 1));
      if (width === lastWidth && height === lastHeight && dpr === lastDpr) return;
      lastWidth = width;
      lastHeight = height;
      lastDpr = dpr;
      renderer.setPixelRatio(dpr);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }

    function render(now) {
      if (destroyed) return;
      raf = requestAnimationFrame(render);
      resize();

      downbeatPulse *= 0.9;
      const phase = clamp((now - gestureStartMs) / Math.max(320, gestureDurationMs), 0, 1);
      const eased = 0.5 - Math.cos(phase * Math.PI) * 0.5;
      const swing = Math.sin(phase * Math.PI);
      const frame = eased * (frames - 1) * state.gesture;
      if (Math.abs(frame - lastRenderedFrame) > 0.015 || downbeatPulse > 0.03) {
        writeFrame(frame);
        lastRenderedFrame = frame;
      }

      const downbeatScale = 1 + downbeatPulse * 0.12;
      handMesh.scale.setScalar(downbeatScale);
      handMesh.rotation.y = 0.35 + Math.sin(now * 0.00042) * (0.2 + state.spin * 0.28) + swing * 0.2;
      handMesh.rotation.z = 0.06 + Math.sin(now * 0.00031) * 0.08 - downbeatPulse * 0.08;
      handMesh.rotation.x = -0.34 + Math.sin(phase * Math.PI * 2) * 0.08;
      handMesh.position.y = Math.sin(phase * Math.PI) * 0.08 + downbeatPulse * 0.12;
      handMesh.position.x = Math.sin(now * 0.00023) * 0.08;

      glowMesh.rotation.copy(handMesh.rotation);
      glowMesh.position.copy(handMesh.position);
      glowMesh.scale.setScalar(downbeatScale * (1.05 + downbeatPulse * 0.16));
      glowMesh.material.opacity = 0.08 + state.glow * 0.1 + downbeatPulse * 0.26;
      material.emissiveIntensity = 0.12 + state.glow * 0.18 + downbeatPulse * 0.55;

      renderer.render(scene, camera);
    }

    const unsubscribeClock = ctx.clock.onTick(({ step, duration }) => {
      currentStep = ((step % 16) + 16) % 16;
      if (Number.isFinite(duration) && duration > 0) {
        gestureDurationMs = clamp(duration * 16 * 1000, 900, 4800);
      }
      if (currentStep === 0) {
        gestureStartMs = performance.now();
        downbeatPulse = 1;
        lastRenderedFrame = -1;
      } else if (currentStep % 4 === 0) {
        downbeatPulse = Math.max(downbeatPulse, 0.42);
      }
    });

    loading.classList.add('is-hidden');
    writeFrame(0);
    raf = requestAnimationFrame(render);

    return {
      update() {},
      getState() {
        return { ...state };
      },
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        unsubscribeClock();
        frameStyle.remove();
        disposables.forEach((item) => item.dispose?.());
        renderer?.dispose();
      }
    };
  } catch (error) {
    loading.textContent = `hand load failed: ${error.message}`;
    return {
      update() {},
      getState() {
        return { ...state };
      },
      destroy() {
        destroyed = true;
        cancelAnimationFrame(raf);
        frameStyle.remove();
      }
    };
  }
}
