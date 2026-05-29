export default function setup(ctx, prevState) {
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
  const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const migrateState = (raw) => {
    raw = raw && typeof raw === 'object' ? raw : {};
    return {
    enabled: raw.enabled ?? raw.on ?? true,
    pattern: Array.isArray(raw.pattern) && raw.pattern.length === 16
      ? raw.pattern.map((v) => v ? 1 : 0)
      : [1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 0],
    glow: clamp(finite(raw.glow ?? raw.sparkle, 0.5), 0, 1),
    motion: clamp(finite(raw.motion ?? raw.decay, 0.55), 0, 1)
    };
  };

  const state = migrateState(prevState);
  const dom = ctx.domRoot;
  const unsubscribers = [];
  let currentStep = -1;
  let pulse = 0;
  let destroyed = false;
  let animationPhase = 0;

  dom.innerHTML = `
    <style>
      :host { display: block; height: 100%; }
      .wrap {
        box-sizing: border-box;
        height: 100%;
        min-height: 200px;
        padding: 10px;
        display: grid;
        grid-template-rows: auto 1fr auto;
        gap: 8px;
        overflow: hidden;
        color: #f8fafc;
        background:
          radial-gradient(circle at 12% 0%, rgba(34, 197, 94, 0.22), transparent 34%),
          linear-gradient(135deg, #10151f 0%, #1a1b25 48%, #0d1f22 100%);
        border: 1px solid rgba(148, 163, 184, 0.35);
        border-radius: 8px;
        font: 12px/1.2 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      .top {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .title {
        min-width: 0;
        display: grid;
        gap: 1px;
      }
      h2 {
        margin: 0;
        font-size: 13px;
        line-height: 1;
        letter-spacing: 0;
        color: #ffffff;
      }
      .sub {
        color: #9ca3af;
        font-size: 10px;
        white-space: nowrap;
      }
      button, input {
        font: inherit;
      }
      .power {
        width: 34px;
        height: 26px;
        border: 1px solid rgba(255, 255, 255, 0.24);
        border-radius: 6px;
        color: #f8fafc;
        background: rgba(15, 23, 42, 0.58);
        cursor: pointer;
      }
      .power.on {
        color: #071316;
        background: #5eead4;
        box-shadow: 0 0 18px rgba(94, 234, 212, 0.45);
      }
      .visual {
        position: relative;
        min-height: 74px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        border-radius: 6px;
        overflow: hidden;
        background: rgba(2, 6, 23, 0.42);
      }
      canvas {
        width: 100%;
        height: 100%;
        display: block;
      }
      .playhead {
        position: absolute;
        inset: auto 8px 7px;
        display: grid;
        grid-template-columns: repeat(16, 1fr);
        gap: 3px;
      }
      .step {
        height: 12px;
        border: 0;
        border-radius: 3px;
        padding: 0;
        background: rgba(148, 163, 184, 0.26);
        cursor: pointer;
      }
      .step.active {
        background: #facc15;
      }
      .step.now {
        outline: 2px solid #67e8f9;
        outline-offset: 1px;
      }
      .controls {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 6px 8px;
      }
      label {
        min-width: 0;
        display: grid;
        gap: 2px;
        color: #cbd5e1;
        font-size: 9px;
        text-transform: uppercase;
      }
      input[type="range"] {
        width: 100%;
        accent-color: #5eead4;
      }
    </style>
    <div class="wrap">
      <div class="top">
        <div class="title">
          <h2>Pulse Glass</h2>
          <div class="sub" id="readout"></div>
        </div>
        <button class="power" id="enabled" title="Toggle pulses" type="button">I/O</button>
      </div>
      <div class="visual">
        <canvas id="scope"></canvas>
        <div class="playhead" id="steps"></div>
      </div>
      <div class="controls">
        <label>Glow <input id="glow" type="range" min="0" max="1" step="0.001"></label>
        <label>Motion <input id="motion" type="range" min="0" max="1" step="0.001"></label>
      </div>
    </div>
  `;

  const controls = {
    enabled: dom.querySelector('#enabled'),
    glow: dom.querySelector('#glow'),
    motion: dom.querySelector('#motion')
  };
  const readout = dom.querySelector('#readout');
  const stepsEl = dom.querySelector('#steps');
  const canvas = dom.querySelector('#scope');
  const gfx = canvas.getContext('2d');

  const publishState = () => {
    ctx.bus.pubGlobal('pulse_glass_state', { ...state, pattern: [...state.pattern] });
  };

  const renderSteps = () => {
    stepsEl.innerHTML = '';
    state.pattern.forEach((active, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `step ${active ? 'active' : ''} ${index === currentStep ? 'now' : ''}`;
      btn.title = `Step ${index + 1}`;
      btn.addEventListener('click', () => {
        state.pattern[index] = state.pattern[index] ? 0 : 1;
        publishState();
        render();
      });
      stepsEl.appendChild(btn);
    });
  };

  const render = () => {
    controls.glow.value = String(state.glow);
    controls.motion.value = String(state.motion);
    controls.enabled.classList.toggle('on', state.enabled);
    controls.enabled.setAttribute('aria-pressed', String(state.enabled));
    readout.textContent = state.enabled ? 'visual pulses' : 'muted';
    renderSteps();
  };

  const applyIncomingState = (next) => {
    if (!next || typeof next !== 'object') return;
    const migrated = migrateState({ ...state, ...next });
    Object.assign(state, migrated);
    render();
  };

  const onControl = (key, value) => {
    if (key === 'enabled') {
      state.enabled = Boolean(value);
    } else if (key === 'glow' || key === 'motion') {
      state[key] = clamp(finite(value, state[key]), 0, 1);
    }
    publishState();
    render();
  };

  controls.enabled.addEventListener('click', () => onControl('enabled', !state.enabled));
  ['glow', 'motion'].forEach((key) => {
    controls[key].addEventListener('input', (event) => onControl(key, event.target.value));
  });

  const unsubGlobal = ctx.bus.subGlobal('pulse_glass_state', applyIncomingState);
  if (typeof unsubGlobal === 'function') unsubscribers.push(unsubGlobal);

  const unsubClock = ctx.clock.onTick(({ step }) => {
    currentStep = step % 16;
    ctx.bus.pub('pulse_step', currentStep);
    if (state.enabled && state.pattern[currentStep]) {
      pulse = 1;
    }
  });
  if (typeof unsubClock === 'function') unsubscribers.push(unsubClock);

  const resizeCanvas = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.max(1, window.devicePixelRatio || 1);
    const width = Math.max(1, Math.floor(rect.width * ratio));
    const height = Math.max(1, Math.floor(rect.height * ratio));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
  };

  const draw = () => {
    resizeCanvas();
    const width = canvas.width;
    const height = canvas.height;
    animationPhase += 0.018 + state.motion * 0.052;
    pulse *= 0.88;

    gfx.clearRect(0, 0, width, height);
    const gradient = gfx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, `rgba(20, 184, 166, ${0.12 + state.glow * 0.18})`);
    gradient.addColorStop(0.55, `rgba(250, 204, 21, ${0.06 + state.glow * 0.11})`);
    gradient.addColorStop(1, `rgba(244, 114, 182, ${0.08 + state.glow * 0.14})`);
    gfx.fillStyle = gradient;
    gfx.fillRect(0, 0, width, height);

    gfx.lineWidth = Math.max(1, width / 170);
    gfx.strokeStyle = state.enabled ? 'rgba(165, 243, 252, 0.92)' : 'rgba(148, 163, 184, 0.48)';
    gfx.beginPath();
    for (let x = 0; x <= width; x += Math.max(2, width / 90)) {
      const n = x / width;
      const wave = Math.sin(n * 15 + animationPhase) * 0.22
        + Math.sin(n * 31 - animationPhase * 0.8) * 0.09
        + Math.sin(n * 6 + currentStep) * pulse * 0.2;
      const y = height * (0.5 + wave);
      if (x === 0) gfx.moveTo(x, y);
      else gfx.lineTo(x, y);
    }
    gfx.stroke();

    const x = ((currentStep + 0.5) / 16) * width;
    gfx.fillStyle = `rgba(250, 204, 21, ${state.enabled ? 0.8 : 0.35})`;
    gfx.fillRect(x - width / 130, 0, width / 65, height);
  };

  render();

  return {
    update() {
      if (!destroyed) draw();
    },
    getState() {
      return { ...state, pattern: [...state.pattern] };
    },
    destroy() {
      destroyed = true;
      unsubscribers.forEach((unsubscribe) => {
        try { unsubscribe(); } catch {}
      });
      Object.entries(controls).forEach(([, input]) => {
        if (!input) return;
        input.replaceWith(input.cloneNode(true));
      });
      dom.innerHTML = '';
    }
  };
}
