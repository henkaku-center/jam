const STATE_VERSION = 'flying-black-necked-crane-visual-v1';

export default function setup(ctx, prevState) {
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const previousMatches = prevState?.stateVersion === STATE_VERSION;
  const state = {
    stateVersion: STATE_VERSION,
    pace: previousMatches ? finite(prevState.pace, 0.7) : 0.7,
    wind: previousMatches ? finite(prevState.wind, 0.48) : 0.48,
    water: previousMatches ? finite(prevState.water, 0.62) : 0.62,
    flock: previousMatches ? prevState.flock !== false : true
  };

  let raf = 0;
  let width = 1;
  let height = 1;
  let dpr = 1;
  let destroyed = false;
  let beatPulse = 0;
  let lastStep = -1;
  const listeners = [];

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .crane-visual {
        position: relative;
        box-sizing: border-box;
        width: 100%;
        height: 100%;
        min-width: 280px;
        min-height: 210px;
        overflow: hidden;
        border: 1px solid rgba(166, 190, 199, 0.58);
        border-radius: 8px;
        background: #071016;
        color: #f8fafc;
        font: 11px/1.2 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }

      .hud {
        position: absolute;
        left: 10px;
        right: 10px;
        top: 9px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        pointer-events: none;
        text-shadow: 0 1px 9px rgba(4, 10, 15, 0.68);
      }

      .title {
        min-width: 0;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        font: 700 12px/1.05 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }

      .pulse {
        width: 42px;
        height: 7px;
        overflow: hidden;
        border: 1px solid rgba(226, 232, 240, 0.62);
        border-radius: 7px;
        background: rgba(3, 7, 18, 0.34);
      }

      .pulse-fill {
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, #f43f5e, #e0f2fe, #2dd4bf);
      }

      .controls {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 10px;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 8px;
        padding: 8px;
        border: 1px solid rgba(226, 232, 240, 0.24);
        border-radius: 8px;
        background: rgba(5, 12, 18, 0.62);
        color: #e5f4f7;
        backdrop-filter: blur(8px);
      }

      label {
        display: grid;
        gap: 4px;
        min-width: 0;
      }

      input {
        width: 100%;
        min-width: 0;
        accent-color: #2dd4bf;
      }

      .toggle {
        height: 26px;
        align-self: end;
        border: 1px solid rgba(226, 232, 240, 0.46);
        border-radius: 6px;
        color: #061016;
        background: #a7f3d0;
        font: inherit;
        cursor: pointer;
      }

      .toggle.off {
        color: #cbd5e1;
        background: rgba(15, 23, 42, 0.78);
      }

      @media (max-width: 360px) {
        .controls {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
    <div class="crane-visual">
      <canvas id="crane-canvas" aria-label="Flying black-necked crane wetland visual"></canvas>
      <div class="hud">
        <div class="title">Flying Black-necked Crane</div>
        <div class="pulse"><div id="pulse-fill" class="pulse-fill"></div></div>
      </div>
      <div class="controls" data-no-drag>
        <label>pace <input id="pace" type="range" min="0.2" max="1.6" step="0.01"></label>
        <label>wind <input id="wind" type="range" min="0" max="1" step="0.01"></label>
        <label>water <input id="water" type="range" min="0" max="1" step="0.01"></label>
        <button id="flock" class="toggle" type="button">flock</button>
      </div>
    </div>
  `;

  const root = ctx.domRoot.querySelector('.crane-visual');
  const canvas = ctx.domRoot.querySelector('#crane-canvas');
  const pulseFill = ctx.domRoot.querySelector('#pulse-fill');
  const controls = {
    pace: ctx.domRoot.querySelector('#pace'),
    wind: ctx.domRoot.querySelector('#wind'),
    water: ctx.domRoot.querySelector('#water'),
    flock: ctx.domRoot.querySelector('#flock')
  };
  const c = canvas.getContext('2d', { alpha: false });

  const setControlValues = () => {
    controls.pace.value = String(state.pace);
    controls.wind.value = String(state.wind);
    controls.water.value = String(state.water);
    controls.flock.classList.toggle('off', !state.flock);
    controls.flock.textContent = state.flock ? 'flock' : 'solo';
  };

  const bindInput = (input, key) => {
    const onInput = () => {
      state[key] = Number(input.value);
      ctx.bus.pubGlobal(`crane_${key}`, state[key]);
    };
    input.addEventListener('input', onInput);
    listeners.push(() => input.removeEventListener('input', onInput));
  };

  bindInput(controls.pace, 'pace');
  bindInput(controls.wind, 'wind');
  bindInput(controls.water, 'water');

  const onFlockClick = () => {
    state.flock = !state.flock;
    setControlValues();
    ctx.bus.pubGlobal('crane_flock', state.flock);
  };
  controls.flock.addEventListener('click', onFlockClick);
  listeners.push(() => controls.flock.removeEventListener('click', onFlockClick));

  const subscriptions = [
    ctx.bus.subGlobal('crane_pace', (value) => {
      if (!Number.isFinite(value)) return;
      state.pace = clamp(value, 0.2, 1.6);
      setControlValues();
    }),
    ctx.bus.subGlobal('crane_wind', (value) => {
      if (!Number.isFinite(value)) return;
      state.wind = clamp(value, 0, 1);
      setControlValues();
    }),
    ctx.bus.subGlobal('crane_water', (value) => {
      if (!Number.isFinite(value)) return;
      state.water = clamp(value, 0, 1);
      setControlValues();
    }),
    ctx.bus.subGlobal('crane_flock', (value) => {
      state.flock = value !== false;
      setControlValues();
    })
  ];

  const unsubscribeClock = ctx.clock.onTick(({ step }) => {
    if (step !== lastStep) {
      lastStep = step;
      beatPulse = 1;
    }
  });

  const resize = () => {
    const rect = root.getBoundingClientRect();
    dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  if (resizeObserver) resizeObserver.observe(root);
  resize();
  setControlValues();

  const ellipse = (x, y, rx, ry, fill, stroke = null, lineWidth = 1, rotation = 0) => {
    c.beginPath();
    c.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
    if (stroke) {
      c.strokeStyle = stroke;
      c.lineWidth = lineWidth;
      c.stroke();
    }
  };

  const drawSky = (t) => {
    const day = c.createLinearGradient(0, 0, 0, height * 0.7);
    day.addColorStop(0, '#83c5d7');
    day.addColorStop(0.38, '#cdebf0');
    day.addColorStop(1, '#eef8f2');
    c.fillStyle = day;
    c.fillRect(0, 0, width, height);

    const sunX = width * 0.78 + Math.sin(t * 0.00009) * width * 0.04;
    const sunY = height * 0.18;
    const glow = c.createRadialGradient(sunX, sunY, 2, sunX, sunY, Math.max(width, height) * 0.36);
    glow.addColorStop(0, 'rgba(255, 248, 205, 0.9)');
    glow.addColorStop(0.38, 'rgba(255, 248, 205, 0.22)');
    glow.addColorStop(1, 'rgba(255, 248, 205, 0)');
    c.fillStyle = glow;
    c.fillRect(0, 0, width, height);

    const mountainY = height * 0.45;
    c.fillStyle = '#6f8791';
    c.beginPath();
    c.moveTo(0, mountainY);
    for (let i = 0; i <= 8; i += 1) {
      const x = (i / 8) * width;
      const y = mountainY - height * (0.09 + 0.13 * Math.abs(Math.sin(i * 1.7)));
      c.lineTo(x, y);
    }
    c.lineTo(width, height * 0.62);
    c.lineTo(0, height * 0.62);
    c.closePath();
    c.fill();

    c.fillStyle = 'rgba(246, 252, 255, 0.74)';
    for (let i = 1; i < 8; i += 2) {
      const x = (i / 8) * width;
      const y = mountainY - height * (0.11 + 0.12 * Math.abs(Math.sin(i * 1.7)));
      c.beginPath();
      c.moveTo(x - width * 0.06, y + height * 0.06);
      c.lineTo(x, y);
      c.lineTo(x + width * 0.052, y + height * 0.07);
      c.closePath();
      c.fill();
    }

    c.fillStyle = '#5b7d65';
    c.beginPath();
    c.moveTo(0, height * 0.55);
    for (let i = 0; i <= 12; i += 1) {
      const x = (i / 12) * width;
      const y = height * (0.55 + 0.025 * Math.sin(i * 0.9 + t * 0.0004));
      c.lineTo(x, y);
    }
    c.lineTo(width, height * 0.68);
    c.lineTo(0, height * 0.68);
    c.closePath();
    c.fill();
  };

  const drawWaterAndReeds = (t) => {
    const waterY = height * 0.56;
    const wetland = c.createLinearGradient(0, waterY, 0, height);
    wetland.addColorStop(0, '#5fa7a8');
    wetland.addColorStop(0.54, '#266d72');
    wetland.addColorStop(1, '#152f2e');
    c.fillStyle = wetland;
    c.fillRect(0, waterY, width, height - waterY);

    const shimmerCount = 22;
    for (let i = 0; i < shimmerCount; i += 1) {
      const y = waterY + (i / shimmerCount) * (height - waterY);
      const drift = Math.sin(t * 0.0012 + i * 1.8) * width * 0.035 * state.water;
      const alpha = 0.07 + 0.1 * state.water * Math.sin(i + t * 0.001) ** 2;
      c.strokeStyle = `rgba(221, 249, 245, ${alpha})`;
      c.lineWidth = 1;
      c.beginPath();
      c.moveTo(width * 0.04 + drift, y);
      c.bezierCurveTo(width * 0.26, y - 8, width * 0.52, y + 10, width * 0.92 - drift, y - 2);
      c.stroke();
    }

    c.fillStyle = 'rgba(19, 53, 38, 0.76)';
    c.fillRect(0, height * 0.79, width, height * 0.21);

    for (let i = 0; i < 54; i += 1) {
      const x = ((i * 37) % 100) / 100 * width;
      const baseY = height * (0.63 + ((i * 19) % 37) / 100);
      const h = height * (0.08 + ((i * 13) % 17) / 130);
      const sway = Math.sin(t * 0.0015 + i) * (3 + state.wind * 10);
      c.strokeStyle = i % 3 === 0 ? '#d2bb6f' : '#466b38';
      c.lineWidth = i % 4 === 0 ? 2 : 1;
      c.beginPath();
      c.moveTo(x, baseY + h * 0.5);
      c.quadraticCurveTo(x + sway * 0.7, baseY - h * 0.3, x + sway, baseY - h);
      c.stroke();
    }
  };

  const drawFlyingFlock = (t) => {
    if (!state.flock) return;
    c.save();
    c.globalAlpha = 0.7;
    c.strokeStyle = '#1f2933';
    c.lineWidth = Math.max(1, Math.min(width, height) * 0.008);
    c.lineCap = 'round';
    for (let i = 0; i < 5; i += 1) {
      const x = ((t * 0.012 * (0.7 + state.pace * 0.2) + i * width * 0.18) % (width * 1.3)) - width * 0.15;
      const y = height * (0.18 + 0.055 * Math.sin(t * 0.0008 + i));
      const s = Math.min(width, height) * (0.018 + i * 0.002);
      const flap = Math.sin(t * 0.007 + i) * s * 0.7;
      c.beginPath();
      c.moveTo(x - s, y);
      c.quadraticCurveTo(x - s * 0.35, y - s * 0.55 - flap, x, y);
      c.quadraticCurveTo(x + s * 0.35, y - s * 0.55 + flap, x + s, y);
      c.stroke();
    }
    c.restore();
  };

  const drawMainFlyingCrane = (t) => {
    const unit = Math.min(width, height) / 4.15;
    const phase = t * 0.0042 * state.pace + beatPulse * 0.55;
    const cx = width * 0.52 + Math.sin(t * 0.00042) * width * 0.12;
    const cy = height * 0.39 + Math.sin(t * 0.0009) * height * 0.055;
    const flap = Math.sin(phase) * unit * 0.42;
    const tilt = Math.sin(phase * 0.5) * 0.045;

    c.save();
    c.translate(cx, cy);
    c.rotate(tilt);

    c.save();
    c.globalAlpha = 0.22 * state.water;
    c.translate(0, height * 0.28);
    c.scale(1.08, 0.16);
    ellipse(0, 0, unit * 1.9, unit * 0.35, 'rgba(8, 28, 30, 0.55)');
    c.restore();

    c.lineCap = 'round';
    c.lineJoin = 'round';

    c.fillStyle = '#e9f0eb';
    c.strokeStyle = '#c4d0c8';
    c.lineWidth = unit * 0.025;

    c.beginPath();
    c.moveTo(-unit * 0.18, 0);
    c.bezierCurveTo(-unit * 0.75, -unit * 0.18 - flap, -unit * 1.34, -unit * 0.16 - flap * 0.72, -unit * 1.82, -unit * 0.02 - flap * 0.36);
    c.bezierCurveTo(-unit * 1.34, unit * 0.22 - flap * 0.2, -unit * 0.72, unit * 0.26 - flap * 0.12, -unit * 0.12, unit * 0.1);
    c.closePath();
    c.fill();
    c.stroke();

    c.beginPath();
    c.moveTo(unit * 0.16, 0);
    c.bezierCurveTo(unit * 0.78, -unit * 0.2 + flap, unit * 1.44, -unit * 0.15 + flap * 0.72, unit * 1.94, unit * 0.02 + flap * 0.36);
    c.bezierCurveTo(unit * 1.42, unit * 0.23 + flap * 0.18, unit * 0.76, unit * 0.28 + flap * 0.1, unit * 0.12, unit * 0.1);
    c.closePath();
    c.fill();
    c.stroke();

    c.fillStyle = '#15191f';
    c.beginPath();
    c.moveTo(-unit * 1.5, unit * 0.02 - flap * 0.26);
    c.bezierCurveTo(-unit * 1.68, unit * 0.13 - flap * 0.24, -unit * 1.88, unit * 0.12 - flap * 0.18, -unit * 2.03, unit * 0.03 - flap * 0.14);
    c.bezierCurveTo(-unit * 1.84, unit * 0.24 - flap * 0.1, -unit * 1.58, unit * 0.28 - flap * 0.05, -unit * 1.28, unit * 0.15);
    c.closePath();
    c.fill();

    c.beginPath();
    c.moveTo(unit * 1.58, unit * 0.03 + flap * 0.26);
    c.bezierCurveTo(unit * 1.77, unit * 0.13 + flap * 0.24, unit * 1.97, unit * 0.12 + flap * 0.18, unit * 2.12, unit * 0.03 + flap * 0.14);
    c.bezierCurveTo(unit * 1.92, unit * 0.24 + flap * 0.1, unit * 1.63, unit * 0.29 + flap * 0.05, unit * 1.32, unit * 0.15);
    c.closePath();
    c.fill();

    ellipse(0, unit * 0.05, unit * 0.48, unit * 0.19, '#eef3ed', '#bfcbc3', unit * 0.018, 0.03);

    c.fillStyle = '#11151a';
    c.beginPath();
    c.moveTo(unit * 0.36, unit * 0.03);
    c.bezierCurveTo(unit * 0.75, unit * 0.11, unit * 1.03, unit * 0.18, unit * 1.28, unit * 0.34);
    c.bezierCurveTo(unit * 0.82, unit * 0.33, unit * 0.48, unit * 0.21, unit * 0.18, unit * 0.12);
    c.closePath();
    c.fill();

    c.strokeStyle = '#101418';
    c.lineWidth = unit * 0.13;
    c.beginPath();
    c.moveTo(-unit * 0.36, -unit * 0.01);
    c.bezierCurveTo(-unit * 0.68, -unit * 0.12, -unit * 1.0, -unit * 0.24, -unit * 1.34, -unit * 0.42);
    c.stroke();

    c.strokeStyle = '#f2f7f2';
    c.lineWidth = unit * 0.062;
    c.beginPath();
    c.moveTo(-unit * 0.42, -unit * 0.03);
    c.bezierCurveTo(-unit * 0.7, -unit * 0.14, -unit * 0.97, -unit * 0.23, -unit * 1.22, -unit * 0.37);
    c.stroke();

    ellipse(-unit * 1.42, -unit * 0.45, unit * 0.18, unit * 0.12, '#101418', null, 1, -0.14);
    ellipse(-unit * 1.48, -unit * 0.55, unit * 0.07, unit * 0.028, '#dc2433', null, 1, -0.22);
    ellipse(-unit * 1.47, -unit * 0.45, unit * 0.014, unit * 0.014, '#f8fafc');

    c.fillStyle = '#1a1f23';
    c.beginPath();
    c.moveTo(-unit * 1.58, -unit * 0.45);
    c.lineTo(-unit * 1.88, -unit * 0.5);
    c.lineTo(-unit * 1.6, -unit * 0.38);
    c.closePath();
    c.fill();

    c.strokeStyle = '#171b1f';
    c.lineWidth = unit * 0.035;
    c.beginPath();
    c.moveTo(unit * 0.36, unit * 0.12);
    c.bezierCurveTo(unit * 0.72, unit * 0.32, unit * 1.06, unit * 0.35, unit * 1.42, unit * 0.27);
    c.moveTo(unit * 0.32, unit * 0.16);
    c.bezierCurveTo(unit * 0.72, unit * 0.44, unit * 1.13, unit * 0.5, unit * 1.52, unit * 0.42);
    c.stroke();

    c.restore();
  };

  const drawCraneReflection = (cx, groundY, unit, phase) => {
    c.save();
    c.globalAlpha = 0.26 * state.water;
    c.translate(cx, groundY + unit * 0.55);
    c.scale(1, -0.46);
    c.filter = 'blur(1px)';
    drawCraneBody(0, 0, unit, phase, true);
    c.restore();
    c.filter = 'none';
  };

  const drawCraneBody = (cx, cy, unit, phase, reflection = false) => {
    const neckBend = Math.sin(phase * 0.7) * unit * 0.08;
    const step = Math.sin(phase * 1.8);
    const bob = Math.sin(phase * 1.8 + 0.4) * unit * 0.045;

    c.save();
    c.translate(cx, cy + bob);

    c.strokeLinecap = 'round';
    c.lineCap = 'round';
    c.lineJoin = 'round';

    c.strokeStyle = reflection ? 'rgba(10, 20, 22, 0.72)' : '#1a1d21';
    c.lineWidth = unit * 0.055;
    c.beginPath();
    c.moveTo(-unit * 0.24, unit * 0.62);
    c.quadraticCurveTo(-unit * 0.35 + step * unit * 0.1, unit * 0.94, -unit * 0.46 + step * unit * 0.16, unit * 1.25);
    c.moveTo(unit * 0.12, unit * 0.62);
    c.quadraticCurveTo(unit * 0.22 - step * unit * 0.1, unit * 0.94, unit * 0.36 - step * unit * 0.16, unit * 1.25);
    c.stroke();

    c.lineWidth = unit * 0.035;
    c.beginPath();
    c.moveTo(-unit * 0.52 + step * unit * 0.16, unit * 1.25);
    c.lineTo(-unit * 0.28 + step * unit * 0.16, unit * 1.25);
    c.moveTo(unit * 0.3 - step * unit * 0.16, unit * 1.25);
    c.lineTo(unit * 0.54 - step * unit * 0.16, unit * 1.25);
    c.stroke();

    ellipse(0, unit * 0.27, unit * 0.74, unit * 0.42, reflection ? 'rgba(236, 244, 238, 0.7)' : '#eef3ed', reflection ? null : '#c7d1c8', unit * 0.018, -0.08);
    ellipse(-unit * 0.04, unit * 0.18, unit * 0.46, unit * 0.28, reflection ? 'rgba(214, 224, 219, 0.62)' : '#d6dfd9', null, 1, -0.18);

    c.fillStyle = reflection ? 'rgba(22, 28, 31, 0.72)' : '#15191f';
    c.beginPath();
    c.moveTo(unit * 0.46, unit * 0.05);
    c.quadraticCurveTo(unit * 0.84, unit * 0.16, unit * 1.04, unit * 0.45);
    c.quadraticCurveTo(unit * 0.62, unit * 0.42, unit * 0.26, unit * 0.3);
    c.closePath();
    c.fill();

    c.strokeStyle = reflection ? 'rgba(16, 21, 25, 0.76)' : '#11151a';
    c.lineWidth = unit * 0.2;
    c.beginPath();
    c.moveTo(-unit * 0.52, unit * 0.07);
    c.quadraticCurveTo(-unit * 0.7 + neckBend, -unit * 0.48, -unit * 0.42 + neckBend, -unit * 0.92);
    c.stroke();

    c.lineWidth = unit * 0.105;
    c.strokeStyle = reflection ? 'rgba(231, 238, 234, 0.55)' : '#f3f7f2';
    c.beginPath();
    c.moveTo(-unit * 0.56, -unit * 0.06);
    c.quadraticCurveTo(-unit * 0.65 + neckBend, -unit * 0.46, -unit * 0.44 + neckBend, -unit * 0.78);
    c.stroke();

    ellipse(-unit * 0.36 + neckBend, -unit * 1, unit * 0.22, unit * 0.18, reflection ? 'rgba(15, 21, 26, 0.76)' : '#11151a');
    if (!reflection) {
      ellipse(-unit * 0.42 + neckBend, -unit * 1.13, unit * 0.08, unit * 0.035, '#d82030', null, 1, -0.26);
      ellipse(-unit * 0.45 + neckBend, -unit * 1.01, unit * 0.018, unit * 0.018, '#f8fafc');
    }

    c.fillStyle = reflection ? 'rgba(18, 24, 27, 0.62)' : '#1b2025';
    c.beginPath();
    c.moveTo(-unit * 0.58 + neckBend, -unit * 1.01);
    c.lineTo(-unit * 0.9 + neckBend, -unit * 1.05);
    c.lineTo(-unit * 0.58 + neckBend, -unit * 0.94);
    c.closePath();
    c.fill();

    c.restore();
  };

  const drawCrane = (t) => {
    const unit = Math.min(width, height) / 5.3;
    const groundY = height * 0.66;
    const phase = t * 0.0028 * state.pace + beatPulse * 0.35;
    const cx = width * (0.5 + Math.sin(t * 0.00035) * 0.04);
    drawCraneReflection(cx, groundY, unit, phase);
    drawCraneBody(cx, groundY, unit, phase);

    c.save();
    c.globalAlpha = 0.5;
    c.fillStyle = '#10211f';
    ellipse(cx, groundY + unit * 1.28, unit * 0.9, unit * 0.13, 'rgba(10, 22, 20, 0.45)');
    c.restore();
  };

  const drawForeground = (t) => {
    c.save();
    c.globalAlpha = 0.88;
    for (let i = 0; i < 18; i += 1) {
      const x = ((i * 53) % 100) / 100 * width;
      const baseY = height * (0.88 + ((i * 7) % 10) / 80);
      const h = height * (0.1 + ((i * 11) % 9) / 70);
      const sway = Math.sin(t * 0.0014 + i * 0.8) * (6 + state.wind * 12);
      c.strokeStyle = i % 2 ? '#2d4d31' : '#b8a15c';
      c.lineWidth = i % 3 === 0 ? 3 : 2;
      c.beginPath();
      c.moveTo(x, baseY);
      c.quadraticCurveTo(x + sway * 0.45, baseY - h * 0.48, x + sway, baseY - h);
      c.stroke();
    }
    c.restore();
  };

  const drawMist = (t) => {
    for (let i = 0; i < 5; i += 1) {
      const x = ((t * 0.009 * (0.4 + state.wind) + i * width * 0.28) % (width * 1.35)) - width * 0.2;
      const y = height * (0.5 + i * 0.035);
      c.fillStyle = `rgba(238, 251, 250, ${0.06 - i * 0.006})`;
      c.beginPath();
      c.ellipse(x, y, width * 0.18, height * 0.025, 0, 0, Math.PI * 2);
      c.fill();
    }
  };

  const draw = (t) => {
    if (destroyed) return;
    beatPulse *= 0.9;
    if (beatPulse < 0.001) beatPulse = 0;
    pulseFill.style.width = `${Math.round(beatPulse * 100)}%`;

    drawSky(t);
    drawFlyingFlock(t);
    drawWaterAndReeds(t);
    drawMist(t);
    drawMainFlyingCrane(t);
    drawForeground(t);

    if (beatPulse > 0.02) {
      c.fillStyle = `rgba(255, 255, 255, ${beatPulse * 0.08})`;
      c.fillRect(0, 0, width, height);
    }

    raf = requestAnimationFrame(draw);
  };

  raf = requestAnimationFrame(draw);

  return {
    update() {},
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      listeners.forEach((unsubscribe) => unsubscribe());
      subscriptions.forEach((unsubscribe) => unsubscribe());
      unsubscribeClock();
      if (resizeObserver) resizeObserver.disconnect();
    }
  };
}
