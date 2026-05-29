const STATE_VERSION = 'sparkling-buddha-thai-temple-v1';

export default function setup(ctx, prevState) {
  const audio = ctx.audioCtx;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const finite = (value, fallback) => Number.isFinite(value) ? value : fallback;
  const previousMatches = prevState?.stateVersion === STATE_VERSION;

  const state = {
    stateVersion: STATE_VERSION,
    running: previousMatches ? prevState.running !== false : true,
    volume: previousMatches ? finite(prevState.volume, 0.46) : 0.46,
    shimmer: previousMatches ? finite(prevState.shimmer, 0.72) : 0.72,
    drone: previousMatches ? finite(prevState.drone, 0.44) : 0.44,
    bells: previousMatches ? finite(prevState.bells, 0.78) : 0.78
  };

  const liveNodes = new Set();
  const cleanupTimers = new Set();
  let destroyed = false;
  let currentStep = -1;
  let pulse = 0;
  let gongGlow = 0;
  let bellGlow = 0;
  let startTime = performance.now();

  ctx.domRoot.innerHTML = `
    <style>
      :host {
        display: block;
        width: 100%;
        height: 100%;
      }

      .temple {
        box-sizing: border-box;
        position: relative;
        width: 100%;
        height: 100%;
        min-width: 300px;
        min-height: 230px;
        overflow: hidden;
        border: 1px solid rgba(250, 204, 21, 0.58);
        border-radius: 8px;
        background: #05060a;
        color: #fff7ed;
        font: 11px/1.28 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        box-shadow:
          inset 0 0 0 1px rgba(255, 255, 255, 0.05),
          0 0 34px rgba(250, 204, 21, 0.2),
          0 16px 36px rgba(0, 0, 0, 0.42);
      }

      canvas {
        display: block;
        width: 100%;
        height: 100%;
      }

      .panel {
        position: absolute;
        left: 10px;
        right: 10px;
        bottom: 10px;
        display: grid;
        grid-template-columns: auto minmax(0, 1fr);
        gap: 8px;
        align-items: center;
        padding: 8px;
        border: 1px solid rgba(254, 240, 138, 0.38);
        border-radius: 8px;
        background: rgba(25, 13, 5, 0.76);
        backdrop-filter: blur(8px);
      }

      button {
        width: 42px;
        height: 30px;
        border: 1px solid rgba(254, 240, 138, 0.72);
        border-radius: 6px;
        background: linear-gradient(180deg, #fde68a, #f59e0b);
        color: #211002;
        font: 800 11px/1 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        cursor: pointer;
      }

      button.off {
        color: #fed7aa;
        background: rgba(67, 20, 7, 0.86);
        border-color: rgba(251, 146, 60, 0.42);
      }

      .controls {
        min-width: 0;
        display: grid;
        grid-template-columns: repeat(4, minmax(0, 1fr));
        gap: 7px;
      }

      label {
        min-width: 0;
        display: grid;
        gap: 3px;
        color: #fed7aa;
      }

      label span {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      input[type="range"] {
        width: 100%;
        min-width: 0;
        accent-color: #facc15;
      }

      .title {
        position: absolute;
        top: 10px;
        left: 10px;
        right: 10px;
        display: flex;
        justify-content: space-between;
        gap: 10px;
        pointer-events: none;
        color: #fef3c7;
        text-shadow: 0 0 12px rgba(250, 204, 21, 0.86);
      }

      .title strong {
        font: 800 13px/1 ui-sans-serif, system-ui, sans-serif;
        letter-spacing: 0;
      }

      .title span {
        color: #fdba74;
        font-size: 10px;
      }

      @media (max-width: 380px) {
        .panel {
          grid-template-columns: 1fr;
        }

        button {
          width: 100%;
        }

        .controls {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
      }
    </style>
    <div class="temple">
      <canvas id="scene" aria-label="Sparkling Buddha and Thai temple sound"></canvas>
      <div class="title">
        <strong>きらめく仏陀</strong>
        <span id="readout">THAI TEMPLE</span>
      </div>
      <div class="panel" data-no-drag>
        <button id="run" type="button"></button>
        <div class="controls">
          <label><span>volume</span><input id="volume" type="range" min="0" max="0.9" step="0.01"></label>
          <label><span>shimmer</span><input id="shimmer" type="range" min="0" max="1" step="0.01"></label>
          <label><span>drone</span><input id="drone" type="range" min="0" max="0.9" step="0.01"></label>
          <label><span>bells</span><input id="bells" type="range" min="0" max="1" step="0.01"></label>
        </div>
      </div>
    </div>
  `;

  const canvas = ctx.domRoot.querySelector('#scene');
  const paint = canvas.getContext('2d', { alpha: false });
  const runButton = ctx.domRoot.querySelector('#run');
  const readout = ctx.domRoot.querySelector('#readout');
  const sliders = {
    volume: ctx.domRoot.querySelector('#volume'),
    shimmer: ctx.domRoot.querySelector('#shimmer'),
    drone: ctx.domRoot.querySelector('#drone'),
    bells: ctx.domRoot.querySelector('#bells')
  };

  const master = audio.createGain();
  const compressor = audio.createDynamicsCompressor();
  const delay = audio.createDelay(1.6);
  const feedback = audio.createGain();
  const delayTone = audio.createBiquadFilter();
  const wet = audio.createGain();
  const droneMix = audio.createGain();
  const droneFilter = audio.createBiquadFilter();
  const droneAmp = audio.createGain();
  const droneA = audio.createOscillator();
  const droneB = audio.createOscillator();
  const droneC = audio.createOscillator();

  master.gain.value = 0;
  compressor.threshold.value = -18;
  compressor.knee.value = 20;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.008;
  compressor.release.value = 0.22;
  delay.delayTime.value = 0.36;
  feedback.gain.value = 0.34;
  delayTone.type = 'lowpass';
  delayTone.frequency.value = 3600;
  wet.gain.value = 0.28;
  droneMix.gain.value = 0.28;
  droneFilter.type = 'lowpass';
  droneFilter.frequency.value = 900;
  droneFilter.Q.value = 1.4;
  droneAmp.gain.value = 0;

  droneA.type = 'sine';
  droneB.type = 'triangle';
  droneC.type = 'sine';
  droneA.frequency.value = 146.83;
  droneB.frequency.value = 220;
  droneC.frequency.value = 293.66;
  droneB.detune.value = 4;
  droneC.detune.value = -7;

  droneA.connect(droneMix);
  droneB.connect(droneMix);
  droneC.connect(droneMix);
  droneMix.connect(droneFilter);
  droneFilter.connect(droneAmp);
  droneAmp.connect(master);
  master.connect(compressor);
  compressor.connect(ctx.audioOut);
  delay.connect(delayTone);
  delayTone.connect(feedback);
  feedback.connect(delay);
  delayTone.connect(wet);
  wet.connect(master);
  [droneA, droneB, droneC].forEach((osc) => osc.start());

  const sparkles = Array.from({ length: 86 }, (_, index) => {
    const a = (index * 137.508) * Math.PI / 180;
    const r = 0.12 + ((index * 41) % 100) / 100 * 0.82;
    return {
      x: 0.5 + Math.cos(a) * r * 0.45,
      y: 0.46 + Math.sin(a) * r * 0.38,
      size: 0.7 + ((index * 19) % 100) / 100 * 2.8,
      phase: index * 0.47,
      speed: 0.55 + ((index * 29) % 100) / 100 * 1.35
    };
  });

  function track(seconds, ...nodes) {
    nodes.forEach((node) => liveNodes.add(node));
    const timer = setTimeout(() => {
      cleanupTimers.delete(timer);
      nodes.forEach((node) => {
        liveNodes.delete(node);
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      });
    }, Math.max(80, seconds * 1000 + 180));
    cleanupTimers.add(timer);
  }

  function syncAudio() {
    const now = audio.currentTime;
    master.gain.setTargetAtTime(state.running ? state.volume : 0, now, 0.035);
    droneAmp.gain.setTargetAtTime(state.running ? state.drone * 0.28 : 0, now, 0.08);
    droneFilter.frequency.setTargetAtTime(520 + state.shimmer * 1300, now, 0.12);
    wet.gain.setTargetAtTime(0.16 + state.shimmer * 0.28, now, 0.06);
  }

  function playBell(time, freq, velocity = 1, length = 3.2) {
    if (!state.running || destroyed) return;
    const gain = audio.createGain();
    const tone = audio.createOscillator();
    const overtone = audio.createOscillator();
    const bright = audio.createBiquadFilter();
    const pan = audio.createStereoPanner ? audio.createStereoPanner() : null;
    const start = Math.max(audio.currentTime, time || audio.currentTime);
    const amount = state.bells * velocity;

    tone.type = 'sine';
    overtone.type = 'triangle';
    tone.frequency.setValueAtTime(freq, start);
    overtone.frequency.setValueAtTime(freq * 2.01, start);
    overtone.detune.setValueAtTime(8, start);
    bright.type = 'bandpass';
    bright.frequency.setValueAtTime(freq * (2.2 + state.shimmer), start);
    bright.Q.setValueAtTime(8, start);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.14 * amount + 0.0001, start + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + length);

    if (pan) {
      pan.pan.setValueAtTime(Math.sin(freq) * 0.42, start);
      tone.connect(pan);
      overtone.connect(pan);
      pan.connect(bright);
    } else {
      tone.connect(bright);
      overtone.connect(bright);
    }
    bright.connect(gain);
    gain.connect(master);
    gain.connect(delay);
    tone.start(start);
    overtone.start(start);
    tone.stop(start + length + 0.06);
    overtone.stop(start + length + 0.06);
    track(length + 0.12, tone, overtone, bright, gain, ...(pan ? [pan] : []));
    bellGlow = Math.max(bellGlow, amount);
  }

  function playGong(time, velocity = 1) {
    if (!state.running || destroyed) return;
    const start = Math.max(audio.currentTime, time || audio.currentTime);
    const out = audio.createGain();
    const low = audio.createOscillator();
    const lowB = audio.createOscillator();
    const metal = audio.createOscillator();
    const filter = audio.createBiquadFilter();
    const length = 5.2;
    const amount = state.bells * velocity;

    low.type = 'sine';
    lowB.type = 'triangle';
    metal.type = 'sine';
    low.frequency.setValueAtTime(92, start);
    low.frequency.exponentialRampToValueAtTime(73, start + length);
    lowB.frequency.setValueAtTime(138, start);
    lowB.frequency.exponentialRampToValueAtTime(112, start + length);
    metal.frequency.setValueAtTime(381, start);
    metal.detune.setValueAtTime(-13, start);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(980, start);
    filter.frequency.exponentialRampToValueAtTime(260, start + length);
    filter.Q.setValueAtTime(2.2, start);
    out.gain.setValueAtTime(0.0001, start);
    out.gain.exponentialRampToValueAtTime(0.34 * amount + 0.0001, start + 0.04);
    out.gain.exponentialRampToValueAtTime(0.0001, start + length);

    low.connect(filter);
    lowB.connect(filter);
    metal.connect(filter);
    filter.connect(out);
    out.connect(master);
    out.connect(delay);
    low.start(start);
    lowB.start(start);
    metal.start(start);
    low.stop(start + length + 0.08);
    lowB.stop(start + length + 0.08);
    metal.stop(start + length + 0.08);
    track(length + 0.16, low, lowB, metal, filter, out);
    gongGlow = Math.max(gongGlow, amount);
  }

  function resizeCanvas() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    return { width, height };
  }

  function drawTemple(width, height, time) {
    const sky = paint.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, '#160b2d');
    sky.addColorStop(0.45, '#44220b');
    sky.addColorStop(1, '#130805');
    paint.fillStyle = sky;
    paint.fillRect(0, 0, width, height);

    paint.fillStyle = 'rgba(255, 220, 120, 0.08)';
    for (let i = 0; i < 5; i += 1) {
      const y = height * (0.18 + i * 0.115);
      paint.fillRect(0, y + Math.sin(time + i) * 5, width, 1.2);
    }

    const horizon = height * 0.69;
    const centerX = width * 0.5;
    const templeW = width * 0.82;

    paint.fillStyle = '#5b2108';
    paint.fillRect(centerX - templeW * 0.34, horizon - height * 0.1, templeW * 0.68, height * 0.21);
    paint.fillStyle = '#7c2d12';
    paint.fillRect(centerX - templeW * 0.3, horizon - height * 0.075, templeW * 0.6, height * 0.15);

    drawRoof(centerX, horizon - height * 0.11, templeW * 0.72, height * 0.12, '#b45309');
    drawRoof(centerX, horizon - height * 0.2, templeW * 0.58, height * 0.11, '#dc2626');
    drawRoof(centerX, horizon - height * 0.29, templeW * 0.42, height * 0.1, '#f97316');

    paint.fillStyle = '#fde68a';
    paint.fillRect(centerX - templeW * 0.026, horizon - height * 0.43, templeW * 0.052, height * 0.15);
    paint.beginPath();
    paint.moveTo(centerX, horizon - height * 0.52);
    paint.lineTo(centerX + templeW * 0.048, horizon - height * 0.43);
    paint.lineTo(centerX - templeW * 0.048, horizon - height * 0.43);
    paint.closePath();
    paint.fill();

    paint.fillStyle = 'rgba(253, 230, 138, 0.78)';
    for (let i = -3; i <= 3; i += 1) {
      const x = centerX + i * templeW * 0.083;
      paint.fillRect(x - templeW * 0.014, horizon - height * 0.072, templeW * 0.028, height * 0.13);
    }
  }

  function drawRoof(x, y, w, h, color) {
    paint.fillStyle = color;
    paint.beginPath();
    paint.moveTo(x - w * 0.5, y + h);
    paint.quadraticCurveTo(x, y - h * 0.42, x + w * 0.5, y + h);
    paint.lineTo(x + w * 0.43, y + h * 1.24);
    paint.quadraticCurveTo(x, y + h * 0.28, x - w * 0.43, y + h * 1.24);
    paint.closePath();
    paint.fill();

    paint.strokeStyle = '#fef08a';
    paint.lineWidth = Math.max(1, h * 0.08);
    paint.stroke();

    paint.fillStyle = '#facc15';
    paint.beginPath();
    paint.moveTo(x - w * 0.51, y + h * 0.96);
    paint.quadraticCurveTo(x - w * 0.58, y + h * 0.62, x - w * 0.43, y + h * 0.55);
    paint.quadraticCurveTo(x - w * 0.49, y + h * 0.72, x - w * 0.38, y + h * 0.84);
    paint.closePath();
    paint.fill();
    paint.beginPath();
    paint.moveTo(x + w * 0.51, y + h * 0.96);
    paint.quadraticCurveTo(x + w * 0.58, y + h * 0.62, x + w * 0.43, y + h * 0.55);
    paint.quadraticCurveTo(x + w * 0.49, y + h * 0.72, x + w * 0.38, y + h * 0.84);
    paint.closePath();
    paint.fill();
  }

  function drawBuddha(width, height, time) {
    const cx = width * 0.5;
    const baseY = height * 0.72;
    const unit = Math.min(width, height) * 0.19;
    const auraPulse = 0.72 + pulse * 0.2 + bellGlow * 0.25;
    const aura = paint.createRadialGradient(cx, baseY - unit * 1.55, unit * 0.34, cx, baseY - unit * 1.48, unit * 2.35);
    aura.addColorStop(0, `rgba(254, 240, 138, ${0.42 * auraPulse})`);
    aura.addColorStop(0.42, `rgba(251, 191, 36, ${0.19 * auraPulse})`);
    aura.addColorStop(1, 'rgba(251, 191, 36, 0)');
    paint.fillStyle = aura;
    paint.beginPath();
    paint.arc(cx, baseY - unit * 1.45, unit * 2.25, 0, Math.PI * 2);
    paint.fill();

    const gold = paint.createLinearGradient(cx - unit, baseY - unit * 2.4, cx + unit, baseY);
    gold.addColorStop(0, '#fff7ad');
    gold.addColorStop(0.22, '#facc15');
    gold.addColorStop(0.56, '#d97706');
    gold.addColorStop(1, '#7c2d12');
    paint.fillStyle = gold;
    paint.strokeStyle = 'rgba(255, 247, 173, 0.9)';
    paint.lineWidth = Math.max(1, unit * 0.035);

    paint.beginPath();
    paint.ellipse(cx, baseY - unit * 0.28, unit * 1.1, unit * 0.32, 0, 0, Math.PI * 2);
    paint.fill();
    paint.stroke();

    paint.beginPath();
    paint.moveTo(cx - unit * 0.64, baseY - unit * 0.24);
    paint.quadraticCurveTo(cx - unit * 0.78, baseY - unit * 1.14, cx - unit * 0.25, baseY - unit * 1.46);
    paint.quadraticCurveTo(cx, baseY - unit * 1.62, cx + unit * 0.25, baseY - unit * 1.46);
    paint.quadraticCurveTo(cx + unit * 0.78, baseY - unit * 1.14, cx + unit * 0.64, baseY - unit * 0.24);
    paint.quadraticCurveTo(cx, baseY - unit * 0.46, cx - unit * 0.64, baseY - unit * 0.24);
    paint.fill();
    paint.stroke();

    paint.beginPath();
    paint.ellipse(cx, baseY - unit * 1.88, unit * 0.34, unit * 0.43, 0, 0, Math.PI * 2);
    paint.fill();
    paint.stroke();

    paint.beginPath();
    paint.arc(cx, baseY - unit * 2.28, unit * 0.18, Math.PI, 0);
    paint.lineTo(cx + unit * 0.07, baseY - unit * 2.2);
    paint.lineTo(cx, baseY - unit * 2.48);
    paint.lineTo(cx - unit * 0.07, baseY - unit * 2.2);
    paint.closePath();
    paint.fill();

    paint.strokeStyle = 'rgba(120, 53, 15, 0.62)';
    paint.lineWidth = Math.max(1, unit * 0.018);
    paint.beginPath();
    paint.moveTo(cx - unit * 0.13, baseY - unit * 1.91);
    paint.quadraticCurveTo(cx, baseY - unit * 1.86, cx + unit * 0.13, baseY - unit * 1.91);
    paint.moveTo(cx - unit * 0.14, baseY - unit * 1.99);
    paint.lineTo(cx - unit * 0.04, baseY - unit * 1.99);
    paint.moveTo(cx + unit * 0.04, baseY - unit * 1.99);
    paint.lineTo(cx + unit * 0.14, baseY - unit * 1.99);
    paint.stroke();

    paint.strokeStyle = `rgba(255, 247, 173, ${0.38 + state.shimmer * 0.42})`;
    paint.lineWidth = Math.max(1, unit * 0.025);
    for (let i = 0; i < 18; i += 1) {
      const angle = (i / 18) * Math.PI * 2 + time * 0.08;
      const inner = unit * (0.96 + Math.sin(time * 1.2 + i) * 0.04);
      const outer = unit * (1.58 + state.shimmer * 0.38);
      paint.beginPath();
      paint.moveTo(cx + Math.cos(angle) * inner, baseY - unit * 1.58 + Math.sin(angle) * inner);
      paint.lineTo(cx + Math.cos(angle) * outer, baseY - unit * 1.58 + Math.sin(angle) * outer);
      paint.stroke();
    }
  }

  function drawSparkles(width, height, time) {
    for (const star of sparkles) {
      const drift = Math.sin(time * star.speed + star.phase) * 0.018;
      const x = (star.x + drift) * width;
      const y = (star.y + Math.cos(time * star.speed * 0.77 + star.phase) * 0.015) * height;
      const twinkle = Math.max(0, Math.sin(time * (2.4 + star.speed) + star.phase));
      const alpha = (0.08 + twinkle * 0.72) * (0.25 + state.shimmer * 0.95);
      const size = star.size * (1 + twinkle * 1.5) * Math.min(width, height) / 420;
      paint.strokeStyle = `rgba(254, 240, 138, ${alpha})`;
      paint.lineWidth = Math.max(0.7, size * 0.28);
      paint.beginPath();
      paint.moveTo(x - size, y);
      paint.lineTo(x + size, y);
      paint.moveTo(x, y - size);
      paint.lineTo(x, y + size);
      paint.stroke();
    }

    const glow = paint.createRadialGradient(width * 0.5, height * 0.5, 0, width * 0.5, height * 0.5, Math.min(width, height) * (0.32 + gongGlow * 0.12));
    glow.addColorStop(0, `rgba(250, 204, 21, ${0.08 + gongGlow * 0.12})`);
    glow.addColorStop(1, 'rgba(250, 204, 21, 0)');
    paint.fillStyle = glow;
    paint.fillRect(0, 0, width, height);
  }

  function draw() {
    if (!paint) return;
    const { width, height } = resizeCanvas();
    const time = (performance.now() - startTime) / 1000;
    drawTemple(width, height, time);
    drawBuddha(width, height, time);
    drawSparkles(width, height, time);

    paint.fillStyle = 'rgba(0, 0, 0, 0.24)';
    paint.fillRect(0, height * 0.84, width, height * 0.16);
    readout.textContent = currentStep >= 0 ? `WAT BELL STEP ${String(currentStep + 1).padStart(2, '0')}` : 'THAI TEMPLE';
  }

  function renderControls() {
    runButton.textContent = state.running ? 'on' : 'off';
    runButton.classList.toggle('off', !state.running);
    Object.entries(sliders).forEach(([key, slider]) => {
      if (slider.value !== String(state[key])) slider.value = String(state[key]);
    });
  }

  function onRun() {
    state.running = !state.running;
    syncAudio();
    renderControls();
  }

  const sliderHandlers = Object.fromEntries(Object.keys(sliders).map((key) => [key, () => {
    state[key] = Number(sliders[key].value);
    syncAudio();
    renderControls();
  }]));

  runButton.addEventListener('click', onRun);
  Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].addEventListener('input', handler));

  const bellPattern = [null, 880, null, 1174.66, null, 987.77, null, 1318.51, null, 783.99, null, 987.77, null, 1174.66, 880, null];
  const unsubscribeClock = ctx.clock.onTick(({ step, time, duration }) => {
    if (destroyed) return;
    currentStep = ((step % 16) + 16) % 16;
    pulse = Math.max(pulse, currentStep % 4 === 0 ? 1 : 0.36);
    if (!state.running) return;

    const beatTime = Number.isFinite(time) ? time : audio.currentTime;
    const beatDuration = Number.isFinite(duration) ? duration : 0.25;
    if (currentStep === 0 || currentStep === 8) playGong(beatTime, currentStep === 0 ? 1 : 0.72);
    const freq = bellPattern[currentStep];
    if (freq) playBell(beatTime + beatDuration * 0.08, freq, currentStep % 4 === 0 ? 0.86 : 0.62, 2.8);
    if (currentStep % 4 === 2) playBell(beatTime + beatDuration * 0.32, 1567.98, 0.34, 1.8);
  });

  syncAudio();
  renderControls();
  draw();

  return {
    update() {
      pulse *= 0.9;
      gongGlow *= 0.94;
      bellGlow *= 0.9;
      draw();
    },
    getState() {
      return { ...state };
    },
    destroy() {
      destroyed = true;
      unsubscribeClock();
      runButton.removeEventListener('click', onRun);
      Object.entries(sliderHandlers).forEach(([key, handler]) => sliders[key].removeEventListener('input', handler));
      cleanupTimers.forEach((timer) => clearTimeout(timer));
      cleanupTimers.clear();
      for (const node of liveNodes) {
        try { if (typeof node.stop === 'function') node.stop(); } catch (_) {}
        try { if (typeof node.disconnect === 'function') node.disconnect(); } catch (_) {}
      }
      liveNodes.clear();
      try { droneA.stop(); droneB.stop(); droneC.stop(); } catch (_) {}
      try {
        droneA.disconnect();
        droneB.disconnect();
        droneC.disconnect();
        droneMix.disconnect();
        droneFilter.disconnect();
        droneAmp.disconnect();
        master.disconnect();
        compressor.disconnect();
        delay.disconnect();
        feedback.disconnect();
        delayTone.disconnect();
        wet.disconnect();
      } catch (_) {}
      ctx.domRoot.innerHTML = '';
      startTime = 0;
    }
  };
}
